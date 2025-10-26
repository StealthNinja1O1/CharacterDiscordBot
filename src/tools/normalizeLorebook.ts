/**
 * Lorebook Normalization
 *
 * Normalizes lorebook data from different providers (SillyTavern, Chub, etc.)
 * to ensure consistent format before storing in the database.
 *
 * SillyTavern format is treated as the leading standard.
 */

import type { CharacterBookData, CharacterBookEntry } from "../types.js";
import { randomUUID } from "crypto";

/**
 * Default values for lorebook entry properties
 */
const LOREBOOK_ENTRY_DEFAULTS = {
  name: "",
  comment: "",
  content: "",
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: true,
  priority: 10,
  order: 100,
  insertionOrder: 100,
  position: 1,
  enabled: true,
  disable: false,
  ignoreBudget: false,
  excludeRecursion: false,
  preventRecursion: false,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  delayUntilRecursion: false,
  probability: 100,
  useProbability: true,
  depth: 4,
  outletName: "",
  group: "",
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: "",
  role: null,
  sticky: 0,
  cooldown: 0,
  delay: 0,
  triggers: [],
  displayIndex: 0,
  characterFilter: {
    isExclude: false,
    names: [],
    tags: [],
  },
};

/**
 * Convert camelCase to snake_case
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Get value from entry or extensions, checking both camelCase and snake_case
 */
function getPropertyValue(entry: any, propName: string, defaultValue: any): any {
  // First check if property exists directly on entry
  if (entry[propName] !== undefined && entry[propName] !== null) {
    return entry[propName];
  }

  // Check extensions if it exists
  if (entry.extensions && typeof entry.extensions === "object") {
    // Check camelCase in extensions
    if (entry.extensions[propName] !== undefined && entry.extensions[propName] !== null) {
      return entry.extensions[propName];
    }

    // Check snake_case in extensions
    const snakeCaseProp = camelToSnake(propName);
    if (entry.extensions[snakeCaseProp] !== undefined && entry.extensions[snakeCaseProp] !== null) {
      return entry.extensions[snakeCaseProp];
    }
  }

  return defaultValue;
}

/**
 * Get excludeRecursion value with special handling for Chub bug
 * Chub exports have excludeRecursion always set to true in extensions,
 * while the actual value is in exclude_recursion (snake_case)
 */
function getExcludeRecursionValue(entry: any, defaultValue: boolean): boolean {
  // First check if property exists directly on entry (not in extensions)
  if (entry.excludeRecursion !== undefined && entry.excludeRecursion !== null) {
    return entry.excludeRecursion;
  }

  // Check extensions if it exists
  if (entry.extensions && typeof entry.extensions === "object") {
    // For excludeRecursion specifically, check snake_case FIRST (Chub workaround)
    if (entry.extensions.exclude_recursion !== undefined && entry.extensions.exclude_recursion !== null) {
      return entry.extensions.exclude_recursion;
    }

    // Then check camelCase (though this may be buggy from Chub)
    if (entry.extensions.excludeRecursion !== undefined && entry.extensions.excludeRecursion !== null) {
      return entry.extensions.excludeRecursion;
    }
  }

  return defaultValue;
}

/**
 * Normalize position value
 */
function normalizePosition(entry: any): number {
  const position = entry.position;
  const extensions = entry.extensions;

  // Check if position exists in extensions (both formats)
  if (extensions && typeof extensions === "object") {
    if (typeof extensions.position === "number") {
      return extensions.position;
    }
  }

  // Handle string positions
  if (position === "after_char") {
    return 1;
  } else if (position === "before_char") {
    return 0;
  } else if (typeof position === "number") {
    return position;
  } else if (typeof position !== "number") {
    return 1;
  }

  return LOREBOOK_ENTRY_DEFAULTS.position;
}

/**
 * Normalize case_sensitive with special handling
 */
function normalizeCaseSensitive(entry: any): boolean | undefined {
  // Check extensions first (it takes precedence)
  if (entry.extensions && typeof entry.extensions === "object") {
    if (entry.extensions.caseSensitive !== undefined && entry.extensions.caseSensitive !== null) {
      return entry.extensions.caseSensitive;
    }
    if (entry.extensions.case_sensitive !== undefined && entry.extensions.case_sensitive !== null) {
      return entry.extensions.case_sensitive;
    }
  }

  // Then check direct property
  if (entry.caseSensitive !== undefined && entry.caseSensitive !== null) {
    return entry.caseSensitive;
  }
  if (entry.case_sensitive !== undefined && entry.case_sensitive !== null) {
    return entry.case_sensitive;
  }

  return undefined;
}

/**
 * Normalize order and insertion_order
 */
function normalizeOrder(entry: any): { order: number; insertionOrder: number } {
  const order = entry.order;
  const insertionOrder = entry.insertion_order;

  // If order exists, it's leading
  if (order !== undefined && order !== null) {
    return {
      order: order,
      insertionOrder: order,
    };
  }

  // If insertion_order exists and is not 10
  if (insertionOrder !== undefined && insertionOrder !== null && insertionOrder !== 10) {
    return {
      order: insertionOrder,
      insertionOrder: insertionOrder,
    };
  }

  // If insertion_order is 10 or doesn't exist
  return {
    order: 100,
    insertionOrder: 100,
  };
}

/**
 * Normalize name and comment (they can fill each other)
 */
function normalizeNameAndComment(entry: any): { name: string; comment: string } {
  let name = entry.name;
  let comment = entry.comment;

  // If name doesn't exist but comment does
  if ((!name || name === "") && comment) {
    name = comment;
  }

  // If comment doesn't exist but name does
  if ((!comment || comment === "") && name) {
    comment = name;
  }

  return {
    name: name || LOREBOOK_ENTRY_DEFAULTS.name,
    comment: comment || LOREBOOK_ENTRY_DEFAULTS.comment,
  };
}

/**
 * Normalize lorebook data from various providers
 *
 * This function handles different lorebook formats and converts them
 * to our standard CharacterBookData format.
 *
 * @param lorebookData - Raw lorebook data from any provider
 * @returns Normalized CharacterBookData
 */
export function normalizeLorebookData(lorebookData: any): CharacterBookData {
  if (!lorebookData) {
    throw new Error("Lorebook data is required");
  }

  const normalizedEntries = (lorebookData.entries || []).map((entry: any) => normalizeLorebookEntry(entry));

  return {
    name: lorebookData.name,
    description: lorebookData.description,
    scan_depth: lorebookData.scan_depth,
    token_budget: lorebookData.token_budget,
    recursive_scanning: lorebookData.recursive_scanning,
    extensions: lorebookData.extensions || {},
    entries: normalizedEntries,
  };
}

/**
 * Normalize a single lorebook entry
 *
 * Handles both SillyTavern and Chub formats, with SillyTavern as the leading standard.
 *
 * @param entry - Raw lorebook entry from any provider
 * @returns Normalized CharacterBookEntry
 */
export function normalizeLorebookEntry(entry: any): CharacterBookEntry {
  if (!entry) {
    throw new Error("Lorebook entry is required");
  }

  // Handle name and comment special rules
  const { name, comment } = normalizeNameAndComment(entry);

  // Handle order and insertion_order special rules
  const { order, insertionOrder } = normalizeOrder(entry);

  // Handle position special rules
  const position = normalizePosition(entry);

  // Handle case_sensitive special rules
  const caseSensitive = normalizeCaseSensitive(entry);

  // Normalize keys (handle both 'key' and 'keys')
  const keys = entry.keys || entry.key || LOREBOOK_ENTRY_DEFAULTS.name;

  // Normalize secondary_keys (handle both formats)
  const secondaryKeys = entry.secondary_keys || entry.keysecondary || [];

  // Normalize enabled/disable
  const enabled = entry.enabled !== undefined ? entry.enabled : !entry.disable;

  // Build normalized entry with all properties flattened (no nested extensions)
  const normalizedEntry: any = {
    // Required fields from CharacterBookEntry
    keys: Array.isArray(keys) ? keys : [keys],
    content: entry.content || LOREBOOK_ENTRY_DEFAULTS.content,
    enabled,
    insertion_order: insertionOrder,

    // Optional fields from CharacterBookEntry
    caseSensitive: caseSensitive,
    name,
    priority: getPropertyValue(entry, "priority", LOREBOOK_ENTRY_DEFAULTS.priority),
    id: entry.id,
    comment,
    selective: getPropertyValue(entry, "selective", LOREBOOK_ENTRY_DEFAULTS.selective),
    secondary_keys: secondaryKeys,
    constant: getPropertyValue(entry, "constant", LOREBOOK_ENTRY_DEFAULTS.constant),
    position: position,

    // All other properties flattened (previously in extensions)
    uid: entry.uid !== undefined ? entry.uid : entry.id !== undefined ? entry.id : randomUUID(),
    vectorized: getPropertyValue(entry, "vectorized", LOREBOOK_ENTRY_DEFAULTS.vectorized),
    selectiveLogic: getPropertyValue(entry, "selectiveLogic", LOREBOOK_ENTRY_DEFAULTS.selectiveLogic),
    addMemo: getPropertyValue(entry, "addMemo", LOREBOOK_ENTRY_DEFAULTS.addMemo),
    order,
    disable: !enabled,
    ignoreBudget: getPropertyValue(entry, "ignoreBudget", LOREBOOK_ENTRY_DEFAULTS.ignoreBudget),
    excludeRecursion: getExcludeRecursionValue(entry, LOREBOOK_ENTRY_DEFAULTS.excludeRecursion),
    preventRecursion: getPropertyValue(entry, "preventRecursion", LOREBOOK_ENTRY_DEFAULTS.preventRecursion),
    matchPersonaDescription: getPropertyValue(
      entry,
      "matchPersonaDescription",
      LOREBOOK_ENTRY_DEFAULTS.matchPersonaDescription
    ),
    matchCharacterDescription: getPropertyValue(
      entry,
      "matchCharacterDescription",
      LOREBOOK_ENTRY_DEFAULTS.matchCharacterDescription
    ),
    matchCharacterPersonality: getPropertyValue(
      entry,
      "matchCharacterPersonality",
      LOREBOOK_ENTRY_DEFAULTS.matchCharacterPersonality
    ),
    matchCharacterDepthPrompt: getPropertyValue(
      entry,
      "matchCharacterDepthPrompt",
      LOREBOOK_ENTRY_DEFAULTS.matchCharacterDepthPrompt
    ),
    matchScenario: getPropertyValue(entry, "matchScenario", LOREBOOK_ENTRY_DEFAULTS.matchScenario),
    matchCreatorNotes: getPropertyValue(entry, "matchCreatorNotes", LOREBOOK_ENTRY_DEFAULTS.matchCreatorNotes),
    delayUntilRecursion: getPropertyValue(entry, "delayUntilRecursion", LOREBOOK_ENTRY_DEFAULTS.delayUntilRecursion),
    probability: getPropertyValue(entry, "probability", LOREBOOK_ENTRY_DEFAULTS.probability),
    useProbability: getPropertyValue(entry, "useProbability", LOREBOOK_ENTRY_DEFAULTS.useProbability),
    depth: getPropertyValue(entry, "depth", LOREBOOK_ENTRY_DEFAULTS.depth),
    outletName: getPropertyValue(entry, "outletName", LOREBOOK_ENTRY_DEFAULTS.outletName),
    group: getPropertyValue(entry, "group", LOREBOOK_ENTRY_DEFAULTS.group),
    groupOverride: getPropertyValue(entry, "groupOverride", LOREBOOK_ENTRY_DEFAULTS.groupOverride),
    groupWeight: getPropertyValue(entry, "groupWeight", LOREBOOK_ENTRY_DEFAULTS.groupWeight),
    scanDepth: getPropertyValue(entry, "scanDepth", LOREBOOK_ENTRY_DEFAULTS.scanDepth),
    matchWholeWords: getPropertyValue(entry, "matchWholeWords", LOREBOOK_ENTRY_DEFAULTS.matchWholeWords),
    useGroupScoring: getPropertyValue(entry, "useGroupScoring", LOREBOOK_ENTRY_DEFAULTS.useGroupScoring),
    automationId: getPropertyValue(entry, "automationId", LOREBOOK_ENTRY_DEFAULTS.automationId),
    role: getPropertyValue(entry, "role", LOREBOOK_ENTRY_DEFAULTS.role),
    sticky: getPropertyValue(entry, "sticky", LOREBOOK_ENTRY_DEFAULTS.sticky),
    cooldown: getPropertyValue(entry, "cooldown", LOREBOOK_ENTRY_DEFAULTS.cooldown),
    delay: getPropertyValue(entry, "delay", LOREBOOK_ENTRY_DEFAULTS.delay),
    triggers: getPropertyValue(entry, "triggers", LOREBOOK_ENTRY_DEFAULTS.triggers),
    displayIndex: getPropertyValue(entry, "displayIndex", LOREBOOK_ENTRY_DEFAULTS.displayIndex),
    characterFilter: getPropertyValue(entry, "characterFilter", LOREBOOK_ENTRY_DEFAULTS.characterFilter),

    // Empty extensions object to satisfy the schema requirement
    extensions: {},
  };

  return normalizedEntry as CharacterBookEntry;
}

/**
 * Parse lorebook from JSON file
 */
export async function parseLorebook(json: any): Promise<CharacterBookData> {
  // Check if it's a standalone lorebook or character card
  let lorebook: CharacterBookData;

  if (json.character_book) {
    // It's a character card with embedded lorebook
    lorebook = json.character_book;
  } else if (json.entries) {
    // It's a standalone lorebook
    lorebook = json as CharacterBookData;
  } else {
    throw new Error("Invalid lorebook format. Expected character_book object or entries array.");
  }

  // Normalize fancy characters
  return normalizeObjectText(lorebook);
}

/**
 * Normalize all text fields in an object recursively
 */
export function normalizeObjectText<T>(obj: T): T {
  if (typeof obj === "string") {
    return normalizeFancyCharacters(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => normalizeObjectText(item)) as T;
  }

  if (obj && typeof obj === "object") {
    const normalized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      normalized[key] = normalizeObjectText(value);
    }
    return normalized as T;
  }

  return obj;
}

/**
 * Normalize fancy quotes and other Unicode characters to ASCII
 */
export function normalizeFancyCharacters(text: string): string {
  if (!text) return text;

  return (
    text
      // Fancy single quotes to standard apostrophe
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")

      // Fancy double quotes to standard quotes
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')

      // Horizontal ellipsis to three dots
      .replace(/\u2026/g, "...")

      // Non-breaking space to regular space
      .replace(/\u00A0/g, " ")

      // Various bullet points to asterisk
      .replace(/[\u2022\u2023\u2043]/g, "*")

      // Copyright, registered, trademark symbols
      .replace(/\u00A9/g, "(c)")
      .replace(/\u00AE/g, "(r)")
      .replace(/\u2122/g, "(tm)")

      // Fancy apostrophes and primes
      .replace(/\u02BC/g, "'")
      .replace(/\u02BB/g, "'")

      // Right single quotation mark
      .replace(/\u2019/g, "'")
  );
}
