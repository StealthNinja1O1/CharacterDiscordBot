import { Message, GuildMember } from "discord.js";
import { BotCommand, Character, LorebookEntry } from "../models.js";
import { writeFileSync, readFileSync } from "fs";
import { discordConfig } from "../config.js";

interface CommandResult {
  success: boolean;
  message: string;
}

/**
 * Executes bot-facing commands from the AI response.
 * These commands allow the character to interact with Discord (react, rename, edit lorebook).
 */
export async function executeBotCommands(
  commands: BotCommand[],
  context: {
    message: Message;
    character: Character;
    characterFilePath?: string;
  }
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  const { message, character, characterFilePath } = context;

  for (const cmd of commands) {
    try {
      const result = await executeCommand(cmd, message, character, characterFilePath);
      results.push(result);
      console.log(`Command ${cmd.name}: ${result.message}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ success: false, message: `Error executing ${cmd.name}: ${errorMsg}` });
      console.error(`Error executing command ${cmd.name}:`, error);
    }
  }

  return results;
}

async function executeCommand(
  cmd: BotCommand,
  message: Message,
  character: Character,
  characterFilePath?: string
): Promise<CommandResult> {
  switch (cmd.name) {
    case "react":
      return await executeReact(cmd.args as any, message);

    case "renameSelf":
      return await executeRenameSelf(cmd.args as any, message, character);

    case "renameUser":
      return await executeRenameUser(cmd.args as any, message);

    case "editOrAddToLorebook":
      return await executeEditLorebook(cmd.args as any, character, characterFilePath);

    default:
      return { success: false, message: `Unknown command: ${cmd.name}` };
  }
}

/**
 * React to the message that triggered the bot's response
 * @param args.emoji - Discord emoji (e.g., "😀" or "emojiName:emojiId" for custom emojis)
 */
async function executeReact(
  args: { emoji: string },
  message: Message
): Promise<CommandResult> {
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
  character: Character
): Promise<CommandResult> {
  const { newName } = args;

  if (!newName || typeof newName !== "string") {
    return { success: false, message: "Invalid newName argument" };
  }

  if (!message.guild) {
    return { success: false, message: "Cannot rename outside of a server" };
  }

  const botMember = message.guild.members.me;
  if (!botMember) {
    return { success: false, message: "Bot is not a member of this server" };
  }

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
 * Change another user's nickname in the server (requires MANAGE_NICKNAMES permission)
 * @param args.userId - Discord user ID or @mention
 * @param args.newName - New nickname for the user
 */
async function executeRenameUser(
  args: { userId: string; newName: string },
  message: Message
): Promise<CommandResult> {
  const { userId, newName } = args;

  if (!userId || typeof userId !== "string") {
    return { success: false, message: "Invalid userId argument" };
  }
  if (!newName || typeof newName !== "string") {
    return { success: false, message: "Invalid newName argument" };
  }

  if (!message.guild) {
    return { success: false, message: "Cannot rename outside of a server" };
  }

  // Extract user ID from mention if provided
  const extractedUserId = userId.match(/^<@!?(\d+)>$/)?.[1] || userId;

  try {
    const targetMember = await message.guild.members.fetch(extractedUserId);
    if (!targetMember) {
      return { success: false, message: `User ${userId} not found in server` };
    }

    // Check if bot has permission to manage nicknames
    if (!message.guild.members.me?.permissions.has("ManageNicknames")) {
      return { success: false, message: "Bot lacks MANAGE_NICKNAMES permission" };
    }

    // Cannot rename users with higher role
    if (targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position) {
      return { success: false, message: "Cannot rename users with equal or higher role" };
    }

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
 * Create or update a lorebook entry
 * @param args.entryName - Name of the lorebook entry
 * @param args.keywords - Array of keywords that trigger this entry
 * @param args.content - Content of the lorebook entry
 */
async function executeEditLorebook(
  args: { entryName: string; keywords: string[]; content: string },
  character: Character,
  characterFilePath?: string
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

  const filePath = characterFilePath || discordConfig.characterFilePath;
  if (!filePath) {
    return { success: false, message: "No character file path configured" };
  }

  try {
    // Read and parse character file
    const characterData = readFileSync(filePath, "utf-8");
    const characterCard = JSON.parse(characterData);

    // Ensure character_book exists
    if (!characterCard.data.character_book) {
      characterCard.data.character_book = {
        name: "Data Storage",
        description: "",
        scan_depth: 8,
        token_budget: 1024,
        recursive_scanning: false,
        extensions: {},
        entries: [],
      };
    }

    const book = characterCard.data.character_book;

    // Find existing entry (case-insensitive)
    const entryIndex = book.entries.findIndex(
      (entry: LorebookEntry) => entry.name.toLowerCase() === entryName.toLowerCase()
    );

    if (entryIndex !== -1) {
      // Update existing entry
      book.entries[entryIndex].content = content;
      if (keywords.length > 0) {
        book.entries[entryIndex].keys = keywords;
      }
      console.log(`Updated lorebook entry "${entryName}"`);
    } else {
      // Create new entry
      const newEntry: LorebookEntry = {
        name: entryName,
        keys: keywords.length > 0 ? keywords : [entryName.toLowerCase()],
        content,
        enabled: true,
        insertion_order: 10,
        case_sensitive: false,
        priority: 10,
        id: book.entries.length + 1,
        comment: "",
        selective: false,
        constant: false,
        position: "",
        extensions: {},
        probability: 100,
        selectiveLogic: 0,
        secondary_keys: [],
      };
      book.entries.push(newEntry);
      console.log(`Created new lorebook entry "${entryName}"`);
    }

    // Save to file
    writeFileSync(filePath, JSON.stringify(characterCard, null, 3), "utf-8");

    // Update in-memory character
    character.character_book = book;

    return { success: true, message: `Lorebook entry "${entryName}" ${entryIndex !== -1 ? "updated" : "created"}` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to edit lorebook: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
