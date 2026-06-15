import type { Message } from "discord.js";
import type { CommandDef, CommandResult } from "../registry.js";

/** React to the message that triggered the bot's response. */
async function react(args: { emoji: string }, message: Message | null): Promise<CommandResult> {
  const { emoji } = args;

  if (!message) return { success: false, message: "No message to react to (command run without context)" };
  if (!emoji || typeof emoji !== "string") return { success: false, message: "Invalid emoji argument" };

  try {
    // Custom emoji format: name:id or <a:name:id>
    const customEmojiMatch = emoji.match(/^<?(a)?:?(\w{2,32}):(\d{17,19})>?$/);
    if (customEmojiMatch) {
      const emojiId = customEmojiMatch[3];
      const guildEmoji = message.guild?.emojis.cache.get(emojiId);
      if (guildEmoji) {
        await message.react(guildEmoji);
        return { success: true, message: `Reacted with custom emoji ${emoji}` };
      }
      return { success: false, message: `Custom emoji ${emoji} not found in this server` };
    }

    // Unicode emoji
    await message.react(emoji);
    return { success: true, message: `Reacted with ${emoji}` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to react: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const reactCommand: CommandDef<{ emoji: string }> = {
  name: "react",
  args: { emoji: "string" },
  description:
    "React to the previous message with the specified emoji. Use official Discord emojis or custom ones from the server (format: emojiName:emojiId).",
  kind: "instant",
  enabled: () => true,
  execute: async (args, ctx) => react(args as { emoji: string }, ctx.message),
};
