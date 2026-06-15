import { AttachmentBuilder, Message, CommandInteraction, TextChannel } from "discord.js";

export interface AttachmentData {
  buffer: Buffer;
  name: string;
}

/**
 * Unified response interface for sending replies across different Discord contexts.
 *
 * Regular messages use reply() then channel.send()
 * Interactions use editReply() then followUp()
 *
 * sendReply and sendFollowUp return the Discord message ID of the first sent message,
 * or undefined if nothing was sent (empty content).
 */
export interface ResponseContext {
  sendReply(content: string): Promise<string | undefined>;
  sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<string | undefined>;
}

/**
 * ResponseContext for regular Discord messages.
 * sendReply -> message.reply(), sendFollowUp -> message.channel.send()
 */
export class MessageResponseContext implements ResponseContext {
  constructor(private message: Message) {}

  async sendReply(content: string): Promise<string | undefined> {
    if (!content?.trim()) return undefined;
    const chunks = content.match(/[\s\S]{1,2000}/g) || [];
    let firstId: string | undefined;
    for (let i = 0; i < chunks.length; i++) {
      const sent = await this.message.reply(chunks[i]!);
      if (i === 0) firstId = sent.id;
    }
    return firstId;
  }

  async sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<string | undefined> {
    const channel = this.message.channel as TextChannel;
    const sent = await channel.send({
      content: content || undefined,
      files: files?.length ? files : undefined,
    });
    return sent.id;
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

  async sendReply(content: string): Promise<string | undefined> {
    if (!content?.trim()) return undefined;
    const chunks = content.match(/[\s\S]{1,2000}/g) || [content];
    const first = await this.interaction.editReply(chunks[0]!);
    const firstId = first?.id;
    for (let i = 1; i < chunks.length; i++) await this.interaction.followUp({ content: chunks[i]! });
    return firstId;
  }

  async sendFollowUp(content: string, files?: AttachmentBuilder[]): Promise<string | undefined> {
    const sent = await this.interaction.followUp({
      content: content || undefined,
      files: files?.length ? files : undefined,
    });
    return sent?.id;
  }
}
