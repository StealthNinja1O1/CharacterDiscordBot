import { DEFAULT_PRESET, DiscordConfig, discordConfig } from "../config.js";
import { Character, Message, AIRequestBody } from "../models.js";
import { processLorebook } from "./lorebook.js";
import { parseLorebook } from "./normalizeLorebook.js";
import { generateResponse } from "../api/llm.js";
import { fetchMessageHistory, formatMessagesForAI } from "./MessageHistory.js";
import { countTokens } from "../utils/tokenCounter.js";
import { Collection, Message as DiscordMessage, GuildEmoji } from "discord.js";

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
  botId?: string | null;
}

interface BuildPromptOptions {
  character: Character;
  messages: Message[];
  preset?: Preset | null;
  userName?: string;
  guildInfo?: GuildInfo;
}

export async function buildAIRequest({
  character,
  messages,
  userName = "User",
  guildInfo,
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

  // Add conversation history
  messages.forEach((msg) => {
    let finaltext = msg.content;
    if (!msg.content || msg.content.trim() === "") return; // Skip empty messages
    if (msg.role == "user" && discordConfig.addTimestamps)
      finaltext += `\n[${msg?.createdAt?.toISOString() || "unknown time"}]`;
    // ensure assistant messages are valid json, so it keeps using this format.
    if (msg.role == "assistant") finaltext = JSON.stringify({ reply: finaltext, commands: [] });
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

  let lorebookEntries = "Lorebook entries:\n";

  if (character.character_book) {
    const book = await parseLorebook(character.character_book);

    // create a list of all entries with name and keyword for the lorebook editing context
    if (discordConfig.allowLorebookEditing) {
      if (!book.entries || book.entries.length === 0) lorebookEntries += "No entries in the lorebook yet.\n";
      else
        for (const entry of book.entries)
          lorebookEntries += `Entry name: ${entry.name || "Unnamed entry"}; Keywords: ${
            entry.keys?.join(", ") || "No keywords"
          };\n`;
    }

    const { list } = processLorebook(messages, book);
    if (list.length > 0)
      aiMessages[0].content +=
        "\n" + list.map((entry) => `Lorebook entry "${entry?.name}"; content: ${entry.content}`).join("\n ") + "\n";
    else if (!book.entries || book.entries.length === 0)
      aiMessages[0].content += "\nNo relevant lorebook entries triggered.";
  }

  if (guildInfo?.guildEmojis) {
    const emojisList = guildInfo.guildEmojis.map((e) => `<:${e.name}:${e.id}>`).join(", ");
    aiMessages[0].content += `\nThe server has the following emojis: ${emojisList}`;
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

  // console.log(aiMessages[0].content.slice(-7000));
  // console.log(aiMessages);;

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
): Promise<string> {
  try {
    const userDisplayName = message.author.displayName || message.author.username;
    const username = message.author.username;
    const userId = message.author.id;
    const history = await fetchMessageHistory(message, config.maxHistoryMessages);
    const formattedHistory = formatMessagesForAI(history);

    // Replace mentions in the current message
    let processedContent = await replaceMentionsWithNames(message);

    const guildEmojis = message.guild?.emojis.cache || null;
    const guildName = message.guild?.name || "the server";
    const channelName: string = (message.channel as any)?.name || "a channel";
    const guildInfo = {
      guildName,
      channelName,
      guildEmojis,
      botId,
    };

    formattedHistory.push({
      role: "user",
      content: `${userDisplayName} (${username} - ${userId}): ${processedContent}`,
      createdAt: message.createdAt,
    });

    const allMessages: Message[] = formattedHistory.map((msg, index) => ({
      id: `msg-${index}`,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
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
    });

    const response = await generateResponse(model, messages, temperature, config.addNothink);

    return response;
  } catch (error) {
    console.error("Error generating AI response:", error);
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
      console.warn(`Could not resolve mention for user ${userId}`);
    }
  }

  return processedContent;
}
