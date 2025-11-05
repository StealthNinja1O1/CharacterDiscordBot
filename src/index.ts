import "dotenv/config";
import { discordConfig } from "./config.js";
import { DiscordBot } from "./classes/DiscordBot.js";
import { Character } from "./models.js";
import { writeFileSync } from "fs";

const defaultOnUpdate = async (character: Character) => {
  try {
    writeFileSync(discordConfig.characterFilePath, JSON.stringify(character, null, 2), "utf-8");
    console.log("Character file updated on disk.");
  } catch (error) {
    console.error("Error writing character file:", error);
    throw error;
  }
};

const bot = new DiscordBot({
  discordConfig,
  characterSource: discordConfig.characterFilePath,
  onCharacterUpdate: defaultOnUpdate,
});

bot.start().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});