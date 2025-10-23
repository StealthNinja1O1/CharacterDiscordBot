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
import { generateResponse } from "./api/glm.js";
import { fetchMessageHistory, formatMessagesForAI } from "./classes/MessageHistory.js";
import { countTokens, countMessageTokens } from "./utils/tokenCounter.js";

// Load character from JSON
let character: any;
try {
  const characterData = readFileSync("./src/character.json", "utf-8");
  const parsed = JSON.parse(characterData);
  character = {
    id: "character",
    name: parsed.data.name,
    description: parsed.data.description,
    mesExample: parsed.data.mes_example,
  };
} catch (error) {
  console.error("Error loading character.json:", error);
  process.exit(1);
}

// Bot state
let randomResponsesEnabled = true;
let messageCounter = 0;
let isBusy = false; // Track if bot is currently generating a response

// Create Discord client
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

// Handle slash commands
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

// Check if bot should respond
function shouldRespond(message: Message): boolean {
  // Don't respond if already busy generating a response
  if (isBusy) return false;

  // Don't respond to self
  if (message.author.id === client.user?.id) return false;

  // Don't respond to other bots
  if (message.author.bot) return false;

  // Only respond in the configured channel
  if (message.channelId !== discordConfig.channelId) return false;

  // Check if bot is mentioned
  if (message.mentions.has(client.user!.id)) return true;

  // Check if character name is in the message
  const characterName = character.name.toLowerCase();
  if (message.content.toLowerCase().includes(characterName)) return true;

  // Random response
  if (randomResponsesEnabled) {
    messageCounter++;
    if (Math.random() * discordConfig.randomResponseRate < 1) return true;
  }

  return false;
}

// Generate AI response
async function generateAIResponse(message: Message): Promise<string> {
  try {
    // Get display name (server nickname > global display name > username)
    console.log(message)
    const userDisplayName = message.author.displayName || message.author.username;
    
    // Fetch message history
    const history = await fetchMessageHistory(message, discordConfig.maxHistoryMessages, character.name);

    // Format history for AI
    const formattedHistory = formatMessagesForAI(history, userDisplayName, character.name);

    // Add current message
    formattedHistory.push({
      role: "user",
      content: `{{user}}: ${message.content}`,
    });

    // Build initial AI request to get system prompt
    const initialRequest = buildAIRequest({
      character,
      messages: [],
      userName: userDisplayName,
    });

    // Count system prompt tokens
    const systemPromptTokens = countTokens(initialRequest.messages[0].content);
    const maxTokens = discordConfig.maxContextTokens;
    let availableTokens = maxTokens - systemPromptTokens;

    // Trim messages to fit within token limit (keep newest messages)
    const trimmedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    // Start from the most recent message and work backwards
    for (let i = formattedHistory.length - 1; i >= 0; i--) {
      const msg = formattedHistory[i];
      const msgTokens = countTokens(msg.content) + countTokens(msg.role) + 4;

      if (availableTokens - msgTokens < 0 && trimmedMessages.length > 0) {
        // Would exceed limit, stop here
        break;
      }

      availableTokens -= msgTokens;
      trimmedMessages.unshift(msg); // Add to beginning to maintain order
    }

    console.log(
      `📊 Token usage: System=${systemPromptTokens}, Messages=${
        maxTokens - systemPromptTokens - availableTokens
      }, Total=${maxTokens - availableTokens}/${maxTokens}`
    );

    // Build final AI request with trimmed messages
    const aiRequest = buildAIRequest({
      character,
      messages: trimmedMessages.map((msg, index) => ({
        id: `msg-${index}`,
        role: msg.role,
        content: msg.content,
        createdAt: new Date(),
      })),
      userName: userDisplayName,
    });

    // Generate response
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

  // Set busy flag
  isBusy = true;

  let typingInterval: NodeJS.Timeout | null = null;

  try {
    // Start continuous typing indicator (Discord typing lasts ~10 seconds, so we refresh it every 8 seconds)
    if ("sendTyping" in message.channel) {
      await message.channel.sendTyping();
      typingInterval = setInterval(async () => {
        if ("sendTyping" in message.channel) {
          try {
            await message.channel.sendTyping();
          } catch (error) {
            // Ignore errors from typing (e.g., if channel becomes unavailable)
          }
        }
      }, 8000);
    }

    // Generate response
    const response = await generateAIResponse(message);

    // Stop typing indicator
    if (typingInterval) {
      clearInterval(typingInterval);
    }

    // Send response
    if (response && response.trim()) {
      // Split long messages if needed (Discord has a 2000 character limit)
      const chunks = response.match(/[\s\S]{1,2000}/g) || [];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    }
  } catch (error) {
    // Stop typing indicator on error
    if (typingInterval) {
      clearInterval(typingInterval);
    }
    console.error("Error handling message:", error);
    await message.reply("*Something went wrong... The static consumes my words.*");
  } finally {
    // Always clear busy flag when done (success or error)
    isBusy = false;
  }
});

// Bot ready event
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  console.log(`📝 Character: ${character.name}`);
  console.log(`📢 Monitoring channel: ${discordConfig.channelId}`);
  console.log(`🎲 Random response rate: 1 in ${discordConfig.randomResponseRate}`);

  // Register slash commands
  await registerCommands();
});

// Login
client.login(discordConfig.botToken).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
