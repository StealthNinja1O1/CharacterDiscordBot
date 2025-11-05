import { CharacterBook, CharacterBookEntry } from "../types";

enum LorebookEntrySecondaryKeyLogic {
  AND_ANY = 0,
  NOT_ALL = 1,
  NOT_ANY = 2,
  AND_ALL = 3,
}

/**
 * Check if a single key matches in the search text
 */
function checkSingleKeyMatch(key: string, searchText: string, caseSensitive?: boolean): boolean {
  if (!key) return false;

  if (caseSensitive) {
    return searchText.includes(key);
  } else {
    return searchText.toLowerCase().includes(key.toLowerCase());
  }
}

/**
 * Check if any keys from an entry match in the message history
 * Supports both primary keys and secondary keys with selective logic
 */
function checkKeysMatch(
  entry: {
    keys: string[];
    case_sensitive?: boolean;
    secondary_keys?: string[];
    keysecondary?: string[];
    selectiveLogic?: number;
  },
  searchText: string
): boolean {
  if (!entry.keys || entry.keys.length === 0) {
    return false;
  }

  // Check main keys
  let mainKeyMatch = false;
  for (const key of entry.keys) {
    if (!key) continue;

    if (checkSingleKeyMatch(key, searchText, entry.case_sensitive)) {
      mainKeyMatch = true;
      break;
    }
  }

  if (!mainKeyMatch) {
    return false;
  }

  // Get secondary keys (support both secondary_keys and keysecondary)
  const secondaryKeys = entry.secondary_keys || entry.keysecondary;

  // If no secondary keys exist, only main key check matters
  if (!secondaryKeys || secondaryKeys.length === 0) {
    return mainKeyMatch;
  }

  // Check secondary keys
  const secondaryMatches: boolean[] = [];
  for (const key of secondaryKeys) {
    if (!key) continue;
    secondaryMatches.push(checkSingleKeyMatch(key, searchText, entry.case_sensitive));
  }

  // Determine secondary key check result based on selectiveLogic
  const selectiveLogic = entry.selectiveLogic ?? LorebookEntrySecondaryKeyLogic.AND_ANY;
  let secondaryKeyCheck = false;

  switch (selectiveLogic) {
    case LorebookEntrySecondaryKeyLogic.AND_ANY: // 0 - At least one secondary key must match
      secondaryKeyCheck = secondaryMatches.some((match) => match);
      break;

    case LorebookEntrySecondaryKeyLogic.NOT_ALL: // 1 - Not all secondary keys should match
      secondaryKeyCheck = !secondaryMatches.every((match) => match);
      break;

    case LorebookEntrySecondaryKeyLogic.NOT_ANY: // 2 - None of the secondary keys should match
      secondaryKeyCheck = !secondaryMatches.some((match) => match);
      break;

    case LorebookEntrySecondaryKeyLogic.AND_ALL: // 3 - All secondary keys must match
      secondaryKeyCheck = secondaryMatches.every((match) => match);
      break;

    default:
      // Default to AND_ANY if unknown logic
      secondaryKeyCheck = secondaryMatches.some((match) => match);
      break;
  }

  // Both main key and secondary key checks must pass
  return mainKeyMatch && secondaryKeyCheck;
}

/**
 * Check if an entry passes its probability roll
 */
function checkProbability(entry: CharacterBookEntry): boolean {
  // If useProbability is not set or false, always pass
  if (!entry.useProbability) {
    return true;
  }

  // If probability is not set, default to 100% (always pass)
  const probability = entry.probability ?? 100;

  // Roll a random number between 0 and 100
  const roll = Math.random() * 100;

  // Pass if roll is less than probability
  return roll < probability;
}

/**
 * Generate a unique identifier for a lorebook entry
 * Combines uid, name, and content to create an almost always unique identifier
 */
function getEntryId(entry: CharacterBookEntry): string {
  const parts: string[] = [];

  if (entry.uid !== undefined && entry.uid !== null) {
    parts.push(`uid:${entry.uid}`);
  }

  if (entry.name) {
    parts.push(`name:${entry.name}`);
  }

  // Always include a content hash/substring for uniqueness
  parts.push(`content:${entry.content.substring(0, 50)}`);

  return parts.join("|");
}

/**
 * Process a single lorebook with recursion and probability support
 */
export function processLorebook(
  messages: any[],
  book: CharacterBook
): {
  list: CharacterBookEntry[];
} {
  const list: CharacterBookEntry[] = [];

  // Track which entries we've already checked (by UID or unique identifier)
  const checkedEntries = new Set<string>();

  if (!book.entries || book.entries.length === 0) {
    return { list };
  }

  const bookScanDepth = book.scanDepth ?? 12;

  // Initial scan: Process each entry with its own scan depth
  for (const entry of book.entries) {
    // Skip disabled entries
    if (!entry.enabled || entry.disable) {
      continue;
    }

    const entryId = getEntryId(entry);

    // Skip if already checked
    if (checkedEntries.has(entryId)) continue;

    // Get the appropriate scan depth for this entry
    const scanDepth = entry.scanDepth !== null && entry.scanDepth !== undefined ? entry.scanDepth : bookScanDepth;

    // Get messages to scan based on this entry's scan depth
    const messagesToScan = messages.slice(-scanDepth);
    const searchText = messagesToScan.map((msg) => msg.content).join("\n");

    // Check if entry triggers (constant or key match)
    if (entry.constant || checkKeysMatch(entry, searchText)) {
      checkedEntries.add(entryId);

      // Check probability before adding to triggered lists
      if (!checkProbability(entry)) {
        continue;
      }
      list.push(entry);
    }
  }

  // Sort entries by their order field (ascending)
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return { list };
}
