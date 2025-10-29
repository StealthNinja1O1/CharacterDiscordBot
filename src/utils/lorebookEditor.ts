import { readFileSync, writeFileSync } from "fs";
import { discordConfig } from "../config.js";
import { Character, CharacterCardV2, LorebookEntry } from "../models.js";

/**
 * Process lorebook editing commands in the AI response
 * Format: createOrEditLore(entryName, newContent)
 * @param response The AI response text
 * @param character The in-memory character object
 * @returns Object with cleaned response, success status, and updated character
 */
export function processLorebookCommands(
  response: string,
  character: Character
): { cleanedResponse: string; edited: boolean; updatedCharacter: Character } {
  if (!discordConfig.allowLoreboookEditing) {
    return { cleanedResponse: response, edited: false, updatedCharacter: character };
  }

  // Updated regex to handle multi-line strings and any whitespace
  // [\s\S] matches any character including newlines, *? is non-greedy
  const commandRegex = /createOrEditLore\s*\(\s*["']([\s\S]*?)["']\s*,\s*["']([\s\S]*?)["']\s*\)/gi;
  const matches = Array.from(response.matchAll(commandRegex));
//   console.log("Lorebook edit commands found:", matches.length);
//   for (const match of matches) {
//     console.log(`Command: entryName="${match[1]}", newContent="${match[2]}"`);
//   }

  if (matches.length === 0) return { cleanedResponse: response, edited: false, updatedCharacter: character };

  let edited = false;

  try {
    // Load character file
    const characterData = readFileSync(discordConfig.characterFilePath, "utf-8");
    const characterCard: CharacterCardV2 = JSON.parse(characterData);

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

    // Process each command
    for (const match of matches) {
      const entryName = match[1].trim();
      const newContent = match[2].trim();

      // Find existing entry (case-insensitive)
      const entryIndex = characterCard.data.character_book.entries.findIndex(
        (entry) => entry.name.toLowerCase() === entryName.toLowerCase()
      );

      if (entryIndex !== -1) {
        // Update existing entry
        characterCard.data.character_book.entries[entryIndex].content = newContent;
        console.log(`Updated lorebook entry: ${entryName}, new content: ${newContent}`);
        edited = true;
      } else {
        // Create new entry
        const newEntry: LorebookEntry = {
          name: entryName,
          keys: [entryName.toLowerCase()],
          content: newContent,
          enabled: true,
          insertion_order: 10,
          case_sensitive: false,
          priority: 10,
          id: characterCard.data.character_book.entries.length + 1,
          comment: "",
          selective: false,
          constant: false,
          position: "",
          extensions: {},
          probability: 100,
          selectiveLogic: 0,
          secondary_keys: [],
        };
        characterCard.data.character_book.entries.push(newEntry);
        console.log(`Created new lorebook entry: ${entryName}`);
        edited = true;
      }
    }

    if (edited) {
      // Save updated character file
      writeFileSync(discordConfig.characterFilePath, JSON.stringify(characterCard, null, 3), "utf-8");
      console.log("Character file updated with lorebook changes.");

      // Update in-memory character
      character.character_book = characterCard.data.character_book;
    }
  } catch (error) {
    console.error("Error processing lorebook commands:", error);
  }

  // Remove all commands from the response
  const cleanedResponse = response.replace(commandRegex, "").trim();

  return { cleanedResponse, edited, updatedCharacter: character };
}
