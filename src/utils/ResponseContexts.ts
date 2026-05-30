import { AttachmentBuilder, Message, CommandInteraction } from "discord.js";

export interface AttachmentData {
  buffer: Buffer;
  name: string;
}

/**
 * Unified response interface for sending replies across different Discord contexts.
 *
 * Regular messages use reply() then channel.send()
 * Interactions use editReply() then followUp()
 */
export interface ResponseContext {
  sendReply(content: string): Promise<void>;
  sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<void>;
}

/**
 * ResponseContext for regular Discord messages.
 * sendReply -> message.reply(), sendFollowUp -> message.channel.send()
 */
export class MessageResponseContext implements ResponseContext {
  constructor(private message: Message) {}

  async sendReply(content: string): Promise<void> {
    if (!content?.trim()) return;
    const chunks = content.match(/[\s\S]{1,2000}/g) || [];
    for (const chunk of chunks) await this.message.reply(chunk);
  }

  async sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<void> {
    const channel = this.message.channel as import("discord.js").TextChannel;
    await channel.send({
      content: content || undefined,
      files: files?.length ? files : undefined,
    });
  }
}

/**
 * ResponseContext for Discord slash commands / interactions.
 * Assumes deferReply() was already called.
 * sendReply -> interaction.editReply(), sendFollowUp -> interaction.followUp()
 */
export class InteractionResponseContext implements ResponseContext {
  constructor(
    private interaction:
      | CommandInteraction
      | {
          editReply: (content: string) => Promise<any>;
          followUp: (options: { content?: string; files?: AttachmentBuilder[] }) => Promise<any>;
        },
  ) {}

  async sendReply(content: string): Promise<void> {
    if (!content?.trim()) return;
    const chunks = content.match(/[\s\S]{1,2000}/g) || [content];
    await this.interaction.editReply(chunks[0]!);
    for (let i = 1; i < chunks.length; i++) await this.interaction.followUp({ content: chunks[i]! });
  }

  async sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<void> {
    await this.interaction.followUp({
      content: content || undefined,
      files: files?.length ? files : undefined,
    });
  }
}
