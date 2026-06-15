import { discordConfig, healthConfig, startConfigWatcher } from "./config.js";
import { DiscordBot } from "./classes/DiscordBot.js";
import { log } from "./utils/logger.js";
import { commandMetadataStore } from "./tools/commandMetadata.js";
import { startHealthcheckServer } from "./utils/healthcheck.js";

commandMetadataStore.load();

startConfigWatcher();
const stopHealthcheck = healthConfig.enabled ? startHealthcheckServer(healthConfig.port) : null;

const bot = new DiscordBot({
  discordConfig,
  characterSource: discordConfig.characterFilePath,
});

bot.start().catch((error) => {
  log.error("Failed to start bot:", error);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal}, shutting down...`);
  try {
    stopHealthcheck?.();
    commandMetadataStore.flush();
    await bot.stop();
    log.info("Shutdown complete.");
    process.exit(0);
  } catch (error) {
    log.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
