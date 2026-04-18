import { Message, User } from "discord.js";
import { ImageAttachment, ReactionInfo } from "../models.js";
import { log } from "../utils/logger.js";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  member?: User | null;
  reactions?: ReactionInfo[];
}

export interface ReferencedMessageInfo {
  text: string;
  images: ImageAttachment[];
}

export interface FormattedMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  reactions?: ReactionInfo[];
}

/**
 * Fetches message history from a Discord channel
 */
export async function fetchMessageHistory(message: Message, limit: number, botId: string | null): Promise<HistoryMessage[]> {
  try {
    const fetchedMessages = await message.channel.messages.fetch({
      limit: limit,
      before: message.id,
    });

    const sortedMessages = Array.from(fetchedMessages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // got high latency. every mention was a serial guild.members.fetch per message. 
    // collect unique IDs here, resolve in parallel below.
    const mentionPattern = /<@!?(\d+)>/g;
    const allMentionIds = new Set<string>();
    for (const msg of sortedMessages) {
      for (const match of msg.content.matchAll(mentionPattern)) {
        allMentionIds.add(match[1]);
      }
    }

    const memberNameMap = new Map<string, string>();
    if (message.guild && allMentionIds.size > 0) {
      await Promise.all([...allMentionIds].map(async (userId) => {
        const cached = message.guild!.members.cache.get(userId);
        if (cached) {
          memberNameMap.set(userId, cached.displayName || cached.user.displayName || cached.user.username);
          return;
        }
        try {
          const member = await message.guild!.members.fetch(userId);
          memberNameMap.set(userId, member.displayName || member.user.displayName || member.user.username);
        } catch {
          log.debug(`Could not resolve mention for user ${userId}`);
        }
      }));
    }

    const resolveMentions = (content: string): string =>
      content.replace(mentionPattern, (_, userId) => {
        const name = memberNameMap.get(userId);
        return name ? `@${name}` : `<@${userId}>`;
      });

    const processed = await Promise.all(
      sortedMessages.map(async (msg) => {
        const hasStickers = msg.stickers.size > 0;
        if (msg.author.bot && msg.content.trim() === "" && !hasStickers) return null;

        let processedContent = resolveMentions(msg.content);

        if (hasStickers) {
          const stickerStr = Array.from(msg.stickers.values())
            .map((s) => `Sent sticker: "${s.name}"`)
            .join(", ");
          processedContent = processedContent.trim()
            ? `${processedContent}\n${stickerStr}`
            : stickerStr;
        }

        const isBotMessage = msg.author.bot && (botId && msg.author.id === botId);

        const reactionResults = await Promise.all(
          Array.from(msg.reactions.cache.values()).map(async (reaction) => {
            try {
              const users = await reaction.users.fetch();
              return {
                emoji: reaction.emoji.toString(),
                userIds: users.map((u) => u.id),
                userNames: users.map((u) => u.displayName || u.username),
              };
            } catch {
              return null;
            }
          })
        );
        const reactions = reactionResults.filter((r): r is ReactionInfo => r !== null);

        return {
          id: msg.id,
          role: isBotMessage ? "assistant" : "user",
          content: processedContent,
          createdAt: msg.createdAt,
          member: msg.author,
          reactions: reactions.length > 0 ? reactions : undefined,
        } as HistoryMessage;
      })
    );

    return processed.filter((m): m is HistoryMessage => m !== null);
  } catch (error) {
    log.error("Error fetching message history:", error);
    return [];
  }
}

/**
 * Formats message history for the AI with user replacements
 */
export function formatMessagesForAI(
  messages: HistoryMessage[],
): FormattedMessage[] {
  return messages.map((msg) => {
    let content = msg.content;
    const username = msg.member?.username || "unknown";
    const userDisplayName = msg.member?.displayName || username || "unknown";
    const userId = msg.member?.id || "unknown";

    if (msg.role === "user") content = `${userDisplayName} (${username} - ${userId}): ${content}`;

    // Append reactions inline
    if (msg.reactions && msg.reactions.length > 0) {
      const reactionStr = msg.reactions
        .map((r) => `${r.emoji} by ${r.userNames.join(", ")}`)
        .join("; ");
      content += ` [Reactions: ${reactionStr}]`;
    }

    return {
      role: msg.role,
      content: content,
      createdAt: msg.createdAt,
      reactions: msg.reactions,
    };
  });
}

/**
 * Downloads an image from a URL and converts it to base64
 */
async function downloadAndEncodeImage(url: string, contentType: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      log.warn(`Failed to download image from ${url}: ${response.statusText}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    log.error(`Error encoding image from ${url}:`, error);
    return null;
  }
}

/**
 * Checks if a Discord attachment is an image
 */
function isImageAttachment(attachment: any): boolean {
  const contentType = attachment.contentType || "";
  return contentType.startsWith("image/");
}

/**
 * Extracts image attachments from a Discord message and encodes them to base64
 */
export async function extractImagesFromMessage(message: Message): Promise<ImageAttachment[]> {
  // same serial for-await pattern as above - parallel downloads instead
  const results = await Promise.all(
    Array.from(message.attachments.values())
      .filter(isImageAttachment)
      .map(async (attachment) => {
        const { url, contentType } = attachment;
        if (!url || !contentType) return null;
        const base64 = await downloadAndEncodeImage(url, contentType);
        return base64 ? { url, contentType, base64 } : null;
      })
  );
  return results.filter((img): img is ImageAttachment => img !== null);
}

/**
 * Fetches the message that the current message is replying to, if any
 * Returns formatted reply context text and any images from the referenced message
 */
export async function fetchReferencedMessage(message: Message): Promise<ReferencedMessageInfo | null> {
  if (!message.reference || !message.reference.messageId) {
    return null;
  }

  try {
    // Fetch the referenced message
    const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
    if (!referencedMessage) {
      return null;
    }

    // Get author display name
    const displayName = referencedMessage.member?.displayName || referencedMessage.author.displayName || referencedMessage.author.username;

    // Format the reply context
    const text = `{{user}} is replying to ${referencedMessage.content} (by @${displayName})`;

    // Extract any images and sticker images from the referenced message
    const images = await extractImagesFromMessage(referencedMessage);
    const stickerImages = await extractStickerImagesFromMessage(referencedMessage);
    const allRefImages = [...images, ...stickerImages];

    return {
      text,
      images: allRefImages,
    };
  } catch (error) {
    log.error("Error fetching referenced message:", error);
    return null;
  }
}

/**
 * Extracts sticker images from a Discord message and encodes them to base64.
 * Skips LOTTIE format stickers (JSON animations, not raster images).
 * Used for vision context so the bot can "see" stickers sent by users.
 */
export async function extractStickerImagesFromMessage(message: Message): Promise<ImageAttachment[]> {
  // same
  const results = await Promise.all(
    Array.from(message.stickers.values())
      .filter((s) => s.format !== 3) // format 3 is LOTTIE - JSON animation, not raster
      .map(async (sticker) => {
        if (!sticker.url) return null;
        const contentType = sticker.format === 2 ? "image/apng" : "image/png";
        const base64 = await downloadAndEncodeImage(sticker.url, contentType);
        return base64 ? { url: sticker.url, contentType, base64 } : null;
      })
  );
  return results.filter((img): img is ImageAttachment => img !== null);
}
