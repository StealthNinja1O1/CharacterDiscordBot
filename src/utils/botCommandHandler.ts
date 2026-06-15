/**
 * Bot Command Dispatch
 *
 * Thin layer over the command registry. The actual command implementations live in `src/commands/`.
 *   - splits commands by lifecycle (instant / async)
 *   - runs instant commands before the reply is sent
 *   - runs async commands after the reply is sent
 * Recursive commands (webSearch, etc.) are NOT handled here but in `recursiveCommandHandler.ts`
 */

import { BotCommand, Character } from "../models";
import type { ChatMemoryBook } from "../models";
import type { Message } from "discord.js";
import { commandRegistry } from "../commands/index";
import type { CommandResult, AsyncCommandResult, CommandExecutionContext } from "../commands/registry";
import { AttachmentData } from "./ResponseContexts";
import { log } from "./logger";

export type { CommandResult, AsyncCommandResult, AttachmentData };

export type CommandContext = {
  message: Message | null;
  character: Character;
  chatMemoryBook?: ChatMemoryBook;
  chatMemoryBookPath?: string;
  onChatMemoryUpdate?: (book: ChatMemoryBook) => void;
};

function toExecCtx(ctx: CommandContext): CommandExecutionContext {
  return {
    message: ctx.message,
    chatMemoryBook: ctx.chatMemoryBook,
    chatMemoryBookPath: ctx.chatMemoryBookPath,
    onChatMemoryUpdate: ctx.onChatMemoryUpdate,
  };
}

/**
 * Split commands into instant (synchronous, before reply) and async
 * (after reply, produce attachments).
 */
export function splitCommands(commands: BotCommand[]) {
  const asyncNames = new Set(
    commandRegistry
      .list()
      .filter((c) => c.kind === "async")
      .map((c) => c.name),
  );
  return {
    instant: commands.filter((c) => !asyncNames.has(c.name)),
    async: commands.filter((c) => asyncNames.has(c.name)),
  };
}

/**
 * Execute instant commands (react, rename, sticker, lorebook edit, setBio).
 * Runs synchronously before the text reply is sent.
 */
export async function executeInstantCommands(
  commands: BotCommand[],
  context: CommandContext,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  const execCtx = toExecCtx(context);

  for (const cmd of commands) {
    const def = commandRegistry.get(cmd.name);
    if (!def || def.kind !== "instant") {
      if (def && def.kind === "recursive") {
        results.push({
          success: false,
          message: `${cmd.name} should be handled by the recursion loop (max depth reached or not enabled)`,
        });
      } else results.push({ success: false, message: `Unknown command: ${cmd.name}` });

      continue;
    }

    try {
      const result = (await def.execute(cmd.args as Record<string, unknown>, execCtx)) as CommandResult;
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, message: `Error executing ${cmd.name}: ${errorMsg}` });
      log.error(`Error executing command ${cmd.name}:`, error);
    }
  }

  return results;
}

/**
 * Execute async commands (generateImage). Runs after the text reply is sent.
 * Results may carry file attachments sent as follow-ups.
 */
export async function executeAsyncCommands(
  commands: BotCommand[],
  context: CommandContext,
): Promise<AsyncCommandResult[]> {
  const results: AsyncCommandResult[] = [];
  const execCtx = toExecCtx(context);

  for (const cmd of commands) {
    const def = commandRegistry.get(cmd.name);
    if (!def || def.kind !== "async") {
      results.push({ success: false, message: `Unknown async command: ${cmd.name}` });
      continue;
    }

    try {
      const result = (await def.execute(cmd.args as Record<string, unknown>, execCtx)) as AsyncCommandResult;
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, message: `Error executing ${cmd.name}: ${errorMsg}` });
      log.error(`Error executing async command ${cmd.name}:`, error);
    }
  }

  return results;
}
