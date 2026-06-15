import type { Message, TextChannel } from "discord.js";
import type { CommandDef, CommandResult } from "../registry";

/** Send a sticker from the server. */
async function postSticker(args: { stickerName: string }, message: Message | null): Promise<CommandResult> {
  const { stickerName } = args;
  if (!stickerName || typeof stickerName !== "string") {
    return { success: false, message: "Invalid stickerName argument" };
  }
  if (!message?.guild) return { success: false, message: "Cannot send stickers outside of a server" };
  if (!message.channel.isTextBased()) return { success: false, message: "Cannot send stickers in this channel type" };

  try {
    const stickers = await message.guild.stickers.fetch();
    const sticker = stickers.find((s) => s.name.toLowerCase() === stickerName.toLowerCase());
    if (!sticker) return { success: false, message: `Sticker "${stickerName}" not found in this server` };

    const channel = message.channel as TextChannel;
    await channel.send({ stickers: [sticker] });
    return { success: true, message: `Sent sticker "${sticker.name}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send sticker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const postStickerCommand: CommandDef<{ stickerName: string }> = {
  name: "postSticker",
  args: { stickerName: "string" },
  description: "Send a sticker from the server. Use the exact sticker name from the available stickers list.",
  kind: "instant",
  enabled: () => true,
  execute: async (args, ctx) => postSticker(args as { stickerName: string }, ctx.message),
};
