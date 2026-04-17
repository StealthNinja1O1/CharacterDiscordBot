import "dotenv/config";
import { discordConfig } from "./config.js";
import { DiscordBot } from "./classes/DiscordBot.js";
import { Character } from "./models.js";
import { readFileSync, writeFileSync } from "fs";
import { log } from "./utils/logger.js";

const defaultOnUpdate = async (character: Character) => {
  try {
    const currentFileContent = readFileSync(discordConfig.characterFilePath, "utf-8");
    const currentCharacterCard = JSON.parse(currentFileContent);

    currentCharacterCard.data.name = character.name;
    currentCharacterCard.data.description = character.description;
    currentCharacterCard.data.mes_example = character.mesExample;

    if (character.depthPrompt !== null) {
      if (!currentCharacterCard.data.extensions) currentCharacterCard.data.extensions = {};
      currentCharacterCard.data.extensions.depth_prompt = character.depthPrompt;
    } else if (currentCharacterCard.data.extensions?.depth_prompt)
      delete currentCharacterCard.data.extensions.depth_prompt;

    if (character.character_book !== null) currentCharacterCard.data.character_book = character.character_book;
    else if (currentCharacterCard.data.character_book) delete currentCharacterCard.data.character_book;

    writeFileSync(discordConfig.characterFilePath, JSON.stringify(currentCharacterCard, null, 2), "utf-8");
    log.info("Character file updated on disk");
  } catch (error) {
    log.error("Error writing character file:", error);
    throw error;
  }
};

const bot = new DiscordBot({
  discordConfig,
  characterSource: discordConfig.characterFilePath,
  onCharacterUpdate: defaultOnUpdate,
});

bot.start().catch((error) => {
  log.error("Failed to start bot:", error);
  process.exit(1);
});
