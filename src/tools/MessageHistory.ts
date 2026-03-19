import { Message, User } from "discord.js";
import { ImageAttachment } from "../models.js";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  member?: User | null;
}

export interface ReferencedMessageInfo {
  text: string;
  images: ImageAttachment[];
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  member?: User | null;
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
export async function fetchMessageHistory(message: Message, limit: number): Promise<HistoryMessage[]> {
  const messages: HistoryMessage[] = [];

  try {
    const fetchedMessages = await message.channel.messages.fetch({
      limit: limit,
      before: message.id,
    });

    const sortedMessages = Array.from(fetchedMessages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
      if (msg.author.bot && msg.content.trim() === "") continue;

      const processedContent = await replaceMentionsWithNames(msg.content, msg);

      messages.push({
        id: msg.id,
        role: msg.author.bot ? "assistant" : "user",
        content: processedContent,
        createdAt: msg.createdAt,
        member: msg.author,
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
): Array<{ role: "user" | "assistant"; content: string; createdAt: Date }> {
  return messages.map((msg) => {
    let content = msg.content;
    const username = msg.member?.username || "unknown";
    const userDisplayName = msg.member?.displayName || username || "unknown";
    const userId = msg.member?.id || "unknown";

    if (msg.role === "user") content = `${userDisplayName} (${username} - ${userId}): ${content}`;

    return {
      role: msg.role,
      content: content,
      createdAt: msg.createdAt,
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

    // Extract any images from the referenced message
    const images = await extractImagesFromMessage(referencedMessage);

    return {
      text,
      images,
    };
  } catch (error) {
    console.error("Error fetching referenced message:", error);
    return null;
  }
}
