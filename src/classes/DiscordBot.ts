import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  AttachmentBuilder,
  ActivityType,
  PresenceStatusData,
} from "discord.js";
import { DiscordConfig, DEFAULT_PRESET, comfyuiConfig } from "../config.js";
import { Character } from "../models.js";
import { readFileSync, existsSync } from "fs";
import {
  executeBotCommands,
  executeInstantCommands,
  executeAsyncCommands,
  splitCommands,
} from "../utils/botCommandHandler.js";
import { parseAIResponse } from "../utils/responseParser.js";
import { generateAIResponse } from "../tools/prompt.js";
import {
  fetchReferencedMessage,
  extractImagesFromMessage,
  extractStickerImagesFromMessage,
} from "../tools/MessageHistory.js";
import { loadChatMemoryBook, saveChatMemoryBook, upsertChatMemoryEntry } from "../tools/chatMemoryBook.js";
import CommandHandler from "../commands/CommandHandler.js";
import { MessageQueue } from "./MessageQueue.js";
import { log } from "../utils/logger.js";
import { MessageResponseContext } from "../utils/ResponseContexts.js";

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
  private messageQueue = new MessageQueue();
  public botDiscordId: string | null = null;
  private chatMemoryBook;

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

    this.chatMemoryBook = loadChatMemoryBook(this.discordConfig.chatMemoryBookPath);

    // Optional intent for user status if enabled in config
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];
    if (this.discordConfig.enableUserStatus) intents.push(GatewayIntentBits.GuildPresences);

    // Create Discord client
    this.client = new Client({
      intents,
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
        chatMemoryBook: null, // loaded separately from chatMemory.json
      };
      if (character.depthPrompt && (!character.depthPrompt.depth || !character.depthPrompt.prompt)) {
        log.warn("Invalid depth prompt configuration, disabling");
        character.depthPrompt = null;
      }
      if (!character.name || !character.description) {
        throw new Error("Character name or description missing in character file");
      }
      return character;
    } catch (error) {
      log.error("Error loading character file:", error);
      throw error;
    }
  }

  private setupEventHandlers() {
    this.client.once(Events.ClientReady, async () => {
      this.botDiscordId = this.client.user?.id || null;
      log.info(`Logged in as ${this.client.user?.tag}`);
      log.info(`Character: ${this.character.name}`);
      log.info(
        `Channels: ${this.discordConfig.channelId.length > 0 ? this.discordConfig.channelId.join(", ") : "all"}`,
      );
      log.info(`Random response rate: 1 in ${this.discordConfig.randomResponseRate}`);
      const visionInfo = this.discordConfig.enableVision
        ? this.discordConfig.visionModel
          ? `enabled (separate model: ${this.discordConfig.visionModel})`
          : "enabled (native)"
        : "disabled";
      log.info(
        `Vision: ${visionInfo} | Memory book editing: ${this.discordConfig.allowLorebookEditing ? "enabled" : "disabled"}`,
      );
      log.info(
        `Model: ${DEFAULT_PRESET.model} | Max tokens: ${this.discordConfig.maxContextTokens} | History: ${this.discordConfig.maxHistoryMessages} messages`,
      );
      log.info(`Memory book: ${this.chatMemoryBook.entries.length} entries loaded`);

      await this.commandHandler.registerCommands(this.client.user!.id);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(message);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      await this.commandHandler.handleInteraction(interaction);
    });
  }

  /**
   * Determines whether the bot should respond to a message.
   * @param message The Discord message to evaluate
   * @param ignoreBusy If true, skip the busy-channel check (used for queueing)
   */
  private shouldRespond(message: Message, ignoreBusy = false): boolean {
    const channelid = message.channelId;
    if (!ignoreBusy && this.isBusy.get(channelid)) return false;
    if (!this.runtimeEnabled) return false;

    const whiteListedUser = this.discordConfig.mentionTriggerAllowedUserIds.includes(message.author.id);
    const canUserMention = this.discordConfig.replyToMentions || whiteListedUser;

    // Enforce minimum interval between responses in the same channel
    const lastTs = this.lastResponseTimestamp.get(channelid) || 0;
    const now = Date.now();
    if (now - lastTs < this.discordConfig.minResponseIntervalSeconds * 1000 && !whiteListedUser) return false;

    // Don't respond to self
    if (message.author.id === this.client.user?.id) return false;

    // Don't respond to other bots
    if (message.author.bot && this.discordConfig.ignoreOtherBots) return false;

    // Only respond in the configured channel
    if (this.discordConfig.channelId.length > 0 && !this.discordConfig.channelId.includes(message.channelId)) {
      return false;
    }

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

  /**
   * Entry point for all incoming messages. Decides whether to respond immediately,
   * queue the message, or ignore it entirely.
   */
  private async handleMessage(message: Message) {
    const channelId = message.channelId;

    // If we can respond right now, process immediately
    if (this.shouldRespond(message)) {
      await this.processMessage(message);
      return;
    }

    // If the bot is busy in this channel but the message would otherwise trigger a response, queue it
    if (this.isBusy.get(channelId) && this.shouldRespond(message, true)) {
      this.messageQueue.enqueue(channelId, message);
    }
  }

  /**
   * Processes a single message: generates a response and sends it.
   * After processing, drains the queue for that channel.
   */
  private async processMessage(message: Message) {
    const channelId = message.channelId;
    this.isBusy.set(channelId, true);

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

      // Fetch reply context and images
      const referencedMsgInfo = await fetchReferencedMessage(message);
      const replyContext = referencedMsgInfo?.text || null;

      // Extract images from current message and combine with referenced message images
      const currentImages = await extractImagesFromMessage(message);
      const stickerImages = await extractStickerImagesFromMessage(message);
      const allImages = [...currentImages, ...stickerImages, ...(referencedMsgInfo?.images || [])];

      const response = await generateAIResponse(
        message,
        this.character,
        this.discordConfig,
        this.botDiscordId,
        replyContext,
        allImages,
        this.chatMemoryBook,
      );
      log.debug(`Raw LLM response: ${response}`);
      const parsed = parseAIResponse(response);
      const reply = parsed.reply;
      const ctx = new MessageResponseContext(message);

      // Split commands into instant and async
      const allCommands = parsed.commands || [];
      const { instant, async: asyncCmds } = splitCommands(allCommands);

      // 1. Execute instant commands (react, rename, lorebook, sticker)
      if (instant.length > 0) {
        const instantResults = await executeInstantCommands(instant, {
          message,
          character: this.character,
          characterFilePath: this.discordConfig.characterFilePath,
          chatMemoryBook: this.chatMemoryBook,
          chatMemoryBookPath: this.discordConfig.chatMemoryBookPath,
          onChatMemoryUpdate: (updated) => {
            this.chatMemoryBook = updated;
          },
        });
        for (const result of instantResults) {
          if (result.success) log.info(`Command: ${result.message}`);
          else log.warn(`Command failed: ${result.message}`);
        }
      }

      // 2. Send text reply immediately
      if (reply && reply.trim()) {
        await ctx.sendReply(reply);
      }

      // 3. Execute async commands (generateImage) — typing continues during this
      if (asyncCmds.length > 0) {
        this.setGeneratingPresence();
        const asyncResults = await executeAsyncCommands(asyncCmds, {
          message,
          character: this.character,
          characterFilePath: this.discordConfig.characterFilePath,
          chatMemoryBook: this.chatMemoryBook,
          chatMemoryBookPath: this.discordConfig.chatMemoryBookPath,
          onChatMemoryUpdate: (updated) => {
            this.chatMemoryBook = updated;
          },
        });
        for (const result of asyncResults) {
          if (result.success && result.attachment) {
            const file = new AttachmentBuilder(result.attachment.buffer, { name: result.attachment.name });
            const followUpText =
              comfyuiConfig.includePromptInMessage && result.prompt
                ? `image: ${result.prompt}, ${result.orientation ?? "square"}`
                : "";
            await ctx.sendFollowUp(followUpText, [file]);
            log.info(`Async command: ${result.message}`);
          } else if (result.success) {
            log.info(`Async command: ${result.message}`);
          } else {
            await ctx.sendFollowUp("*[The static interfered with the image generation...]*");
            log.warn(`Async command failed: ${result.message}`);
          }
        }
        this.setIdlePresence();
      }

      if (typingInterval) clearInterval(typingInterval);
    } catch (error) {
      if (typingInterval) clearInterval(typingInterval);
      this.setIdlePresence();

      log.error("Error handling message:", error);
      try {
        await message.reply("*Something went wrong... The static consumes my words.*");
      } catch (replyError) {
        log.error("Failed to send error reply:", replyError);
      }
    } finally {
      this.isBusy.set(channelId, false);
      this.lastResponseTimestamp.set(channelId, Date.now());

      // Drain the queue for this channel
      await this.processQueue(channelId);
    }
  }

  /**
   * Processes queued messages for a channel one at a time.
   * Re-validates each message before processing (handles stale messages, rate limits, etc.).
   */
  private async processQueue(channelId: string) {
    while (this.messageQueue.hasPending(channelId)) {
      const nextMessage = this.messageQueue.dequeue(channelId);
      if (!nextMessage) break;

      if (!this.shouldRespond(nextMessage)) {
        log.debug(`Skipping queued message from ${nextMessage.author.username} — no longer meets response criteria`);
        continue;
      }

      log.debug(
        `Processing queued message from ${nextMessage.author.username} in channel ${channelId} (remaining: ${this.messageQueue.size(channelId)})`,
      );
      await this.processMessage(nextMessage);
      return;
    }

    if (!this.messageQueue.hasPending(channelId)) log.debug(`Queue drained for channel ${channelId}`);
  }

  // Public getters/setters for command handler
  public getCharacter(): Character {
    return this.character;
  }

  public getChatMemoryBook() {
    return this.chatMemoryBook;
  }

  public setChatMemoryBook(book: typeof this.chatMemoryBook) {
    this.chatMemoryBook = book;
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
    if (this.runtimeEnabled) this.setIdlePresence();
    else this.setDisabledPresence();
    return this.runtimeEnabled;
  }

  public async start() {
    await this.client.login(this.discordConfig.botToken);
  }

  public async stop() {
    await this.client.destroy();
  }

  private activityTypeFromString(type: string): ActivityType {
    switch (type.toLowerCase()) {
      case "playing":
        return ActivityType.Playing;
      case "streaming":
        return ActivityType.Streaming;
      case "listening":
        return ActivityType.Listening;
      case "watching":
        return ActivityType.Watching;
      case "competing":
        return ActivityType.Competing;
      default:
        return ActivityType.Playing;
    }
  }

  private setBotPresence(data: { activities: { name: string; type: ActivityType }[]; status: PresenceStatusData }) {
    try {
      this.client.user?.setPresence(data);
    } catch (err) {
      log.warn("Failed to set bot presence:", err);
    }
  }

  private setGeneratingPresence() {
    const { status } = this.discordConfig;
    this.setBotPresence({
      activities: [
        {
          name: status.generatingText,
          type: this.activityTypeFromString(status.generatingType),
        },
      ],
      status: "dnd",
    });
  }

  private setIdlePresence() {
    const { status } = this.discordConfig;
    if (status.idleText && status.idleText.trim()) {
      this.setBotPresence({
        activities: [
          {
            name: status.idleText,
            type: this.activityTypeFromString(status.idleType),
          },
        ],
        status: "online",
      });
    } else {
      this.setBotPresence({
        activities: [],
        status: "online",
      });
    }
  }

  private setDisabledPresence() {
    const { status } = this.discordConfig;
    this.setBotPresence({
      activities: [
        {
          name: status.disabledText,
          type: this.activityTypeFromString(status.disabledType),
        },
      ],
      status: status.disabledStatus as PresenceStatusData,
    });
  }
}
