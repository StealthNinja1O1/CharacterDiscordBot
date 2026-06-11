import { BotCommand } from "../models.js";
import { availableCommands, SearxngConfig, searxngConfig } from "../config.js";
import { ResponseContext } from "./ResponseContexts.js";
import { splitCommands } from "./botCommandHandler.js";
import { generateFollowUpResponse } from "../tools/prompt.js";
import { parseAIResponse } from "../utils/responseParser.js";
import { commandMetadataStore } from "../tools/commandMetadata.js";
import { log } from "../utils/logger.js";
import {
  searchSearxng,
  fetchWebpage,
  searchAndFetchApi,
  deepResearchApi,
  crawlSiteApi,
  formatSearchResults,
  formatFetchResult,
  formatSearchAndFetchResult,
  formatDeepResearchResult,
  formatCrawlResult,
} from "../api/searxng.js";

export const RECURSIVE_COMMAND_NAMES = availableCommands.filter((c) => c.isRecursive).map((c) => c.name);

export interface RecursiveCommandResult {
  reply: string;
  /** Non-recursive instant commands collected from all iterations */
  remainingInstant: BotCommand[];
  /** Async commands collected from all iterations */
  asyncCommands: BotCommand[];
  /** All commands from the final LLM response (for metadata recording) */
  finalCommands: BotCommand[];
  /** Whether an intermediate reply was sent during recursion */
  replySent: boolean;
}

export interface ProcessRecursiveOptions {
  llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  temperature: number;
  initialResponse: string;
  initialReply: string;
  commands: BotCommand[];
  maxRecursionDepth: number;
  addNothink: boolean;
  channelId: string;
  ctx: ResponseContext;
  searchConfig?: SearxngConfig;
}

/**
 * Execute a single recursive command and return formatted text results
 * ready for injection into the LLM context.
 */
export async function executeRecursiveCommand(cmd: BotCommand, config: SearxngConfig = searxngConfig): Promise<string> {
  switch (cmd.name) {
    case "webSearch": {
      const args = cmd.args as { query: string };
      if (!args.query) throw new Error("Missing query");
      log.info(`webSearch: "${args.query}"`);
      const result = await searchSearxng(args.query, config);
      return formatSearchResults(args.query, [result]);
    }

    case "fetchWebpage": {
      const args = cmd.args as { url: string };
      if (!args.url) throw new Error("Missing url");
      log.info(`fetchWebpage: ${args.url}`);
      const result = await fetchWebpage(args.url, config);
      return formatFetchResult(result);
    }

    case "searchAndFetch": {
      const args = cmd.args as { query: string; num_results?: number };
      if (!args.query) throw new Error("Missing query");
      const numResults = args.num_results ? Math.min(Math.max(args.num_results, 1), 5) : 3;
      log.info(`searchAndFetch: "${args.query}" (${numResults} results)`);
      const result = await searchAndFetchApi(args.query, config, numResults);
      return formatSearchAndFetchResult(result);
    }

    case "deepResearch": {
      const args = cmd.args as { queries: string[] };
      if (!args.queries || !Array.isArray(args.queries) || args.queries.length === 0) {
        throw new Error("Missing or invalid queries array");
      }
      const queries = args.queries.slice(0, 10); // max 10 queries
      log.info(`deepResearch: [${queries.join(", ")}]`);
      const result = await deepResearchApi(queries, config);
      return formatDeepResearchResult(result);
    }

    case "crawlSite": {
      const args = cmd.args as { start_url: string; max_pages?: number; max_depth?: number };
      if (!args.start_url) throw new Error("Missing start_url");
      const maxPages = args.max_pages ? Math.min(Math.max(args.max_pages, 1), 200) : 5;
      const maxDepth = args.max_depth ? Math.min(Math.max(args.max_depth, 0), 5) : 1;
      log.info(`crawlSite: ${args.start_url} (pages: ${maxPages}, depth: ${maxDepth})`);
      const result = await crawlSiteApi(args.start_url, config, maxPages, maxDepth);
      return formatCrawlResult(result);
    }

    default:
      throw new Error(`Unknown recursive command: ${cmd.name}`);
  }
}

export async function processRecursiveCommands(options: ProcessRecursiveOptions): Promise<RecursiveCommandResult> {
  const {
    llmMessages,
    model,
    temperature,
    initialResponse,
    initialReply,
    commands,
    maxRecursionDepth,
    addNothink,
    channelId,
    ctx,
    searchConfig = searxngConfig,
  } = options;

  const { instant, async: asyncCmds } = splitCommands(commands);

  let remainingInstant = instant.filter((c) => !RECURSIVE_COMMAND_NAMES.includes(c.name));
  let recursiveCmds = commands.filter((c) => RECURSIVE_COMMAND_NAMES.includes(c.name));
  let asyncCommands = [...asyncCmds];
  let reply = initialReply;
  let replySent = false;
  let currentCommands: BotCommand[] = commands;

  for (let depth = 0; depth < maxRecursionDepth && recursiveCmds.length > 0; depth++) {
    if (reply && reply.trim()) {
      const msgId = await ctx.sendReply(reply);
      replySent = true;
      commandMetadataStore.record(msgId, channelId, currentCommands);
    }

    const toolResultParts: string[] = [];

    for (const cmd of recursiveCmds) {
      try {
        const resultText = await executeRecursiveCommand(cmd, searchConfig);
        toolResultParts.push(resultText);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.warn(`Recursive command ${cmd.name} failed: ${errMsg}`);
        toolResultParts.push(`[${cmd.name.toUpperCase()} FAILED: ${errMsg}]`);
      }
    }

    const toolResultContent = toolResultParts.join("\n\n---\n\n");

    try {
      const followUpResponse = await generateFollowUpResponse(
        llmMessages,
        model,
        temperature,
        initialResponse,
        toolResultContent,
        addNothink,
      );
      log.debug(`Follow-up LLM response (depth ${depth + 1}): ${followUpResponse}`);

      const followUpParsed = parseAIResponse(followUpResponse);
      reply = followUpParsed.reply;

      // Merge new commands
      const newCommands = followUpParsed.commands || [];
      const newSplit = splitCommands(newCommands);

      const newInstant = newSplit.instant.filter((c) => !RECURSIVE_COMMAND_NAMES.includes(c.name));
      remainingInstant.push(...newInstant);
      asyncCommands.push(...newSplit.async);
      recursiveCmds = newCommands.filter((c) => RECURSIVE_COMMAND_NAMES.includes(c.name));
      currentCommands = newCommands;
    } catch (error) {
      log.error(`Follow-up LLM call failed (depth ${depth + 1}):`, error);
      break;
    }
  }

  if (recursiveCmds.length > 0) {
    log.warn(
      `Max recursion depth (${maxRecursionDepth}) reached. ignoring ${recursiveCmds.length} remaining command(s): ${recursiveCmds.map((c) => c.name).join(", ")}`,
    );
  }

  return { reply, remainingInstant, asyncCommands, finalCommands: currentCommands, replySent };
}
