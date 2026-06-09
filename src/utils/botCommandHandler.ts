import { Message, GuildMember } from "discord.js";
import { BotCommand, Character, LorebookEntry } from "../models.js";
import { writeFileSync, readFileSync } from "fs";
import { discordConfig } from "../config.js";
import { ChatMemoryBook, upsertChatMemoryEntry, saveChatMemoryBook } from "../tools/chatMemoryBook.js";
import { log } from "./logger.js";
import { generateImage } from "../api/comfyui.js";
import { AttachmentData } from "./ResponseContexts.js";

interface CommandResult {
  success: boolean;
  message: string;
}

export interface AsyncCommandResult {
  success: boolean;
  message: string;
  attachment?: AttachmentData;
  prompt?: string;
  orientation?: string;
}

/** Commands that require async execution and produce follow-up results */
const ASYNC_COMMAND_NAMES = ["generateImage"];

/**
 * Split commands into instant (execute synchronously before reply)
 * and async (execute after reply, results sent as follow-up).
 */
export function splitCommands(commands: BotCommand[]) {
  return {
    instant: commands.filter((c) => !ASYNC_COMMAND_NAMES.includes(c.name)),
    async: commands.filter((c) => ASYNC_COMMAND_NAMES.includes(c.name)),
  };
}

export type CommandContext = {
  message: Message;
  character: Character;
  characterFilePath?: string;
  chatMemoryBook?: ChatMemoryBook;
  chatMemoryBookPath?: string;
  onChatMemoryUpdate?: (book: ChatMemoryBook) => void;
};

/**
 * Executes instant bot-facing commands (react, rename, lorebook, sticker).
 * These run synchronously before the text reply is sent.
 */
export async function executeInstantCommands(
  commands: BotCommand[],
  context: CommandContext,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  const { message, character, characterFilePath, chatMemoryBook, chatMemoryBookPath, onChatMemoryUpdate } = context;

  for (const cmd of commands) {
    try {
      const result = await executeCommand(cmd, message, character, characterFilePath, chatMemoryBook, chatMemoryBookPath, onChatMemoryUpdate);
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
 * Executes async bot-facing commands (generateImage).
 * These run after the text reply is sent. Results produce attachments for follow-up.
 */
export async function executeAsyncCommands(
  commands: BotCommand[],
  _context: CommandContext,
): Promise<AsyncCommandResult[]> {
  const results: AsyncCommandResult[] = [];

  for (const cmd of commands) {
    try {
      if (cmd.name === "generateImage") {
        const result = await executeGenerateImage(cmd.args as any);
        results.push(result);
      } else {
        results.push({ success: false, message: `Unknown async command: ${cmd.name}` });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, message: `Error executing ${cmd.name}: ${errorMsg}` });
      log.error(`Error executing async command ${cmd.name}:`, error);
    }
  }

  return results;
}

/**
 * @deprecated Use executeInstantCommands + executeAsyncCommands instead.
 * Executes all bot-facing commands from the AI response (legacy).
 */
export async function executeBotCommands(
  commands: BotCommand[],
  context: {
    message: Message;
    character: Character;
    characterFilePath?: string;
    chatMemoryBook?: ChatMemoryBook;
    chatMemoryBookPath?: string;
    onChatMemoryUpdate?: (book: ChatMemoryBook) => void;
  },
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  const { message, character, characterFilePath, chatMemoryBook, chatMemoryBookPath, onChatMemoryUpdate } = context;

  for (const cmd of commands) {
    try {
      const result = await executeCommand(cmd, message, character, characterFilePath, chatMemoryBook, chatMemoryBookPath, onChatMemoryUpdate);
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, message: `Error executing ${cmd.name}: ${errorMsg}` });
      log.error(`Error executing command ${cmd.name}:`, error);
    }
  }

  return results;
}

async function executeCommand(
  cmd: BotCommand,
  message: Message,
  character: Character,
  characterFilePath?: string,
  chatMemoryBook?: ChatMemoryBook,
  chatMemoryBookPath?: string,
  onChatMemoryUpdate?: (book: ChatMemoryBook) => void,
): Promise<CommandResult> {
  switch (cmd.name) {
    case "react":
      return await executeReact(cmd.args as any, message);

    case "renameSelf":
      return await executeRenameSelf(cmd.args as any, message, character);

    case "renameUser":
      return await executeRenameUser(cmd.args as any, message);

    case "editOrAddToLorebook":
      return await executeEditLorebook(cmd.args as any, chatMemoryBook, chatMemoryBookPath, onChatMemoryUpdate);

    case "postSticker":
      return await executePostSticker(cmd.args as any, message);

    case "setBio":
      return await executeSetBio(cmd.args as any, message);

    // Recursive commands are handled by DiscordBot's recursion loop
    // if they leak through here return a message instead of "Unknown command"
    case "webSearch":
    case "fetchWebpage":
    case "searchAndFetch":
    case "deepResearch":
    case "crawlSite":
      return { success: false, message: `${cmd.name} should be handled by the recursion loop (searxng not enabled or max depth reached)` };

    default:
      return { success: false, message: `Unknown command: ${cmd.name}` };
  }
}

/**
 * React to the message that triggered the bot's response
 * @param args.emoji - Discord emoji (e.g., "😀" or "emojiName:emojiId" for custom emojis)
 */
async function executeReact(args: { emoji: string }, message: Message): Promise<CommandResult> {
  const { emoji } = args;

  if (!emoji || typeof emoji !== "string") {
    return { success: false, message: "Invalid emoji argument" };
  }

  try {
    // Check if it's a custom emoji (format: name:id or name:id::animated)
    const customEmojiMatch = emoji.match(/^<?(a)?:?(\w{2,32}):(\d{17,19})>?$/);
    if (customEmojiMatch) {
      // It's a custom emoji - try to react with the emoji object
      const emojiId = customEmojiMatch[3];
      const guildEmoji = message.guild?.emojis.cache.get(emojiId);
      if (guildEmoji) {
        await message.react(guildEmoji);
        return { success: true, message: `Reacted with custom emoji ${emoji}` };
      } else {
        return { success: false, message: `Custom emoji ${emoji} not found in this server` };
      }
    } else {
      // It's a unicode emoji - react directly
      await message.react(emoji);
      return { success: true, message: `Reacted with ${emoji}` };
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to react with ${emoji}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Change the bot's own nickname in the server
 * @param args.newName - New nickname for the bot
 */
async function executeRenameSelf(
  args: { newName: string },
  message: Message,
  character: Character,
): Promise<CommandResult> {
  if (!discordConfig.allowRenaming) return { success: false, message: "Renaming is disabled" };

  const { newName } = args;

  if (!newName || typeof newName !== "string") return { success: false, message: "Invalid newName argument" };

  if (!message.guild) return { success: false, message: "Cannot rename outside of a server" };

  const botMember = message.guild.members.me;
  if (!botMember) return { success: false, message: "Bot is not a member of this server" };

  try {
    await botMember.setNickname(newName);
    return { success: true, message: `Renamed self to "${newName}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to rename: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Set the bot's about me / bio text on the server profile.
 * Uses the Discord REST API directly since discord.js has no GuildMember.setBio() method, fuck you discord for hiding this shit
 * @param args.bio - The new bio text (max 190 characters)
 */
async function executeSetBio(
  args: { bio: string },
  message: Message,
): Promise<CommandResult> {
  if (!discordConfig.allowRenaming) return { success: false, message: "Profile editing is disabled" };

  const { bio } = args;

  if (!bio || typeof bio !== "string") return { success: false, message: "Invalid bio argument" };
  if (bio.length > 190) return { success: false, message: `Bio is too long (${bio.length}/190 characters)` };

  if (!message.guild) return { success: false, message: "Cannot set bio outside of a server" };

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${message.guild.id}/members/@me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${discordConfig.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bio }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { success: false, message: `Failed to set bio (HTTP ${response.status}): ${errorText}` };
    }

    return { success: true, message: `Updated bio to: "${bio.slice(0, 80)}${bio.length > 80 ? "..." : ""}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to set bio: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Change another user's nickname in the server (requires MANAGE_NICKNAMES permission)
 * @param args.userId - Discord user ID or @mention
 * @param args.newName - New nickname for the user
 */
async function executeRenameUser(args: { userId: string; newName: string }, message: Message): Promise<CommandResult> {
  if (!discordConfig.allowRenaming) return { success: false, message: "Renaming is disabled" };

  const { userId, newName } = args;
  if (!userId || typeof userId !== "string") return { success: false, message: "Invalid userId argument" };
  if (!newName || typeof newName !== "string") return { success: false, message: "Invalid newName argument" };
  if (!message.guild) return { success: false, message: "Cannot rename outside of a server" };
  const extractedUserId = userId.match(/^<@!?(\d+)>$/)?.[1] || userId;

  try {
    const targetMember = await message.guild.members.fetch(extractedUserId);
    if (!targetMember) {
      return { success: false, message: `User ${userId} not found in server` };
    }

    if (!message.guild.members.me?.permissions.has("ManageNicknames"))
      return { success: false, message: "Bot lacks MANAGE_NICKNAMES permission" };

    // Cannot rename users with higher role
    if (targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position)
      return { success: false, message: "Cannot rename users with equal or higher role" };

    await targetMember.setNickname(newName);
    return { success: true, message: `Renamed user ${targetMember.user.username} to "${newName}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to rename user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create or update an entry in the ChatMemoryBook (dynamic lorebook).
 * Writes only to chatMemory.json, never touches the static character.json lorebook.
 */
async function executeEditLorebook(
  args: { entryName: string; keywords: string[]; content: string },
  chatMemoryBook?: ChatMemoryBook,
  chatMemoryBookPath?: string,
  onChatMemoryUpdate?: (book: ChatMemoryBook) => void,
): Promise<CommandResult> {
  const { entryName, keywords, content } = args;

  if (!entryName || typeof entryName !== "string") {
    return { success: false, message: "Invalid entryName argument" };
  }
  if (!keywords || !Array.isArray(keywords)) {
    return { success: false, message: "Invalid keywords argument (must be array)" };
  }
  if (!content || typeof content !== "string") {
    return { success: false, message: "Invalid content argument" };
  }

  if (!discordConfig.allowLorebookEditing) {
    return { success: false, message: "Lorebook editing is disabled" };
  }

  const filePath = chatMemoryBookPath || discordConfig.chatMemoryBookPath;

  try {
    // Use the in-memory book if available, otherwise load from disk
    let book: ChatMemoryBook = chatMemoryBook || { entries: [] };
    const isExistingEntry = book.entries.some(
      (entry) => entry.name.toLowerCase() === entryName.toLowerCase(),
    );

    book = upsertChatMemoryEntry(book, entryName, keywords, content);
    saveChatMemoryBook(filePath, book);

    // Update in-memory reference
    if (onChatMemoryUpdate) onChatMemoryUpdate(book);

    return { success: true, message: `Memory entry "${entryName}" ${isExistingEntry ? "updated" : "created"}` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to edit memory book: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Send a sticker from the server
 * @param args.stickerName - Name of the sticker to send
 */
async function executePostSticker(
  args: { stickerName: string },
  message: Message,
): Promise<CommandResult> {
  const { stickerName } = args;

  if (!stickerName || typeof stickerName !== "string") {
    return { success: false, message: "Invalid stickerName argument" };
  }

  if (!message.guild) {
    return { success: false, message: "Cannot send stickers outside of a server" };
  }

  if (!message.channel.isTextBased()) {
    return { success: false, message: "Cannot send stickers in this channel type" };
  }

  try {
    // Fetch server stickers and find by name (case-insensitive)
    const stickers = await message.guild.stickers.fetch();
    const sticker = stickers.find((s) => s.name.toLowerCase() === stickerName.toLowerCase());

    if (!sticker) {
      return { success: false, message: `Sticker "${stickerName}" not found in this server` };
    }

    // Cast needed: TypeScript doesn't narrow PartialGroupDMChannel out of the union
    const channel = message.channel as import("discord.js").TextChannel;
    await channel.send({ stickers: [sticker] });
    return { success: true, message: `Sent sticker "${sticker.name}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send sticker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate an image using ComfyUI
 * @param args.prompt - The image generation prompt
 * @param args.orientation - Image orientation (portrait, square, landscape)
 */
async function executeGenerateImage(
  args: { prompt: string; orientation?: "portrait" | "square" | "landscape" },
): Promise<AsyncCommandResult> {
  const { prompt, orientation = "square" } = args;

  if (!prompt || typeof prompt !== "string") {
    return { success: false, message: "Invalid prompt argument for generateImage" };
  }

  const validOrientations = ["portrait", "square", "landscape"];
  const safeOrientation = validOrientations.includes(orientation) ? orientation : "square";

  try {
    const result = await generateImage(prompt, safeOrientation as "portrait" | "square" | "landscape");
    return {
      success: true,
      message: `Image generated (${safeOrientation}): "${prompt}"`,
      attachment: { buffer: result.buffer, name: result.filename },
      prompt,
      orientation: safeOrientation,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
