import {
  Interaction,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { DiscordBot } from "../classes/DiscordBot.js";
import CommandManager from "./CommandManager.js";
import { readFileSync, writeFileSync } from "fs";
import { LorebookEntry } from "../models.js";

export default class CommandHandler {
  private bot: DiscordBot;
  private commandManager: CommandManager;

  constructor(bot: DiscordBot) {
    this.bot = bot;
    this.commandManager = new CommandManager();
  }

  async registerCommands(applicationId: string) {
    await this.commandManager.registerCommands(applicationId);
  }

  async handleInteraction(interaction: Interaction) {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction as ChatInputCommandInteraction;
    const config = this.bot.getConfig();

    // Only allow configured admin users to run slash commands
    if (!config.allowedUserIds.includes(cmd.user.id)) {
      await cmd.reply({ content: "You don't have permission to use this command.", ephemeral: true });
      return;
    }

    const name = cmd.commandName;

    try {
      if (name === "togglerandom") {
        const enabled = this.bot.toggleRandomResponses();
        await cmd.reply({ content: `Random responses are now ${enabled ? "enabled" : "disabled"}.`, ephemeral: true });
        return;
      }

      if (name === "togglementions") {
        config.replyToMentions = !config.replyToMentions;
        await cmd.reply({
          content: `Reply to mentions is now ${config.replyToMentions ? "enabled" : "disabled"}.`,
          ephemeral: true,
        });
        return;
      }

      if (name === "togglebot") {
        const enabled = this.bot.toggleRuntime();
        await cmd.reply({ content: `Bot runtime is now ${enabled ? "enabled" : "disabled"}.`, ephemeral: true });
        return;
      }

      if (name === "update") {
        await this.handleUpdateCommand(cmd);
        return;
      }

      if (name === "lorebook") {
        await this.handleLorebookCommand(cmd);
        return;
      }

      if (name === "configure") {
        await this.handleConfigureCommand(cmd);
        return;
      }
    } catch (err) {
      console.error("Command error:", err);
      try {
        if (!cmd.replied) await cmd.reply({ content: "Command failed", ephemeral: true });
      } catch (_) {}
    }
  }

  private async handleUpdateCommand(cmd: ChatInputCommandInteraction) {
    const attachment = cmd.options.getAttachment("file");
    if (!attachment) {
      await cmd.reply({ content: "No file attached.", ephemeral: true });
      return;
    }

    await cmd.deferReply({ ephemeral: true });

    try {
      const res = await fetch(attachment.url);
      const text = await res.text();
      const parsed = JSON.parse(text);

      if (!parsed || !parsed.data || !parsed.data.name || !parsed.data.description) {
        await cmd.editReply({
          content: "Invalid character JSON: missing required fields (data.name or data.description).",
        });
        return;
      }

      const newCharacter = {
        name: parsed.data.name,
        description: parsed.data.description,
        mesExample: parsed.data.mes_example || "",
        depthPrompt: parsed.data?.extensions?.depth_prompt || null,
        character_book: parsed.data?.character_book || null,
      };

      // Save to configured character file path (default behavior)
      const config = this.bot.getConfig();
      writeFileSync(config.characterFilePath, JSON.stringify(parsed, null, 2), "utf-8");

      // Update bot's character
      this.bot.setCharacter(newCharacter);

      await cmd.editReply({ content: `Character updated successfully: ${newCharacter.name}` });
    } catch (err: any) {
      console.error("Error processing update file:", err);
      await cmd.editReply({ content: `Failed to process uploaded file: ${err?.message || String(err)}` });
    }
  }

  private async handleLorebookCommand(cmd: ChatInputCommandInteraction) {
    await cmd.deferReply({ ephemeral: true });

    try {
      const config = this.bot.getConfig();
      const fileText = readFileSync(config.characterFilePath, "utf-8");
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

      const collector = sent.createMessageComponentCollector({ time: 120_000 });

      collector.on("collect", async (i) => {
        if (i.user.id !== cmd.user.id) {
          await i.reply({ content: "This lorebook session is for the command user only.", ephemeral: true });
          return;
        }

        if (i.isButton()) {
          const parts = i.customId.split("_");
          if (parts[0] !== "lore") return;

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
            await i.update({
              content: `Lorebook entries: ${entries.length} entries. Use the select menu to choose an entry to view or edit.`,
              components: makeComponentsForPage(page),
            });
            return;
          }

          if (action === "edit") {
            const idx = parseInt(parts[2], 10);
            const entry = entries[idx];

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

            collector.stop("modal");

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

                entries[idx].content = newContent;
                parsed.data.character_book.entries[idx].content = newContent;
                writeFileSync(config.characterFilePath, JSON.stringify(parsed, null, 2), "utf-8");

                // Update bot's in-memory character_book
                const character = this.bot.getCharacter();
                character.character_book = parsed.data.character_book;
                this.bot.setCharacter(character);

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
                this.bot.getClient().removeListener("interactionCreate", onModal);
              }
            };

            this.bot.getClient().on("interactionCreate", onModal);

            return;
          }
        }

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
          // @ts-ignore runtime edit
          if (sent && typeof (sent as any).edit === "function") await (sent as any).edit({ components: [] });
        } catch (_) {}
      });
    } catch (err) {
      console.error("Lorebook command error:", err);
      try {
        await cmd.editReply({ content: `Error opening lorebook: ${(err as any)?.message || String(err)}` });
      } catch (_) {}
    }
  }

  private async handleConfigureCommand(cmd: ChatInputCommandInteraction) {
    const config = this.bot.getConfig();

    const rr = cmd.options.getInteger("random_response_rate");
    const mh = cmd.options.getInteger("max_history_messages");
    const mt = cmd.options.getInteger("max_context_tokens");
    const iob = cmd.options.getBoolean("ignore_other_bots");
    const tks = cmd.options.getString("trigger_keywords");
    const at = cmd.options.getBoolean("add_timestamps");
    const mint = cmd.options.getInteger("min_response_interval_seconds");

    if (rr !== null) config.randomResponseRate = rr;
    if (mh !== null) config.maxHistoryMessages = mh;
    if (mt !== null) config.maxContextTokens = mt;
    if (iob !== null) config.ignoreOtherBots = iob;
    if (tks !== null)
      config.triggerKeywords = tks
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (at !== null) config.addTimestamps = at;
    if (mint !== null) config.minResponseIntervalSeconds = mint;

    await cmd.reply({
      content: `Configuration updated. Current settings:\nRANDOM_RESPONSE_RATE=${
        config.randomResponseRate
      }\nMAX_HISTORY_MESSAGES=${config.maxHistoryMessages}\nMAX_CONTEXT_TOKENS=${
        config.maxContextTokens
      }\nIGNORE_OTHER_BOTS=${config.ignoreOtherBots}\nTRIGGER_KEYWORDS=${config.triggerKeywords.join(
        ","
      )}\nADD_TIMESTAMPS=${config.addTimestamps}\nMIN_RESPONSE_INTERVAL_SECONDS=${config.minResponseIntervalSeconds}`,
      ephemeral: true,
    });
  }
}
