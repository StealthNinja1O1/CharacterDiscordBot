import { readFileSync, writeFileSync, existsSync } from "fs";
import { BotCommand } from "../models.js";
import { log } from "../utils/logger.js";
import { behaviorConfig } from "../config.js";

export interface CommandMetadataEntry {
  channelId: string;
  commands: BotCommand[];
  createdAt: string;
}

interface CommandMetadataFile {
  version: 1;
  entries: Record<string, CommandMetadataEntry>;
}

// ============================================================
// Store
// ============================================================

const DEFAULT_TTL_MS = 2 * 30 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 3000;

class CommandMetadataStore {
  private entries: Record<string, CommandMetadataEntry> = {};
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;

  load(): void {
    const path = behaviorConfig.commandMetadataPath;
    try {
      if (existsSync(path)) {
        const raw = readFileSync(path, "utf-8");
        const data = JSON.parse(raw) as CommandMetadataFile;
        this.entries = data.entries || {};
        log.info(`Loaded ${Object.keys(this.entries).length} command metadata entries`);
      } else {
        this.entries = {};
        log.info("No existing command metadata file found — starting fresh");
      }
    } catch (error) {
      log.warn("Failed to load command metadata, starting fresh:", error);
      this.entries = {};
    }
    this.cleanupByTTL();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    const path = behaviorConfig.commandMetadataPath;
    try {
      const data: CommandMetadataFile = { version: 1, entries: this.entries };
      writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
      this.dirty = false;
      log.debug(`Saved command metadata (${Object.keys(this.entries).length} entries)`);
    } catch (error) {
      log.error("Failed to save command metadata:", error);
    }
  }

  record(messageId: string | undefined, channelId: string, commands: BotCommand[]): void {
    if (!messageId) return;
    if (!commands || commands.length === 0) return;
    this.entries[messageId] = {
      channelId,
      commands,
      createdAt: new Date().toISOString(),
    };
    this.scheduleSave();
  }

  lookup(messageId: string): BotCommand[] | null {
    const entry = this.entries[messageId];
    return entry ? entry.commands : null;
  }

  cleanupByChannel(channelId: string, activeMessageIds: Set<string>): void {
    for (const [msgId, entry] of Object.entries(this.entries))
      if (entry.channelId === channelId && !activeMessageIds.has(msgId)) delete this.entries[msgId];
  }

  cleanupByTTL(maxAgeMs: number = DEFAULT_TTL_MS): void {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [msgId, entry] of Object.entries(this.entries)) {
      if (new Date(entry.createdAt).getTime() < cutoff) {
        delete this.entries[msgId];
        removed++;
      }
    }
    if (removed > 0) {
      log.info(
        `TTL cleanup: removed ${removed} command metadata entries older than ${Math.round(maxAgeMs / 86400000)} days`,
      );
      this.scheduleSave();
    }
  }
}

export const commandMetadataStore = new CommandMetadataStore();
