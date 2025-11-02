import { DEFAULT_PRESET, DiscordConfig, discordConfig } from "../config.js";
import { Character, Message, AIRequestBody } from "../models.js";
import { processLorebook } from "./lorebook.js";
import { parseLorebook } from "./normalizeLorebook.js";
import { generateResponse } from "../api/llm.js";
import { fetchMessageHistory, formatMessagesForAI } from "../classes/MessageHistory.js";
import { countTokens } from "../utils/tokenCounter.js";
import { Message as DiscordMessage } from "discord.js";

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

interface BuildPromptOptions {
  character: Character;
  messages: Message[];
  preset?: Preset | null;
  userName?: string;
}

export async function buildAIRequest({
  character,
  messages,
  userName = "User",
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
    aiMessages.push({
      role: msg.role,
      content:
        msg.content + (discordConfig.addTimestamps ? `\n[${msg?.createdAt?.toISOString() || "unknown time"}]` : ""),
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

  // Build lorebook editing instructions if enabled
  const lorebookEditingInstructions = discordConfig.allowLorebookEditing
    ? `\n{Lorebook Editing}\nYou can update existing lorebook entries about people or things you learn. Do this CONSISTENTLY when you learn something new about a user. To update an entry, use: createOrEditLore("EntryName", "new content here"), dont add backticks or newlines.\nYou can also add entries but please only update entries that you can see the value of. This command will be hidden from users and yourself.\nAvailable entries: ${
        character.character_book?.entries?.map((e: any) => e.name).join(", ") || "none"
      }\n`
    : "";

  if (character.character_book) {
    const book = await parseLorebook(character.character_book);
    const { list } = processLorebook(messages, book);
    if (list.length > 0)
      aiMessages[0].content +=
        "\n" + list.map((entry) => `Lorebook entry "${entry?.name}"; content: ${entry.content}`).join("\n ") + "\n";
  }

  // Build replacements object including lorebook
  const replacements: Record<string, string> = {
    description: charDescription,
    mesExamples: charExamples,
    lorebookEditing: lorebookEditingInstructions,
    user: userName || "User",
    char: charName,
  };

  // replace all  {{user}} and {{char}} in the messages content
  aiMessages.forEach((msg) => {
    msg.content = replacePlaceholders(msg.content, replacements);
  });

  // console.log(aiMessages[0].content.slice(-5000));

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

export async function generateAIResponse(
  message: DiscordMessage,
  character: Character,
  config: DiscordConfig
): Promise<string> {
  try {
    const userDisplayName = message.author.displayName || message.author.username;
    const history = await fetchMessageHistory(message, config.maxHistoryMessages);
    const formattedHistory = formatMessagesForAI(history, userDisplayName);

    // Replace mentions in the current message
    const processedContent = await replaceMentionsWithNames(message.content, message);
    const guildEmojis = message.guild?.emojis.cache || null;

    formattedHistory.push({
      role: "user",
      content: `{{user}}: ${processedContent}`,
      createdAt: message.createdAt,
    });

    const initialRequest = await buildAIRequest({
      character,
      messages: [],
      userName: userDisplayName,
    });

    const systemPromptTokens = countTokens(initialRequest.messages[0].content);
    const maxTokens = config.maxContextTokens;
    let availableTokens = maxTokens - systemPromptTokens;

    const trimmedMessages: Array<{ role: "user" | "assistant"; content: string; createdAt: Date }> = [];

    // Start from the most recent message and work backwards
    for (let i = formattedHistory.length - 1; i >= 0; i--) {
      const msg = formattedHistory[i];
      const msgTokens = countTokens(msg.content) + countTokens(msg.role) + 4;

      if (availableTokens - msgTokens < 0 && trimmedMessages.length > 0) break;

      availableTokens -= msgTokens;
      trimmedMessages.unshift(msg);
    }

    const aiRequest = await buildAIRequest({
      character,
      messages: trimmedMessages.map((msg, index) => ({
        id: `msg-${index}`,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      })),
      userName: userDisplayName,
    });

    const response = await generateResponse(aiRequest.model, aiRequest.messages, aiRequest.temperature);

    return response;
  } catch (error) {
    console.error("Error generating AI response:", error);
    throw error;
  }
}


/**
 * Replace Discord mentions (<@userid>) with display names in a message
 */
async function replaceMentionsWithNames(content: string, message: DiscordMessage): Promise<string> {
  let processedContent = content;

  // Match user mentions: <@userid> or <@!userid>
  const mentionPattern = /<@!?(\d+)>/g;
  const mentions = Array.from(content.matchAll(mentionPattern));

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