import { discordConfig } from "../../config.js";
import { upsertChatMemoryEntry, saveChatMemoryBook } from "../../tools/chatMemoryBook.js";
import type { ChatMemoryBook } from "../../models.js";
import type { CommandDef, CommandResult } from "../registry.js";

/** Create or update an entry in the ChatMemoryBook (dynamic lorebook). */
async function editOrAddToLorebook(
  args: { entryName: string; keywords: string[]; content: string },
  ctx: {
    chatMemoryBook?: ChatMemoryBook;
    chatMemoryBookPath?: string;
    onChatMemoryUpdate?: (book: ChatMemoryBook) => void;
  },
): Promise<CommandResult> {
  const { entryName, keywords, content } = args;

  if (!entryName || typeof entryName !== "string") return { success: false, message: "Invalid entryName argument" };
  if (!keywords || !Array.isArray(keywords))
    return { success: false, message: "Invalid keywords argument (must be array)" };
  if (!content || typeof content !== "string") return { success: false, message: "Invalid content argument" };
  if (!discordConfig.allowLorebookEditing) return { success: false, message: "Lorebook editing is disabled" };

  const filePath = ctx.chatMemoryBookPath || discordConfig.chatMemoryBookPath;

  try {
    let book: ChatMemoryBook = ctx.chatMemoryBook || { entries: [] };
    const isExistingEntry = book.entries.some((entry) => entry.name.toLowerCase() === entryName.toLowerCase());

    book = upsertChatMemoryEntry(book, entryName, keywords, content);
    saveChatMemoryBook(filePath, book);
    if (ctx.onChatMemoryUpdate) ctx.onChatMemoryUpdate(book);

    return { success: true, message: `Memory entry "${entryName}" ${isExistingEntry ? "updated" : "created"}` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to edit memory book: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const editOrAddToLorebookCommand: CommandDef<{
  entryName: string;
  keywords: string[];
  content: string;
}> = {
  name: "editOrAddToLorebook",
  args: { entryName: "string", keywords: ["name1", "..."], content: "string" },
  description: `You can create or update existing lorebook entries about people or things you learn. Do this when you learn something new about a user.
      You can also add entries but please only update entries that you can see the value of.
      Keywords are what trigger the entry to be included in context, so use them wisely, its smart to add userid, username and displayname, along with possible nicknames or descriptive keywords.`,
  kind: "instant",
  enabled: () => discordConfig.allowLorebookEditing,
  execute: async (args, ctx) =>
    editOrAddToLorebook(args as { entryName: string; keywords: string[]; content: string }, ctx),
};
