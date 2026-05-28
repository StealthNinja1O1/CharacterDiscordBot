import { Message } from "discord.js";
import { log } from "../utils/logger.js";

/**
 * Per-channel FIFO message queue for handling messages that arrive while the bot is busy.
 */
export class MessageQueue {
  private queues = new Map<string, Message[]>();

  enqueue(channelId: string, message: Message): void {
    let queue = this.queues.get(channelId);
    if (!queue) {
      queue = [];
      this.queues.set(channelId, queue);
    }
    queue.push(message);
    log.debug(`Message queued for channel ${channelId} (queue depth: ${queue.length}) — ${message.author.username}: "${message.content.slice(0, 80)}"`);
  }

  dequeue(channelId: string): Message | undefined {
    const queue = this.queues.get(channelId);
    if (!queue || queue.length === 0) return undefined;
    const message = queue.shift();
    if (queue.length === 0) 
      this.queues.delete(channelId);
    return message;
  }

  hasPending(channelId: string): boolean {
    const queue = this.queues.get(channelId);
    return !!queue && queue.length > 0;
  }

  size(channelId: string): number {
    return this.queues.get(channelId)?.length ?? 0;
  }

  clear(channelId: string): void {
    this.queues.delete(channelId);
  }
}
