import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { readFileSync } from "fs";
import { discordConfig } from "./config.js";
import { buildAIRequest } from "./tools/prompt.js";
import { generateResponse } from "./api/llm.js";
import { fetchMessageHistory, formatMessagesForAI } from "./classes/MessageHistory.js";
import { countTokens } from "./utils/tokenCounter.js";

let character: any;
try {
  const characterData = readFileSync("./src/character.json", "utf-8");
  const parsed = JSON.parse(characterData);
  character = {
    name: parsed.data.name,
    description: parsed.data.description,
    mesExample: parsed.data.mes_example,
    depthPrompt: parsed.data?.extensions?.depth_prompt || null,
    character_book: parsed.data?.character_book || null,
  };
  if (character.depthPrompt && (!character.depthPrompt.depth || !character.depthPrompt.prompt)) {
    console.warn("Invalid depth prompt configuration in character.json. Disabling depth prompt.");
    character.depthPrompt = null;
  }
} catch (error) {
  console.error("Error loading character.json:", error);
  process.exit(1);
}

let randomResponsesEnabled = true;
let messageCounter = 0;
let isBusy = false;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Register slash commands
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("togglerandom")
      .setDescription("Toggle random responses on/off")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  ].map((command) => command.toJSON());

  const rest = new REST().setToken(discordConfig.botToken);

  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(client.user!.id), {
      body: commands,
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction as ChatInputCommandInteraction;

  if (commandName === "togglerandom") {
    // Check if user is allowed
    if (!discordConfig.allowedUserIds.includes(user.id)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    randomResponsesEnabled = !randomResponsesEnabled;
    await interaction.reply({
      content: `Random responses are now ${randomResponsesEnabled ? "enabled" : "disabled"}.`,
      ephemeral: true,
    });
    console.log(`Random responses toggled: ${randomResponsesEnabled}`);
  }
});

function shouldRespond(message: Message): boolean {
  if (isBusy) return false;

  // Don't respond to self
  if (message.author.id === client.user?.id) return false;

  // Don't respond to other bots
  if (message.author.bot && discordConfig.ignoreOtherBots) return false;

  // Only respond in the configured channel
  if (message.channelId !== discordConfig.channelId && discordConfig.channelId) return false;

  // Check if bot is mentioned
  if (message.mentions.has(client.user!.id)) return true;

  // Check if character name is in the message
  const characterName = character.name.toLowerCase();
  if (message.content.toLowerCase().includes(characterName)) return true;

  // Check for trigger keywords
  for (const keyword of discordConfig.triggerKeywords)
    if (message.content.toLowerCase().includes(keyword.toLowerCase())) return true;

  // Random response
  if (randomResponsesEnabled && discordConfig.randomResponseRate > 0) {
    messageCounter++;
    if (Math.random() * discordConfig.randomResponseRate < 1) return true;
  }

  return false;
}

/**
 * Replace Discord mentions (<@userid>) with display names in a message
 */
async function replaceMentionsWithNames(content: string, message: Message): Promise<string> {
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

async function generateAIResponse(message: Message): Promise<string> {
  try {
    const userDisplayName = message.author.displayName || message.author.username;
    const history = await fetchMessageHistory(message, discordConfig.maxHistoryMessages);
    const formattedHistory = formatMessagesForAI(history, userDisplayName);

    // Replace mentions in the current message
    const processedContent = await replaceMentionsWithNames(message.content, message);

    formattedHistory.push({
      role: "user",
      content: `{{user}}: ${processedContent}`,
    });

    const initialRequest = await buildAIRequest({
      character,
      messages: [],
      userName: userDisplayName,
    });

    const systemPromptTokens = countTokens(initialRequest.messages[0].content);
    const maxTokens = discordConfig.maxContextTokens;
    let availableTokens = maxTokens - systemPromptTokens;

    const trimmedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

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
        createdAt: new Date(),
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

// Handle messages
client.on(Events.MessageCreate, async (message: Message) => {
  if (!shouldRespond(message)) return;
  isBusy = true;

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

    const response = await generateAIResponse(message);

    if (typingInterval) clearInterval(typingInterval);

    if (response && response.trim()) {
      // Split long messages if needed (Discord has a 2000 character limit)
      const chunks = response.match(/[\s\S]{1,2000}/g) || [];
      for (const chunk of chunks) await message.reply(chunk);
    }
  } catch (error) {
    if (typingInterval) clearInterval(typingInterval);

    console.error("Error handling message:", error);
    await message.reply("*Something went wrong... The static consumes my words.*");
  } finally {
    isBusy = false;
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Character: ${character.name}`);
  console.log(`Monitoring channel: ${discordConfig.channelId}`);
  console.log(`Random response rate: 1 in ${discordConfig.randomResponseRate}`);

  await registerCommands();
});

client.login(discordConfig.botToken).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
