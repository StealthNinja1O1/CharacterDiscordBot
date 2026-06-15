import type { AppConfig } from "../config.js";
import type { Message } from "discord.js";
import type { ChatMemoryBook } from "../models.js";

export type CommandKind = "instant" | "async" | "recursive";

/**
 * Runtime context handed to every command's `execute`.
 * Optional fields are only present when the call site has them
 * (/ask has no `message` because there's nothing to react to)
 */
export interface CommandExecutionContext {
  message: Message | null;
  chatMemoryBook?: ChatMemoryBook;
  chatMemoryBookPath?: string;
  onChatMemoryUpdate?: (book: ChatMemoryBook) => void;
}

export interface CommandResult {
  success: boolean;
  message: string;
}

export interface AsyncCommandResult extends CommandResult {
  attachment?: { buffer: Buffer; name: string };
  prompt?: string;
  orientation?: string;
}

/**
 * Return type of a command's `execute`
 * - instant/async: CommandResult (or AsyncCommandResult)
 * - recursive: string (tool result text fed back)
 */
export type CommandExecuteResult = CommandResult | string;

export interface CommandDef<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult extends CommandExecuteResult = CommandExecuteResult,
> {
  name: string;
  args: Record<string, unknown>;
  description: string;
  kind: CommandKind;
  enabled: (config: AppConfig) => boolean;
  execute: (args: TArgs, ctx: CommandExecutionContext) => Promise<TResult>;
}

/**
 * The registry. Modules call `register(def)` at import time; the dispatch
 * layer and system-prompt builder read from `list()` / `get(name)`.
 */
class CommandRegistry {
  private commands = new Map<string, CommandDef>();

  register<T extends CommandDef>(def: T): void {
    if (this.commands.has(def.name)) throw new Error(`Command "${def.name}" is registered more than once`);
    this.commands.set(def.name, def as CommandDef);
  }

  get(name: string): CommandDef | undefined {
    return this.commands.get(name);
  }

  list(): CommandDef[] {
    return [...this.commands.values()];
  }

  enabledCommands(config: AppConfig): CommandDef[] {
    return this.list().filter((c) => c.enabled(config));
  }

  recursiveNames(): string[] {
    return this.list()
      .filter((c) => c.kind === "recursive")
      .map((c) => c.name);
  }
}

export const commandRegistry = new CommandRegistry();
