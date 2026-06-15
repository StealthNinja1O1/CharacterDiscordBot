import { webSearchConfig } from "../../config";
import {
  searchWeb,
  fetchWebpage,
  searchAndFetchApi,
  deepResearchApi,
  crawlSiteApi,
  formatSearchResults,
  formatFetchResult,
  formatSearchAndFetchResult,
  formatDeepResearchResult,
  formatCrawlResult,
} from "../../api/websearch";
import type { CommandDef } from "../registry";

/**
 * All web-search commands share the same process: LLM emits one, its reply is sent immediately, the tool runs, then the LLM is
 * re-prompted with the tool's output to produce a follow-up answer.
 *
 * They return the formatted tool result text rather than a CommandResult.
 */
type RecursiveResult = string;

export const webSearchCommand: CommandDef<{ query: string }, RecursiveResult> = {
  name: "webSearch",
  args: { query: "string" },
  description: `Search the web for information using a search engine. Use this when you need factual information you are not sure about, need to look something up, or want to verify facts. Your reply before this command will be sent first, then you will receive search results and can give an informed follow-up answer.`,
  kind: "recursive",
  enabled: () => webSearchConfig.enabled,
  execute: async (argsRaw) => {
    const { query } = argsRaw as { query: string };
    if (!query) throw new Error("Missing query");
    const result = await searchWeb(query, webSearchConfig);
    return formatSearchResults(query, [result]);
  },
};

export const fetchWebpageCommand: CommandDef<{ url: string }, RecursiveResult> = {
  name: "fetchWebpage",
  args: { url: "string" },
  description: `Fetch and extract the full content of a specific webpage in markdown format. Use when you have a URL and need the actual page content, not just a search snippet. Good for reading articles, documentation, or reference pages.`,
  kind: "recursive",
  enabled: () => webSearchConfig.enabled,
  execute: async (argsRaw) => {
    const { url } = argsRaw as { url: string };
    if (!url) throw new Error("Missing url");
    const result = await fetchWebpage(url, webSearchConfig);
    return formatFetchResult(result);
  },
};

export const searchAndFetchCommand: CommandDef<{ query: string; num_results?: number }, RecursiveResult> = {
  name: "searchAndFetch",
  args: { query: "string", num_results: "number (1-5, default 3)" },
  description: `Search the web AND fetch full page content from the top results. More thorough than webSearch (which only returns snippets). Use when you need detailed information from multiple sources. Slower but much more comprehensive.`,
  kind: "recursive",
  enabled: () => webSearchConfig.enabled,
  execute: async (argsRaw) => {
    const { query, num_results } = argsRaw as { query: string; num_results?: number };
    if (!query) throw new Error("Missing query");
    const numResults = num_results ? Math.min(Math.max(num_results, 1), 5) : 3;
    const result = await searchAndFetchApi(query, webSearchConfig, numResults);
    return formatSearchAndFetchResult(result);
  },
};

export const deepResearchCommand: CommandDef<{ queries: string[] }, RecursiveResult> = {
  name: "deepResearch",
  args: { queries: ["query1", "query2", "..."] },
  description: `Perform deep multi-query research in parallel. Provide up to 10 search queries and get a compiled research report. Best for complex topics that need multiple angles. Slowest but most thorough option.`,
  kind: "recursive",
  enabled: () => webSearchConfig.enabled,
  execute: async (argsRaw) => {
    const { queries } = argsRaw as { queries: string[] };
    if (!queries || !Array.isArray(queries) || queries.length === 0)
      throw new Error("Missing or invalid queries array");
    const sliced = queries.slice(0, 10);
    const result = await deepResearchApi(sliced, webSearchConfig);
    return formatDeepResearchResult(result);
  },
};

export const crawlSiteCommand: CommandDef<
  { start_url: string; max_pages?: number; max_depth?: number },
  RecursiveResult
> = {
  name: "crawlSite",
  args: { start_url: "string", max_pages: "number (1-200, default 5)", max_depth: "number (0-5, default 1)" },
  description: `Crawl an entire website recursively and extract content from multiple pages. Use for documentation sites, wikis, or when you need comprehensive info from a single source. Very slow, use only when really needed.`,
  kind: "recursive",
  enabled: () => webSearchConfig.enabled,
  execute: async (argsRaw) => {
    const { start_url, max_pages, max_depth } = argsRaw as {
      start_url: string;
      max_pages?: number;
      max_depth?: number;
    };
    if (!start_url) throw new Error("Missing start_url");
    const maxPages = max_pages ? Math.min(Math.max(max_pages, 1), 200) : 5;
    const maxDepth = max_depth ? Math.min(Math.max(max_depth, 0), 5) : 1;
    const result = await crawlSiteApi(start_url, webSearchConfig, maxPages, maxDepth);
    return formatCrawlResult(result);
  },
};
