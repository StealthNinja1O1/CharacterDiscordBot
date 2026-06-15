import { BotCommand } from "../models.js";
import { RECURSIVE_COMMAND_NAMES, commandRegistry } from "../commands/index.js";
import type { CommandExecutionContext } from "../commands/registry.js";
import { ResponseContext } from "./ResponseContexts.js";
import { splitCommands } from "./botCommandHandler.js";
import { generateFollowUpResponse } from "../tools/prompt.js";
import { parseAIResponse } from "../utils/responseParser.js";
import { commandMetadataStore } from "../tools/commandMetadata.js";
import { log } from "../utils/logger.js";

export interface RecursiveCommandResult {
  reply: string;
  remainingInstant: BotCommand[];
  asyncCommands: BotCommand[];
  finalCommands: BotCommand[];
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
  execCtx?: CommandExecutionContext;
}

/**
 * Execute a single recursive command via the registry and return its
 * formatted text output, ready for injection
 */
export async function executeRecursiveCommand(cmd: BotCommand, execCtx?: CommandExecutionContext): Promise<string> {
  const def = commandRegistry.get(cmd.name);
  if (!def || def.kind !== "recursive") throw new Error(`Unknown recursive command: ${cmd.name}`);

  log.info(`${cmd.name}: ${JSON.stringify(cmd.args).slice(0, 120)}`);
  const result = await def.execute(cmd.args as Record<string, unknown>, execCtx ?? ({} as CommandExecutionContext));
  if (typeof result !== "string") throw new Error(`Recursive command ${cmd.name} returned non-string result`);

  return result;
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
    execCtx,
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
        const resultText = await executeRecursiveCommand(cmd, execCtx);
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
