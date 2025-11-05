import { Client, GatewayIntentBits, Events, Message } from "discord.js";
import { DiscordConfig, DEFAULT_PRESET } from "../config.js";
import { Character } from "../models.js";
import { readFileSync, existsSync } from "fs";
import { processLorebookCommands } from "../utils/lorebookEditor.js";
import { generateAIResponse } from "../tools/prompt.js";
import CommandHandler from "../commands/CommandHandler.js";

export interface DiscordBotOptions {
  discordConfig: DiscordConfig;
  characterSource: string | Character; // filepath or character object
  preset?: typeof DEFAULT_PRESET;
  onCharacterUpdate?: (character: Character) => void | Promise<void>;
}

export class DiscordBot {
  private client: Client;
  private discordConfig: DiscordConfig;
  private character: Character;
  private preset: typeof DEFAULT_PRESET;
  private onCharacterUpdate: (character: Character) => void | Promise<void>;
  private commandHandler: CommandHandler;

  // Runtime state
  private randomResponsesEnabled = true;
  private runtimeEnabled = true;
  private messageCounter = 0;
  private isBusy = new Map<string, boolean>();
  private lastResponseTimestamp = new Map<string, number>();

  constructor(options: DiscordBotOptions) {
    this.discordConfig = options.discordConfig;
    this.preset = options.preset || DEFAULT_PRESET;
    this.onCharacterUpdate = options.onCharacterUpdate || (() => {});

    // Load character
    if (typeof options.characterSource === "string") {
      this.character = this.loadCharacterFromFile(options.characterSource);
    } else {
      this.character = options.characterSource;
    }

    // Create Discord client
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });

    // Create command handler
    this.commandHandler = new CommandHandler(this);

    this.setupEventHandlers();
  }

  private loadCharacterFromFile(filePath: string): Character {
    try {
      if (!existsSync(filePath)) throw new Error("Character file not found");
      const characterData = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(characterData);
      const character: Character = {
        name: parsed.data.name,
        description: parsed.data.description,
        mesExample: parsed.data.mes_example || "",
        depthPrompt: parsed.data?.extensions?.depth_prompt || null,
        character_book: parsed.data?.character_book || null,
      };
      if (character.depthPrompt && (!character.depthPrompt.depth || !character.depthPrompt.prompt)) {
        console.warn("Invalid depth prompt configuration in character.json. Disabling depth prompt.");
        character.depthPrompt = null;
      }
      if (!character.name || !character.description) {
        throw new Error("Character name or description missing in character file");
      }
      return character;
    } catch (error) {
      console.error("Error loading character.json:", error);
      throw error;
    }
  }

  private setupEventHandlers() {
    this.client.once(Events.ClientReady, async () => {
      console.log(`Logged in as ${this.client.user?.tag}`);
      console.log(`Character: ${this.character.name}`);
      console.log(`Monitoring channel: ${this.discordConfig.channelId || "all channels"}`);
      console.log(`Random response rate: 1 in ${this.discordConfig.randomResponseRate}`);

      await this.commandHandler.registerCommands(this.client.user!.id);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(message);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      await this.commandHandler.handleInteraction(interaction);
    });
  }

  private shouldRespond(message: Message): boolean {
    const channelid = message.channelId;
    if (this.isBusy.get(channelid)) return false;
    if (!this.runtimeEnabled) return false;

    const canUserMention =
      this.discordConfig.replyToMentions || this.discordConfig.mentionTriggerAllowedUserIds.includes(message.author.id);

    // Enforce minimum interval between responses in the same channel
    const lastTs = this.lastResponseTimestamp.get(channelid) || 0;
    const now = Date.now();
    if (now - lastTs < this.discordConfig.minResponseIntervalSeconds * 1000) return false;

    // Don't respond to self
    if (message.author.id === this.client.user?.id) return false;

    // Don't respond to other bots
    if (message.author.bot && this.discordConfig.ignoreOtherBots) return false;

    // Only respond in the configured channel
    if (message.channelId !== this.discordConfig.channelId && this.discordConfig.channelId) return false;

    // Only check for any type of mention/keyword triggers if allowed
    if (canUserMention) {
      // Check if bot is mentioned
      if (message.mentions.has(this.client.user!.id)) return true;

      // Check if character name is in the message (full word match only)
      const characterName = this.character?.name.toLowerCase() || "";
      const characterNameRegex = new RegExp(`\\b${characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (characterNameRegex.test(message.content)) return true;

      // Check for trigger keywords (full word match only)
      for (const keyword of this.discordConfig.triggerKeywords) {
        const keywordRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (keywordRegex.test(message.content)) return true;
      }
    }

    // Random response
    if (this.randomResponsesEnabled && this.discordConfig.randomResponseRate > 0) {
      this.messageCounter++;
      if (Math.random() * this.discordConfig.randomResponseRate < 1) return true;
    }

    return false;
  }

  private async handleMessage(message: Message) {
    if (!this.shouldRespond(message)) return;
    this.isBusy.set(message.channelId, true);

    let typingInterval: NodeJS.Timeout | null = null;

    try {
      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping();
        typingInterval = setInterval(async () => {
          if ("sendTyping" in message.channel) {
            try {
              await message.channel.sendTyping();
            } catch (error) {
              // Ignore errors from typing
            }
          }
        }, 8000);
      }

      const response = await generateAIResponse(message, this.character, this.discordConfig);

      if (typingInterval) clearInterval(typingInterval);

      // Process any lorebook editing commands
      const { cleanedResponse, edited, updatedCharacter } = processLorebookCommands(response, this.character);

      if (edited) {
        console.log("Lorebook was updated by the character.");
        this.character = updatedCharacter;
        await this.onCharacterUpdate(updatedCharacter);
      }

      if (cleanedResponse && cleanedResponse.trim()) {
        // Split long messages if needed (Discord has a 2000 character limit)
        const chunks = cleanedResponse.match(/[\s\S]{1,2000}/g) || [];
        for (const chunk of chunks) await message.reply(chunk);
      }
    } catch (error) {
      if (typingInterval) clearInterval(typingInterval);

      console.error("Error handling message:", error);
      await message.reply("*Something went wrong... The static consumes my words.*");
    } finally {
      this.isBusy.set(message.channelId, false);
      this.lastResponseTimestamp.set(message.channelId, Date.now());
    }
  }

  // Public getters/setters for command handler
  public getCharacter(): Character {
    return this.character;
  }

  public setCharacter(character: Character) {
    this.character = character;
  }

  public getConfig(): DiscordConfig {
    return this.discordConfig;
  }

  public getClient(): Client {
    return this.client;
  }

  public toggleRandomResponses(): boolean {
    this.randomResponsesEnabled = !this.randomResponsesEnabled;
    return this.randomResponsesEnabled;
  }

  public toggleRuntime(): boolean {
    this.runtimeEnabled = !this.runtimeEnabled;
    return this.runtimeEnabled;
  }

  public async start() {
    await this.client.login(this.discordConfig.botToken);
  }

  public async stop() {
    await this.client.destroy();
  }
}
