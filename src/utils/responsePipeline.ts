/**
 * Unified Response Pipeline, aka code dedupe lol
 *
 * All entry points (chat message, "Ask Character" context-menu, /ask) go here
 *
 *   parse response -> recursive commands -> instant commands -> send reply ->
 *   async commands -> record metadata
 */

import { AttachmentBuilder, Message } from "discord.js";
import { parseAIResponse } from "./responseParser.js";
import { processRecursiveCommands } from "./recursiveCommandHandler.js";
import {
  executeInstantCommands,
  executeAsyncCommands,
  type CommandContext,
} from "./botCommandHandler.js";
import { commandMetadataStore } from "../tools/commandMetadata.js";
import { comfyuiConfig } from "../config.js";
import type { ResponseContext } from "./ResponseContexts.js";
import type { CommandExecutionContext } from "../commands/registry.js";
import type { Character, ChatMemoryBook } from "../models.js";
import { log } from "./logger.js";

export interface ResponsePipelineOptions {
  rawResponse: string;
  llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  temperature: number;
  ctx: ResponseContext;
  channelId: string;
  maxRecursionDepth: number;
  addNothink: boolean;
  message: Message | null;
  character: Character;
  chatMemoryBook?: ChatMemoryBook;
  chatMemoryBookPath?: string;
  onChatMemoryUpdate?: (book: ChatMemoryBook) => void;
  onAsyncStart?: () => void;
  onAsyncEnd?: () => void;
}

/**
 * Run the full post-LLM response pipeline.
 * Returns the final reply message ID
 */
export async function runResponsePipeline(opts: ResponsePipelineOptions): Promise<string | undefined> {
  const {
    rawResponse,
    llmMessages,
    model,
    temperature,
    ctx,
    channelId,
    maxRecursionDepth,
    addNothink,
    message,
    character,
    chatMemoryBook,
    chatMemoryBookPath,
    onChatMemoryUpdate,
    onAsyncStart,
    onAsyncEnd,
  } = opts;

  const parsed = parseAIResponse(rawResponse);
  const allCommands = parsed.commands || [];

  const execCtx: CommandExecutionContext = {
    message,
    chatMemoryBook,
    chatMemoryBookPath,
    onChatMemoryUpdate,
  };

  const {
    reply,
    remainingInstant,
    asyncCommands,
    finalCommands,
    replySent,
  } = await processRecursiveCommands({
    llmMessages,
    model,
    temperature,
    initialResponse: rawResponse,
    initialReply: parsed.reply,
    commands: allCommands,
    maxRecursionDepth,
    addNothink,
    channelId,
    ctx,
    execCtx,
  });

  if (remainingInstant.length > 0) {
    const cmdCtx: CommandContext = {
      message,
      character,
      chatMemoryBook,
      chatMemoryBookPath,
      onChatMemoryUpdate,
    };
    const instantResults = await executeInstantCommands(remainingInstant, cmdCtx);
    for (const result of instantResults) {
      if (result.success) log.info(`Command: ${result.message}`);
      else log.warn(`Command failed: ${result.message}`);
    }
  }

  let finalMsgId: string | undefined;
  if (reply && reply.trim()) {
    finalMsgId = replySent ? await ctx.sendFollowUp(reply) : await ctx.sendReply(reply);
    commandMetadataStore.record(finalMsgId, channelId, finalCommands);
  }

  if (asyncCommands.length > 0) {
    onAsyncStart?.();
    try {
      const cmdCtx: CommandContext = {
        message,
        character,
        chatMemoryBook,
        chatMemoryBookPath,
        onChatMemoryUpdate,
      };
      const asyncResults = await executeAsyncCommands(asyncCommands, cmdCtx);
      for (const result of asyncResults) {
        if (result.success && result.attachment) {
          const file = new AttachmentBuilder(result.attachment.buffer, { name: result.attachment.name });
          const followUpText =
            comfyuiConfig.includePromptInMessage && result.prompt
              ? `image: ${result.prompt}, ${result.orientation ?? "square"}`
              : "";
          await ctx.sendFollowUp(followUpText, [file]);
          log.info(`Async command: ${result.message}`);
        } else if (result.success) {
          log.info(`Async command: ${result.message}`);
        } else {
          await ctx.sendFollowUp("*[The static interfered with the image generation...]*");
          log.warn(`Async command failed: ${result.message}`);
        }
      }
    } finally {
      onAsyncEnd?.();
    }
  }

  return finalMsgId;
}
