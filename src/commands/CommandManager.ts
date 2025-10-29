import { EventEmitter } from "events";
import { REST } from "discord.js";
import { Routes, SlashCommandBuilder } from "discord.js";
import { discordConfig } from "../config.js";

export type CommandEventPayload =
  | { type: "togglerandom" }
  | { type: "togglementions" }
  | { type: "togglebot" }
  | { type: "update"; fileUrl: string; filename: string }
  | { type: "lorebook" };

export class CommandManager extends EventEmitter {
  rest: REST;

  constructor() {
    super();
    this.rest = new REST({ version: "10" }).setToken(discordConfig.botToken);
  }

  async registerCommands(applicationId: string) {
    const commands = [
      new SlashCommandBuilder().setName("togglerandom").setDescription("Toggle random responses"),
  new SlashCommandBuilder().setName("togglementions").setDescription("Toggle replies to mentions"),
  new SlashCommandBuilder().setName("togglebot").setDescription("Enable/disable bot responses"),
      new SlashCommandBuilder()
        .setName("update")
        .setDescription("Upload a new character JSON file to update the bot")
        .addAttachmentOption((opt) => opt.setName("file").setDescription("Character JSON file").setRequired(true)),
        new SlashCommandBuilder().setName("lorebook").setDescription("Browse or edit the lorebook"),
        new SlashCommandBuilder()
          .setName("configure")
          .setDescription("Configure runtime bot behavior")
          .addIntegerOption((o) => o.setName("random_response_rate").setDescription("Random response rate (1 in N). Set 0 to disable").setRequired(false))
          .addIntegerOption((o) => o.setName("max_history_messages").setDescription("Max history messages to include").setRequired(false))
          .addIntegerOption((o) => o.setName("max_context_tokens").setDescription("Max tokens for context").setRequired(false))
          .addBooleanOption((o) => o.setName("ignore_other_bots").setDescription("Ignore other bots").setRequired(false))
          .addStringOption((o) => o.setName("trigger_keywords").setDescription("Comma-separated trigger keywords").setRequired(false))
          .addBooleanOption((o) => o.setName("add_timestamps").setDescription("Add timestamps to messages").setRequired(false))
          .addIntegerOption((o) => o.setName("min_response_interval_seconds").setDescription("Minimum seconds to wait before responding again").setRequired(false)),
    ].map((c) => c.toJSON());

    try {
      await this.rest.put(Routes.applicationCommands(applicationId), { body: commands });
      console.log("Commands registered");
    } catch (err) {
      console.error("Failed to register commands:", err);
    }
  }

  // Emit a command event after verifying the caller is an allowed admin
  emitCommand(command: string, payload?: any) {
    // The actual permission check (user ID) is handled in index.ts before calling emitCommand
    this.emit("command", payload || { type: command });
  }
}

export default CommandManager;
