import { readFileSync, writeFileSync, existsSync } from "fs";
import { LorebookEntry } from "../models.js";
import { log } from "../utils/logger.js";

/**
 * Shape of the chatMemory.json file.
 * Stores dynamic/editable lorebook entries that the bot can modify at runtime.
 */
export interface ChatMemoryBook {
  entries: LorebookEntry[];
}

/**
 * Load the ChatMemoryBook from disk.
 * Creates an empty one if the file doesn't exist.
 */
export function loadChatMemoryBook(filePath: string): ChatMemoryBook {
  if (!existsSync(filePath)) {
    const empty: ChatMemoryBook = { entries: [] };
    saveChatMemoryBook(filePath, empty);
    log.info(`Created new ChatMemoryBook at ${filePath}`);
    return empty;
  }

  try {
    const data = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(data);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch (error) {
    log.error(`Error loading ChatMemoryBook from ${filePath}:`, error);
    return { entries: [] };
  }
}

/**
 * Save the ChatMemoryBook to disk.
 */
export function saveChatMemoryBook(filePath: string, book: ChatMemoryBook): void {
  writeFileSync(filePath, JSON.stringify(book, null, 3), "utf-8");
}

/**
 * Create or update an entry in the ChatMemoryBook.
 * Returns the updated book.
 */
export function upsertChatMemoryEntry(
  book: ChatMemoryBook,
  entryName: string,
  keywords: string[],
  content: string,
): ChatMemoryBook {
  const entryIndex = book.entries.findIndex(
    (entry) => entry.name.toLowerCase() === entryName.toLowerCase(),
  );

  if (entryIndex !== -1) {
    // Update existing entry
    book.entries[entryIndex].content = content;
    if (keywords.length > 0) {
      book.entries[entryIndex].keys = keywords;
    }
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
  }

  return book;
}
