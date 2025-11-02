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
import { readFileSync, existsSync } from "fs";
import { discordConfig } from "./config.js";
import { processLorebookCommands } from "./utils/lorebookEditor.js";
import { Character } from "./models.js";
import CommandManager from "./commands/CommandManager.js";
import { writeFileSync } from "fs";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { LorebookEntry } from "./models.js";
import { generateAIResponse } from "./tools/prompt.js";

let character: Character;
try {
  const filePath = discordConfig.characterFilePath;
  if (!existsSync(filePath)) throw new Error("Character file not found");
  const characterData = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(characterData);
  character = {
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
} catch (error) {
  console.error("Error loading character.json:", error);
  process.exit(1);
}

if (!character) {
  console.error("Character data is null");
  process.exit(1);
}

let randomResponsesEnabled = true;
let messageCounter = 0;
// Keep the isBusy flag per channel
let isBusy = new Map<string, boolean>();
// Track last response timestamp per channel (ms since epoch)
let lastResponseTimestamp = new Map<string, number>();
// Simple runtime enabled flag (can be toggled with /toggleBot)
let runtimeEnabled = true;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Command manager (handles slash commands and emits events)
const commandManager = new CommandManager();

// Interaction handling for slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction as ChatInputCommandInteraction;

  // Only allow configured admin users to run slash commands
  if (!discordConfig.allowedUserIds.includes(cmd.user.id)) {
    await cmd.reply({ content: "You don't have permission to use this command.", ephemeral: true });
    return;
  }

  const name = cmd.commandName;

  try {
    if (name === "togglerandom") {
      randomResponsesEnabled = !randomResponsesEnabled;
      await cmd.reply({
        content: `Random responses are now ${randomResponsesEnabled ? "enabled" : "disabled"}.`,
        ephemeral: true,
      });
      return;
    }

    if (name === "togglementions") {
      // Flip the config flag (in-memory only)
      discordConfig.replyToMentions = !discordConfig.replyToMentions;
      await cmd.reply({
        content: `Reply to mentions is now ${discordConfig.replyToMentions ? "enabled" : "disabled"}.`,
        ephemeral: true,
      });
      return;
    }

    if (name === "togglebot") {
      // Toggle a simple runtime enabled flag by setting min interval to a very large value
      // or using an in-memory disabled flag. We'll add a simple runtimeEnabled flag.
      runtimeEnabled = !runtimeEnabled;
      await cmd.reply({ content: `Bot runtime is now ${runtimeEnabled ? "enabled" : "disabled"}.`, ephemeral: true });
      return;
    }

    if (name === "update") {
      // Expect an attachment option called 'file'
      const attachment = cmd.options.getAttachment("file");
      if (!attachment) {
        await cmd.reply({ content: "No file attached.", ephemeral: true });
        return;
      }

      await cmd.deferReply({ ephemeral: true });

      // Fetch the file and validate
      try {
        const res = await fetch(attachment.url);
        const text = await res.text();
        const parsed = JSON.parse(text);

        // Basic validation: check spec and data.name/data.description
        if (!parsed || !parsed.data || !parsed.data.name || !parsed.data.description) {
          await cmd.editReply({
            content: "Invalid character JSON: missing required fields (data.name or data.description).",
          });
          return;
        }

        // Save to configured character file path
        writeFileSync(discordConfig.characterFilePath, JSON.stringify(parsed, null, 2), "utf-8");

        // Reload in-memory character
        character = {
          name: parsed.data.name,
          description: parsed.data.description,
          mesExample: parsed.data.mes_example || "",
          depthPrompt: parsed.data?.extensions?.depth_prompt || null,
          character_book: parsed.data?.character_book || null,
        };

        await cmd.editReply({ content: `Character updated successfully: ${character.name}` });
      } catch (err: any) {
        console.error("Error processing update file:", err);
        await cmd.editReply({ content: `Failed to process uploaded file: ${err?.message || String(err)}` });
      }

      return;
    }

    if (name === "lorebook") {
      // Interactive lorebook browser/editor (ephemeral to the invoking user)
      await cmd.deferReply({ ephemeral: true });

      try {
        const fileText = readFileSync(discordConfig.characterFilePath, "utf-8");
        const parsed = JSON.parse(fileText);
        const entries = parsed.data?.character_book?.entries || [];

        if (!entries || entries.length === 0) {
          await cmd.editReply({ content: "No lorebook entries found." });
          return;
        }

        const pageSize = 10;
        let page = 0;
        const totalPages = Math.ceil(entries.length / pageSize);

        const makeComponentsForPage = (p: number) => {
          const start = p * pageSize;
          const slice = entries.slice(start, start + pageSize) as LorebookEntry[];

          const select = new StringSelectMenuBuilder()
            .setCustomId(`lore_select_${p}_${cmd.user.id}`)
            .setPlaceholder(`Select entry (page ${p + 1}/${totalPages})`)
            .addOptions(
              ...slice.map((e: LorebookEntry, idx: number) => ({
                label: (e.name || "(unnamed)").slice(0, 100),
                value: String(start + idx),
              }))
            );

          const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

          const prev = new ButtonBuilder()
            .setCustomId(`lore_prev_${p}_${cmd.user.id}`)
            .setLabel("Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(p <= 0);
          const next = new ButtonBuilder()
            .setCustomId(`lore_next_${p}_${cmd.user.id}`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(p >= totalPages - 1);
          const cancel = new ButtonBuilder()
            .setCustomId(`lore_cancel_${cmd.user.id}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger);

          const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next, cancel);

          return [row1, row2];
        };

        const content = `Lorebook entries: ${entries.length} entries. Use the select menu to choose an entry to view or edit.`;
        await cmd.editReply({ content, components: makeComponentsForPage(page) });
        const sent = await cmd.fetchReply();

        // Collector for interactions on the ephemeral message
        const collector = sent.createMessageComponentCollector({ time: 120_000 });

        collector.on("collect", async (i) => {
          if (i.user.id !== cmd.user.id) {
            await i.reply({ content: "This lorebook session is for the command user only.", ephemeral: true });
            return;
          }

          // Handle pagination buttons
          if (i.isButton()) {
            const parts = i.customId.split("_");
            if (parts[0] !== "lore") return;

            // parts: ['lore','prev'|'next'|'cancel'|'edit'|'back', <idx|page|userId>]
            const action = parts[1];

            if (action === "prev") {
              page = Math.max(0, page - 1);
              await i.update({
                components: makeComponentsForPage(page),
                content: `Lorebook entries: ${entries.length} entries. Use the select menu to choose an entry to view or edit.`,
              });
              return;
            }

            if (action === "next") {
              page = Math.min(totalPages - 1, page + 1);
              await i.update({
                components: makeComponentsForPage(page),
                content: `Lorebook entries: ${entries.length} entries. Use the select menu to choose an entry to view or edit.`,
              });
              return;
            }

            if (action === "cancel") {
              await i.update({ content: "Lorebook session cancelled.", components: [] });
              collector.stop();
              return;
            }

            if (action === "back") {
              // return to page view
              await i.update({
                content: `Lorebook entries: ${entries.length} entries. Use the select menu to choose an entry to view or edit.`,
                components: makeComponentsForPage(page),
              });
              return;
            }

            if (action === "edit") {
              const idx = parseInt(parts[2], 10);
              const entry = entries[idx];

              // Show modal to edit entry content
              const modal = new ModalBuilder()
                .setCustomId(`lore_modal_${idx}_${cmd.user.id}`)
                .setTitle(`Edit: ${entry.name}`);
              const input = new TextInputBuilder()
                .setCustomId("content")
                .setLabel("Entry content")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setValue(entry.content || "");

              const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
              modal.addComponents(row);

              await i.showModal(modal);

              // stop the collector while user edits in the modal to avoid updating the same interaction
              collector.stop("modal");

              // Wait for the modal submit via a one-time interaction listener
              const modalCustomId = `lore_modal_${idx}_${cmd.user.id}`;
              const onModal = async (modalInt: any) => {
                try {
                  if (!modalInt.isModalSubmit || !modalInt.isModalSubmit()) return;
                } catch (_) {
                  return;
                }

                if (modalInt.customId !== modalCustomId) return;
                if (modalInt.user.id !== cmd.user.id) return;

                try {
                  const newContent = modalInt.fields.getTextInputValue("content");

                  // Update the parsed file and save
                  entries[idx].content = newContent;
                  parsed.data.character_book.entries[idx].content = newContent;
                  writeFileSync(discordConfig.characterFilePath, JSON.stringify(parsed, null, 2), "utf-8");

                  // Update in-memory character_book
                  character.character_book = parsed.data.character_book;

                  await modalInt.reply({ content: `Entry ${entries[idx].name} updated.`, ephemeral: true });
                  try {
                    await cmd.editReply({
                      content: `**${entries[idx].name}**\n\n${entries[idx].content}`,
                      components: [],
                    });
                  } catch (e) {
                    console.warn("Could not edit original command reply after modal submit:", e);
                  }
                } catch (modalErr) {
                  console.error("Modal submit error:", modalErr);
                  try {
                    await modalInt.reply({ content: "Edit timed out or failed.", ephemeral: true });
                  } catch (_) {}
                } finally {
                  // cleanup listener
                  client.removeListener("interactionCreate", onModal);
                }
              };

              client.on("interactionCreate", onModal);

              return;
            }
          }

          // Handle select menu
          if (i.isStringSelectMenu()) {
            const selected = i.values[0];
            const idx = parseInt(selected, 10);
            const entry = entries[idx];

            const viewContent = `**${entry.name}**\n\n${entry.content || "(no content)"}`;

            const editBtn = new ButtonBuilder()
              .setCustomId(`lore_edit_${idx}_${cmd.user.id}`)
              .setLabel("Edit")
              .setStyle(ButtonStyle.Primary);
            const backBtn = new ButtonBuilder()
              .setCustomId(`lore_back_${page}_${cmd.user.id}`)
              .setLabel("Back")
              .setStyle(ButtonStyle.Secondary);
            const cancelBtn = new ButtonBuilder()
              .setCustomId(`lore_cancel_${cmd.user.id}`)
              .setLabel("Close")
              .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(editBtn, backBtn, cancelBtn);

            await i.update({ content: viewContent, components: [row] });
            return;
          }
        });

        collector.on("end", async () => {
          try {
            if (sent && typeof (sent as any).edit === "function") await (sent as any).edit({ components: [] });
          } catch (_) {}
        });
      } catch (err) {
        console.error("Lorebook command error:", err);
        try {
          await cmd.editReply({ content: `Error opening lorebook: ${(err as any)?.message || String(err)}` });
        } catch (_) {}
      }

      return;
    }

    if (name === "configure") {
      // Read options and apply to in-memory config
      const rr = cmd.options.getInteger("random_response_rate");
      const mh = cmd.options.getInteger("max_history_messages");
      const mt = cmd.options.getInteger("max_context_tokens");
      const iob = cmd.options.getBoolean("ignore_other_bots");
      const tks = cmd.options.getString("trigger_keywords");
      const at = cmd.options.getBoolean("add_timestamps");
      const mint = cmd.options.getInteger("min_response_interval_seconds");

      if (rr !== null) discordConfig.randomResponseRate = rr;
      if (mh !== null) discordConfig.maxHistoryMessages = mh;
      if (mt !== null) discordConfig.maxContextTokens = mt;
      if (iob !== null) discordConfig.ignoreOtherBots = iob;
      if (tks !== null)
        discordConfig.triggerKeywords = tks
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (at !== null) discordConfig.addTimestamps = at;
      if (mint !== null) discordConfig.minResponseIntervalSeconds = mint;

      await cmd.reply({
        content: `Configuration updated. Current settings:\nRANDOM_RESPONSE_RATE=${
          discordConfig.randomResponseRate
        }\nMAX_HISTORY_MESSAGES=${discordConfig.maxHistoryMessages}\nMAX_CONTEXT_TOKENS=${
          discordConfig.maxContextTokens
        }\nIGNORE_OTHER_BOTS=${discordConfig.ignoreOtherBots}\nTRIGGER_KEYWORDS=${discordConfig.triggerKeywords.join(
          ","
        )}\nADD_TIMESTAMPS=${discordConfig.addTimestamps}\nMIN_RESPONSE_INTERVAL_SECONDS=${
          discordConfig.minResponseIntervalSeconds
        }`,
        ephemeral: true,
      });
      return;
    }
  } catch (err) {
    console.error("Command error:", err);
    try {
      if (!cmd.replied) await cmd.reply({ content: "Command failed", ephemeral: true });
    } catch (_) {}
  }
});

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
  const channelid = message.channelId;
  if (isBusy.get(channelid)) return false;

  const canUserMention =
    discordConfig.replyToMentions || discordConfig.mentionTriggerAllowedUserIds.includes(message.author.id);

  // Enforce minimum interval between responses in the same channel
  const lastTs = lastResponseTimestamp.get(channelid) || 0;
  const now = Date.now();
  if (now - lastTs < discordConfig.minResponseIntervalSeconds * 1000) return false;

  // Don't respond to self
  if (message.author.id === client.user?.id) return false;

  // Don't respond to other bots
  if (message.author.bot && discordConfig.ignoreOtherBots) return false;

  // Only respond in the configured channel
  if (message.channelId !== discordConfig.channelId && discordConfig.channelId) return false;

  // Only check for any type of mention/keyword triggers if allowed
  if (canUserMention) {
    // Check if bot is mentioned
    if (message.mentions.has(client.user!.id)) return true;

    // Check if character name is in the message (full word match only)
    const characterName = character?.name.toLowerCase() || "";
    const characterNameRegex = new RegExp(`\\b${characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (characterNameRegex.test(message.content)) return true;

    // Check for trigger keywords (full word match only)
    for (const keyword of discordConfig.triggerKeywords) {
      const keywordRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (keywordRegex.test(message.content)) return true;
    }
  }

  // Random response
  if (randomResponsesEnabled && discordConfig.randomResponseRate > 0) {
    messageCounter++;
    if (Math.random() * discordConfig.randomResponseRate < 1) return true;
  }

  return false;
}

// Handle messages
client.on(Events.MessageCreate, async (message: Message) => {
  if (!shouldRespond(message)) return;
  isBusy.set(message.channelId, true);

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

    const response = await generateAIResponse(message, character, discordConfig);

    if (typingInterval) clearInterval(typingInterval);

    // Process any lorebook editing commands
    const { cleanedResponse, edited, updatedCharacter } = processLorebookCommands(response, character);

    if (edited) {
      console.log("Lorebook was updated by the character.");
      character = updatedCharacter; // Update the in-memory character object
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
    isBusy.set(message.channelId, false);
    // Update last response timestamp to enforce minimum interval
    lastResponseTimestamp.set(message.channelId, Date.now());
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Character: ${character.name}`);
  console.log(`Monitoring channel: ${discordConfig.channelId}`);
  console.log(`Random response rate: 1 in ${discordConfig.randomResponseRate}`);

  // Register slash commands using CommandManager
  await commandManager.registerCommands(client.user!.id);
});

client.login(discordConfig.botToken).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
