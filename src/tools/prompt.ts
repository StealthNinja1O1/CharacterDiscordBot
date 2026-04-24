import { DEFAULT_PRESET, DiscordConfig, discordConfig } from "../config.js";
import { Character, Message, AIRequestBody, ImageAttachment, CharacterBook, LorebookEntry } from "../models.js";
import { ChatMemoryBook } from "./chatMemoryBook.js";
import { processLorebook } from "./lorebook.js";
import { parseLorebook } from "./normalizeLorebook.js";
import { generateResponse } from "../api/llm.js";
import { fetchMessageHistory, formatMessagesForAI } from "./MessageHistory.js";
import { countTokens } from "../utils/tokenCounter.js";
import { log } from "../utils/logger.js";
import { Collection, Message as DiscordMessage, GuildEmoji, Sticker, ActivityType } from "discord.js";

interface Preset {
  name: string;
  prompt_template: string;
  inject_description: boolean;
  inject_examples: boolean;
  override_description?: string | null;
  override_examples?: string | null;
  model: string;
  temperature: number;
}

interface GuildInfo {
  guildName: string;
  channelName: string;
  guildEmojis: Collection<string, GuildEmoji> | null;
  guildStickers: Collection<string, Sticker> | null;
  botId?: string | null;
}

interface BuildPromptOptions {
  character: Character;
  messages: Message[];
  preset?: Preset | null;
  userName?: string;
  guildInfo?: GuildInfo;
  replyContext?: string | null;
  chatMemoryBook?: ChatMemoryBook | null;
}

export async function buildAIRequest({
  character,
  messages,
  userName = "User",
  guildInfo,
  replyContext,
  chatMemoryBook,
}: BuildPromptOptions): Promise<AIRequestBody> {
  const charName = character.name || "Character";
  const charDescription = DEFAULT_PRESET.inject_description
    ? character.description
    : DEFAULT_PRESET.override_description || "";

  const charExamples = DEFAULT_PRESET.inject_description
    ? character.mesExample || ""
    : DEFAULT_PRESET.override_examples || "";

  const aiMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
      content: DEFAULT_PRESET.prompt_template,
    },
  ];

  // Add reply context if present (prepend to last user message)
  let lastUserMessageIndex = -1;
  if (replyContext) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }
  }

  // Add conversation history
  let pendingAssistantReactions: string | null = null;
  messages.forEach((msg, index) => {
    let finaltext = msg.content;
    if (!msg.content || msg.content.trim() === "") return; // Skip empty messages

    // Prepend reply context to the last user message
    if (index === lastUserMessageIndex && replyContext) {
      finaltext = `${replyContext}\n\n${finaltext}`;
    }

    if (msg.role == "user") {
      if (discordConfig.addTimestamps)
        finaltext += `\n[${msg?.createdAt?.toISOString() || "unknown time"}]`;

      // Prepend reactions from the previous assistant message above this user message
      if (pendingAssistantReactions) {
        finaltext = `[Reactions on ${charName}'s previous message: ${pendingAssistantReactions}]\n${finaltext}`;
        pendingAssistantReactions = null;
      }

      // Append reactions on this user message below it
      if (msg.reactions && msg.reactions.length > 0) {
        const reactionStr = msg.reactions.map((r) => `${r.emoji} by ${r.userNames.join(", ")}`).join("; ");
        finaltext += `\n[Reactions: ${reactionStr}]`;
      }
    }

    // ensure assistant messages are valid json, so it keeps using this format.
    // Reconstruct bot reactions from the preceding user message into the commands array.
    if (msg.role == "assistant") {
      const prevMsg = index > 0 ? messages[index - 1] : null;
      const reconstructedCommands: Array<{ name: string; args: Record<string, string> }> = [];

      if (prevMsg?.reactions && guildInfo?.botId) {
        for (const reaction of prevMsg.reactions) {
          if (reaction.userIds.includes(guildInfo.botId)) {
            reconstructedCommands.push({ name: "react", args: { emoji: reaction.emoji } });
          }
        }
      }

      finaltext = JSON.stringify({ reply: finaltext, commands: reconstructedCommands });

      // Save reactions received on this bot message to show above the next user message
      if (msg.reactions && msg.reactions.length > 0) {
        const otherReactions = msg.reactions.filter((r) => !r.userIds.includes(guildInfo?.botId || ""));
        if (otherReactions.length > 0) {
          pendingAssistantReactions = otherReactions.map((r) => `${r.emoji} by ${r.userNames.join(", ")}`).join("; ");
        }
      }
    }
    aiMessages.push({
      role: msg.role,
      content: finaltext,
    });
  });

  // Insert depth_prompt if it exists
  if (character.depthPrompt && character.depthPrompt.depth >= 0) {
    const depth = character.depthPrompt.depth;

    // Count backwards through messages, treating consecutive assistant messages as one unit
    let depthCount = 0;
    let targetIndex = -1;
    let lastRole: string | null = null;
    for (let i = aiMessages.length - 1; i > 0; i--) {
      const currentRole = aiMessages[i].role;
      if (currentRole === "user" || (currentRole === "assistant" && lastRole !== "assistant")) {
        if (depthCount === depth) {
          targetIndex = i;
          break;
        }
        depthCount++;
      }
      lastRole = currentRole;
    }

    // If depth is too large (no message at that position), append to system prompt instead
    if (targetIndex <= 0) {
      aiMessages[0].content += "\n" + character.depthPrompt.prompt;
    } else {
      aiMessages[targetIndex].content += "\n" + character.depthPrompt.prompt;
    }
  }

  const temperature = DEFAULT_PRESET.temperature > 1 ? DEFAULT_PRESET.temperature / 100 : DEFAULT_PRESET.temperature;

  // --- Lorebook processing: merge static + dynamic ---
  let lorebookEntries = "Lorebook entries:\n";
  const staticBook = character.character_book ? await parseLorebook(character.character_book) : null;

  // Build editable entries listing (for the LLM to know what it can modify)
  if (discordConfig.allowLorebookEditing) {
    // Dynamic/editable entries from ChatMemoryBook
    if (chatMemoryBook && chatMemoryBook.entries.length > 0) {
      lorebookEntries += "Editable memory entries (you can modify these with editOrAddToLorebook):\n";
      for (const entry of chatMemoryBook.entries)
        lorebookEntries += `Entry name: ${entry.name || "Unnamed entry"}; Keywords: ${
          entry.keys?.join(", ") || "No keywords"
        };\n`;
    } else {
      lorebookEntries += "No editable memory entries yet. You can create them with editOrAddToLorebook.\n";
    }
    // Static/read-only entries from character.json
    if (staticBook?.entries && staticBook.entries.length > 0) {
      lorebookEntries += "\nStatic lore entries (read-only, do NOT try to edit these):\n";
      for (const entry of staticBook.entries)
        lorebookEntries += `Entry name: ${entry.name || "Unnamed entry"}; Keywords: ${
          entry.keys?.join(", ") || "No keywords"
        };\n`;
    }
  } else {
    // No editing — just list static entries
    if (staticBook?.entries && staticBook.entries.length > 0) {
      for (const entry of staticBook.entries)
        lorebookEntries += `Entry name: ${entry.name || "Unnamed entry"}; Keywords: ${
          entry.keys?.join(", ") || "No keywords"
        };\n`;
    }
  }

  // Merge both books into a single book for processLorebook (static first = higher priority)
  const mergedEntries = [
    ...(staticBook?.entries || []),
    ...(chatMemoryBook?.entries || []),
  ];

  if (mergedEntries.length > 0) {
    const mergedBook: CharacterBook = {
      name: staticBook?.name || chatMemoryBook?.entries?.length ? "Merged" : "Lorebook",
      description: "",
      scan_depth: staticBook?.scanDepth ?? character.character_book?.scan_depth ?? 12,
      token_budget: staticBook?.tokenBudget ?? character.character_book?.token_budget ?? 1024,
      recursive_scanning: staticBook?.recursiveScanning ?? false,
      extensions: {},
      entries: mergedEntries.map((e, i) => ({
        ...e,
        id: e.id ?? i,
        name: e.name || "Unnamed",
      })) as LorebookEntry[],
    };
    const { list } = processLorebook(messages, mergedBook as any);
    if (list.length > 0)
      aiMessages[0].content +=
        "\n" + list.map((entry) => `Lorebook entry "${entry?.name}"; content: ${entry.content}`).join("\n ") + "\n";
    else
      aiMessages[0].content += "\nNo relevant lorebook entries triggered.";
  } else {
    aiMessages[0].content += "\nNo relevant lorebook entries triggered.";
  }

  if (guildInfo?.guildEmojis) {
    const emojisList = guildInfo.guildEmojis.map((e) => `<:${e.name}:${e.id}>`).join(", ");
    aiMessages[0].content += `\nThe server has the following emojis: ${emojisList}`;
  }

  if (guildInfo?.guildStickers && guildInfo.guildStickers.size > 0) {
    const stickersList = guildInfo.guildStickers.map((s) => `"${s.name}"`).join(", ");
    aiMessages[0].content += `\nThe server has the following stickers you can send using the postSticker command: ${stickersList}`;
  }

  // Build replacements object including lorebook
  const replacements: Record<string, string> = {
    description: charDescription,
    mesExamples: charExamples,
    lorebookEntries: lorebookEntries,
    user: userName || "User",
    char: charName,
    serverName: guildInfo?.guildName || "the server",
    channelName: guildInfo?.channelName || "a channel",
    discordId: guildInfo?.botId || "unknown",
  };

  // replace all  {{user}} and {{char}} in the messages content
  aiMessages.forEach((msg) => {
    msg.content = replacePlaceholders(msg.content, replacements);
  });

  return {
    model: DEFAULT_PRESET.model,
    messages: aiMessages,
    temperature,
    character: charName,
  };
}

/**
 * Replace placeholders in a template string
 */
function replacePlaceholders(template: string, replacements: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(replacements)) {
    // Case-insensitive replacement for all variations
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Trims a messages array to fit within the token budget after accounting for the system prompt.
 */
export async function trimMessagesToTokenBudget(
  messages: Message[],
  character: Character,
  userName: string,
  maxContextTokens: number,
): Promise<Message[]> {
  const initialRequest = await buildAIRequest({ character, messages: [], userName });
  const systemPromptTokens = countTokens(initialRequest.messages[0].content);
  let availableTokens = maxContextTokens - systemPromptTokens;

  const trimmed: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = countTokens(msg.content) + countTokens(msg.role) + 4;
    if (availableTokens - msgTokens < 0 && trimmed.length > 0) break;
    availableTokens -= msgTokens;
    trimmed.unshift(msg);
  }
  return trimmed;
}

export async function generateAIResponse(
  message: DiscordMessage,
  character: Character,
  config: DiscordConfig,
  botId?: string | null,
  replyContext?: string | null,
  images: ImageAttachment[] = [],
  chatMemoryBook?: ChatMemoryBook | null,
): Promise<string> {
  try {
    const userDisplayName = message.author.displayName || message.author.username;
    const username = message.author.username;
    const userId = message.author.id;
    const history = await fetchMessageHistory(message, config.maxHistoryMessages, botId || null);
    const formattedHistory = formatMessagesForAI(history);

    // Replace mentions in the current message
    let processedContent = await replaceMentionsWithNames(message);
    let userPresence = "";
    if (config.enableUserStatus) userPresence = await fetchUserPresence(message);

    const guildEmojis = message.guild?.emojis.cache || null;
    const guildStickers = message.guild ? await message.guild.stickers.fetch().catch(() => null) : null;
    const guildName = message.guild?.name || "the server";
    const channelName: string = (message.channel as any)?.name || "a channel";
    const guildInfo = {
      guildName,
      channelName,
      guildEmojis,
      guildStickers,
      botId,
    };

    formattedHistory.push({
      role: "user",
      content: `${userDisplayName} (${username} - ${userId}): ${processedContent}\n${userPresence ? `[User presence:${userPresence}]` : ""}`,
      createdAt: message.createdAt,
    });

    const allMessages: Message[] = formattedHistory.map((msg, index) => ({
      id: `msg-${index}`,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      reactions: msg.reactions,
    }));

    const trimmedMessages = await trimMessagesToTokenBudget(
      allMessages,
      character,
      userDisplayName,
      config.maxContextTokens,
    );

    const { model, messages, temperature } = await buildAIRequest({
      character,
      messages: trimmedMessages,
      userName: userDisplayName,
      guildInfo,
      replyContext,
      chatMemoryBook,
    });

    log.debug(`Sending ${trimmedMessages.length} messages to LLM (${model})`);

    const response = await generateResponse(model, messages, temperature, config.addNothink, images);

    return response;
  } catch (error) {
    log.error("Error generating AI response:", error);
    throw error;
  }
}

/**
 * Replace Discord mentions (<@userid>) with display names in a message
 */
async function replaceMentionsWithNames(message: DiscordMessage): Promise<string> {
  let processedContent = message.content;

  // Match user mentions: <@userid> or <@!userid>
  const mentionPattern = /<@!?(\d+)>/g;
  const mentions = Array.from(processedContent.matchAll(mentionPattern));

  for (const match of mentions) {
    const userId = match[1];
    const mentionText = match[0];

    try {
      // Try to get the member from the guild
      if (message.guild) {
        const member = await message.guild.members.fetch(userId);
        const displayName = member.displayName || member.user.displayName || member.user.username;
        processedContent = processedContent.replace(mentionText, `@${displayName}`);
      }
    } catch (error) {
      // If we can't fetch the user, leave the mention as-is
      log.debug(`Could not resolve mention for user ${userId}`);
    }
  }

  return processedContent;
}

/**
 * Fetches user's Discord presence (status and activities) for context
 */
async function fetchUserPresence(message: DiscordMessage): Promise<string> {
  if (!message.guild) {
    log.debug("Message is not in a guild, cannot fetch presence");
    return "";
  }

  try {
    const member = message.member;
    if (!member) return "";

    const status = member.presence?.status;
    const statusText = status ? `[${status.toUpperCase()}]` : "";
    const activities = member.presence?.activities;
    let activityText = "";

    if (activities && activities.length > 0) {
      const activityParts: string[] = [];

      for (const activity of activities) {
        const type = activity.type;
        const name = activity.name;
        const details = activity.details;
        const state = activity.state;

        switch (type) {
          case ActivityType.Playing:
            activityParts.push(`Playing ${name}${details ? ` (${details})` : ""}${state ? ` - ${state}` : ""}`);
            break;
          case ActivityType.Streaming:
            activityParts.push(`Streaming ${name}${details ? ` (${details})` : ""}`);
            break;
          case ActivityType.Listening:
            activityParts.push(`Listening to ${name}${details ? ` (${details})` : ""}`);
            break;
          case ActivityType.Watching:
            activityParts.push(`Watching ${name}${details ? ` (${details})` : ""}`);
            break;
          case ActivityType.Competing:
            activityParts.push(`Competing in ${name}${details ? ` (${details})` : ""}`);
            break;
          default:
            if (name) activityParts.push(name);
        }
      }

      if (activityParts.length > 0) {
        activityText = ` - ${activityParts.join(" | ")}`;
      }
    }

    return statusText || activityText ? ` ${statusText}${activityText}` : "";
  } catch (error) {
    // If we can't fetch presence, continue without it
    log.debug(`Could not fetch presence for user ${message.author.id}:`, error);
    return "";
  }
}
