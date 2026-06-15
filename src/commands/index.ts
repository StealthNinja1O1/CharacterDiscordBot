/**
 * Command registration entry point.
 *
 * Importing this module registers every command with the singleton registry.
 * To add a new command: create a file exporting a `CommandDef`, then add an
 * import + `register()` call below.
 */

import { commandRegistry, type CommandDef } from "./registry";
import { config } from "../config";

import { reactCommand } from "./base/react";
import { renameSelfCommand, renameUserCommand, setBioCommand } from "./base/rename";
import { postStickerCommand } from "./base/postSticker";
import { editOrAddToLorebookCommand } from "./base/editMemory";

// External-service command modules
import { generateImageCommand } from "./comfyui/index";
import {
  webSearchCommand,
  fetchWebpageCommand,
  searchAndFetchCommand,
  deepResearchCommand,
  crawlSiteCommand,
} from "./websearch/index";

const allCommands: CommandDef<any, any>[] = [
  reactCommand,
  renameSelfCommand,
  renameUserCommand,
  postStickerCommand,
  editOrAddToLorebookCommand,
  setBioCommand,
  generateImageCommand,
  webSearchCommand,
  fetchWebpageCommand,
  searchAndFetchCommand,
  deepResearchCommand,
  crawlSiteCommand,
];

for (const def of allCommands) commandRegistry.register(def);

export { commandRegistry } from "./registry";
export type { CommandDef, CommandKind, CommandResult, AsyncCommandResult } from "./registry";

/**
 * Commands to advertise in the LLM system prompt.
 */
export const availableCommands = commandRegistry
  .enabledCommands(config)
  .map((c) => {
    if (!c.enabled(config)) return null;
    const out: Record<string, unknown> = {
      name: c.name,
      args: c.args,
      description: c.description,
      enabled: true,
    };
    if (c.kind === "recursive") out.isRecursive = true;
    return out;
  })
  .filter((c): c is Record<string, unknown> => c !== null);

export const RECURSIVE_COMMAND_NAMES = commandRegistry.recursiveNames();
