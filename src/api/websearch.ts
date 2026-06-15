import { WebSearchConfig } from "../config.js";
import { log } from "../utils/logger.js";

// Backed by the Miyami websearch API: https://github.com/ankushthakur2007/miyami_websearch_tool

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  engine: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  answers: string[];
  suggestions: string[];
  infoboxes: Array<{ title: string; content: string }>;
}

export interface FetchWebpageResponse {
  url: string;
  title: string;
  content: string;
  wordCount: number;
}

export interface SearchAndFetchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    content: string;
    wordCount: number;
    fetchStatus: string;
  }>;
}

export interface DeepResearchResponse {
  queries: string[];
  compiledReport: string;
  totalResults: number;
  successfulFetches: number;
}

export interface CrawlSiteResponse {
  startUrl: string;
  pagesCrawled: number;
  pages: Array<{
    url: string;
    title: string;
    content: string;
    wordCount: number;
    depth: number;
  }>;
  totalWords: number;
}

function buildBaseUrl(config: WebSearchConfig): string {
  return config.baseUrl.replace(/\/+$/, "");
}

function commonParams(config: WebSearchConfig): Record<string, string> {
  const params: Record<string, string> = {
    language: config.language,
  };
  if (config.autoBypass) {
    params.auto_bypass = "true";
  }
  return params;
}

async function miyamiFetch(url: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  log.debug(`Miyami API request: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Miyami API returned HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

export async function searchWeb(query: string, config: WebSearchConfig): Promise<WebSearchResponse> {
  const params = new URLSearchParams({
    ...commonParams(config),
    query,
  });

  const url = `${buildBaseUrl(config)}/search-api?${params.toString()}`;
  const data = await miyamiFetch(url);

  const rawResults: Array<{
    url?: string;
    title?: string;
    content?: string;
    engine?: string;
  }> = (data.results as any[]) || [];

  const results: WebSearchResult[] = rawResults
    .filter((r) => r.url && r.title)
    .slice(0, config.maxResults)
    .map((r) => ({
      title: r.title || "",
      url: r.url || "",
      description: r.content || "",
      engine: r.engine || "",
    }));

  const answers: string[] = (data.answers as string[]) || [];
  const suggestions: string[] = (data.suggestions as string[]) || [];
  const infoboxes: Array<{ title: string; content: string }> = ((data.infoboxes as any[]) || [])
    .filter((ib) => ib.title || ib.content)
    .map((ib) => ({ title: ib.title || "", content: ib.content || "" }));

  log.info(`Search for "${query}": ${results.length} results, ${answers.length} answers`);

  return { query, results, answers, suggestions, infoboxes };
}

export async function fetchWebpage(targetUrl: string, config: WebSearchConfig): Promise<FetchWebpageResponse> {
  const params = new URLSearchParams({
    ...commonParams(config),
    url: targetUrl,
    format: "markdown",
  });

  const url = `${buildBaseUrl(config)}/fetch?${params.toString()}`;
  const data = await miyamiFetch(url, 30000); // 30s timeout for page fetch

  const title = (data.metadata as any)?.title || (data.url as string) || targetUrl;
  const content = (data.content as string) || "";
  const wordCount = (data.stats as any)?.word_count || 0;

  log.info(`Fetched ${targetUrl}: ${wordCount} words`);

  return { url: (data.url as string) || targetUrl, title, content, wordCount };
}

export async function searchAndFetchApi(
  query: string,
  config: WebSearchConfig,
  numResults = 3,
): Promise<SearchAndFetchResult> {
  const params = new URLSearchParams({
    ...commonParams(config),
    query,
    num_results: String(Math.min(Math.max(numResults, 1), 5)),
    format: "markdown",
  });

  const url = `${buildBaseUrl(config)}/search-and-fetch?${params.toString()}`;
  const data = await miyamiFetch(url, 60000); // 60s timeout — fetching multiple pages

  const results: SearchAndFetchResult["results"] = ((data.results as any[]) || []).map((r) => ({
    title: r.search_result?.title || "",
    url: r.search_result?.url || "",
    snippet: r.search_result?.snippet || "",
    content: r.fetched_content?.content || "",
    wordCount: r.fetched_content?.word_count || 0,
    fetchStatus: r.fetch_status || "unknown",
  }));

  const successful = results.filter((r) => r.fetchStatus === "success").length;
  log.info(`Search-and-fetch for "${query}": ${results.length} results, ${successful} fetched`);

  return { query, results };
}

export async function deepResearchApi(queries: string[], config: WebSearchConfig): Promise<DeepResearchResponse> {
  const params = new URLSearchParams({
    ...commonParams(config),
    queries: queries.join(","),
    breadth: "3",
  });

  const url = `${buildBaseUrl(config)}/deep-research?${params.toString()}`;
  const data = await miyamiFetch(url, 120000); // 120s timeout — heavy operation

  const compiledReport = (data.compiled_report as string) || "";
  const totalResults = (data.research_summary as any)?.total_results_found || 0;
  const successfulFetches = (data.research_summary as any)?.total_successful_fetches || 0;

  log.info(`Deep research for [${queries.join(", ")}]: ${totalResults} results, ${successfulFetches} fetched`);

  return { queries, compiledReport, totalResults, successfulFetches };
}

export async function crawlSiteApi(
  startUrl: string,
  config: WebSearchConfig,
  maxPages = 5,
  maxDepth = 1,
): Promise<CrawlSiteResponse> {
  const params = new URLSearchParams({
    ...commonParams(config),
    start_url: startUrl,
    max_pages: String(Math.min(Math.max(maxPages, 1), 200)),
    max_depth: String(Math.min(Math.max(maxDepth, 0), 5)),
    format: "markdown",
  });

  const url = `${buildBaseUrl(config)}/crawl-site?${params.toString()}`;
  const data = await miyamiFetch(url, 120000); // 120s timeout — heavy operation

  const pages: CrawlSiteResponse["pages"] = ((data.pages as any[]) || []).map((p) => ({
    url: p.url || "",
    title: p.metadata?.title || "",
    content: p.content || "",
    wordCount: p.word_count || 0,
    depth: p.depth || 0,
  }));

  const pagesCrawled = (data.crawl_summary as any)?.pages_crawled || pages.length;
  const totalWords = (data.total_words as number) || 0;

  log.info(`Crawled ${startUrl}: ${pagesCrawled} pages, ${totalWords} total words`);

  return { startUrl, pagesCrawled, pages, totalWords };
}

const MAX_CONTENT_LENGTH = 4000;

/**
 * Format web search results for LLM injection.
 */
export function formatSearchResults(query: string, searches: WebSearchResponse[]): string {
  const parts: string[] = [];
  const allResults: WebSearchResult[] = [];
  const allAnswers: string[] = [];
  const allSuggestions: string[] = [];

  for (const search of searches) {
    allResults.push(...search.results);
    allAnswers.push(...search.answers);
    allSuggestions.push(...search.suggestions);
  }

  if (allAnswers.length > 0) parts.push(`Quick answers: ${allAnswers.join("; ")}`);

  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i];
    parts.push(`${i + 1}. ${r.title}\n   ${r.url}\n   ${truncate(r.description, 300)}`);
  }

  if (allSuggestions.length > 0) parts.push(`Related searches: ${allSuggestions.slice(0, 3).join(", ")}`);

  if (parts.length === 0) return `[SEARCH RESULTS FOR: "${query}"]\nNo results found.`;
  return `[SEARCH RESULTS FOR: "${query}"]\n${parts.join("\n\n")}`;
}

/**
 * Format fetched webpage content for LLM injection.
 */
export function formatFetchResult(result: FetchWebpageResponse): string {
  const content = truncate(result.content, MAX_CONTENT_LENGTH);
  return `[FETCHED WEBPAGE: ${result.title}]\nURL: ${result.url}\nWord count: ${result.wordCount}\n\n${content}`;
}

/**
 * Format search-and-fetch results for LLM injection.
 */
export function formatSearchAndFetchResult(result: SearchAndFetchResult): string {
  const parts: string[] = [];
  for (const r of result.results) {
    if (r.fetchStatus === "success" && r.content) {
      parts.push(`${r.title}\nURL: ${r.url}\n${truncate(r.content, MAX_CONTENT_LENGTH)}`);
    } else {
      parts.push(`${r.title}\nURL: ${r.url}\n(fetch failed: ${r.fetchStatus})`);
    }
  }
  if (parts.length === 0) return `[SEARCH-AND-FETCH FOR: "${result.query}"]\nNo usable results.`;
  return `[SEARCH-AND-FETCH FOR: "${result.query}"]\n${parts.join("\n\n---\n\n")}`;
}

/**
 * Format deep research results for LLM injection.
 */
export function formatDeepResearchResult(result: DeepResearchResponse): string {
  const report = truncate(result.compiledReport, MAX_CONTENT_LENGTH * 2);
  return `[DEEP RESEARCH FOR: ${result.queries.join(", ")}]\nResults found: ${result.totalResults} | Fetched: ${result.successfulFetches}\n\n${report}`;
}

/**
 * Format site crawl results for LLM injection.
 */
export function formatCrawlResult(result: CrawlSiteResponse): string {
  const parts = result.pages.slice(0, 10).map((p, i) => {
    return `${i + 1}. ${p.title}\n   URL: ${p.url} (depth ${p.depth}, ${p.wordCount} words)\n   ${truncate(p.content, 800)}`;
  });
  return `[CRAWL OF ${result.startUrl}]\nPages crawled: ${result.pagesCrawled} | Total words: ${result.totalWords}\n\n${parts.join("\n\n")}`;
}
