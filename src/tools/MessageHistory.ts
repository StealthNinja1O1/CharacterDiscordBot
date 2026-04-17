import { Message, User } from "discord.js";
import { ImageAttachment, ReactionInfo } from "../models.js";

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
 * Replace Discord mentions (<@userid>) with display names
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

/**
 * Fetches message history from a Discord channel
 */
export async function fetchMessageHistory(message: Message, limit: number, botId: string | null): Promise<HistoryMessage[]> {
  const messages: HistoryMessage[] = [];

  try {
    const fetchedMessages = await message.channel.messages.fetch({
      limit: limit,
      before: message.id,
    });

    const sortedMessages = Array.from(fetchedMessages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
      const hasStickers = msg.stickers.size > 0;
      if (msg.author.bot && msg.content.trim() === "" && !hasStickers) continue;
      let processedContent = await replaceMentionsWithNames(msg.content, msg);

      // Translate stickers into text context
      if (hasStickers) {
        const stickerStr = Array.from(msg.stickers.values())
          .map((s) => `Sent sticker: "${s.name}"`)
          .join(", ");
        processedContent = processedContent.trim()
          ? `${processedContent}\n${stickerStr}`
          : stickerStr;
      }
      const isBotMessage = msg.author.bot && (botId && msg.author.id === botId);

      // Fetch reactions for this message
      const reactions: ReactionInfo[] = [];
      if (msg.reactions.cache.size > 0) {
        for (const reaction of msg.reactions.cache.values()) {
          try {
            const users = await reaction.users.fetch();
            reactions.push({
              emoji: reaction.emoji.toString(),
              userIds: users.map((u) => u.id),
              userNames: users.map((u) => u.displayName || u.username),
            });
          } catch {
            // Skip reactions we can't fetch
          }
        }
      }

      messages.push({
        id: msg.id,
        role: isBotMessage ? "assistant" : "user",
        content: processedContent,
        createdAt: msg.createdAt,
        member: msg.author,
        reactions: reactions.length > 0 ? reactions : undefined,
      });
    }
  } catch (error) {
    console.error("Error fetching message history:", error);
  }

  return messages;
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
      console.warn(`Failed to download image from ${url}: ${response.statusText}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error(`Error encoding image from ${url}:`, error);
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
  const images: ImageAttachment[] = [];

  for (const attachment of Array.from(message.attachments.values())) {
    if (isImageAttachment(attachment)) {
      const url = attachment.url;
      const contentType = attachment.contentType;

      if (url && contentType) {
        const base64 = await downloadAndEncodeImage(url, contentType);
        if (base64) {
          images.push({
            url: url,
            contentType: contentType,
            base64: base64,
          });
        }
      }
    }
  }

  return images;
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
    console.error("Error fetching referenced message:", error);
    return null;
  }
}

/**
 * Extracts sticker images from a Discord message and encodes them to base64.
 * Skips LOTTIE format stickers (JSON animations, not raster images).
 * Used for vision context so the bot can "see" stickers sent by users.
 */
export async function extractStickerImagesFromMessage(message: Message): Promise<ImageAttachment[]> {
  const images: ImageAttachment[] = [];

  for (const sticker of message.stickers.values()) {
    // Skip LOTTIE stickers (format 3) — they're JSON animations, not raster images
    if (sticker.format === 3) continue;

    const url = sticker.url;
    if (!url) continue;

    const contentType = sticker.format === 2 ? "image/apng" : "image/png";
    const base64 = await downloadAndEncodeImage(url, contentType);
    if (base64) {
      images.push({ url, contentType, base64 });
    }
  }

  return images;
}
