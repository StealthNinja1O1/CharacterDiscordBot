import { Message } from "discord.js";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  username?: string; // Discord display name (nickname or global display name) of the message author
}

/**
 * Fetches message history from a Discord channel
 */
export async function fetchMessageHistory(
  message: Message,
  limit: number,
  characterName: string
): Promise<HistoryMessage[]> {
  const messages: HistoryMessage[] = [];

  try {
    // Fetch messages before the current one
    const fetchedMessages = await message.channel.messages.fetch({
      limit: limit,
      before: message.id,
    });

    // Convert Discord messages to our format
    const sortedMessages = Array.from(fetchedMessages.values())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
      // Skip bot's own messages that are system-like or empty
      if (msg.author.bot && msg.content.trim() === "") {
        continue;
      }

      messages.push({
        id: msg.id,
        role: msg.author.bot ? "assistant" : "user",
        content: msg.content,
        createdAt: msg.createdAt,
        // Use display name (server nickname) if available, otherwise fall back to global display name, then username
        username: msg.member?.displayName || msg.author.displayName || msg.author.username,
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
  currentUserName: string,
  characterName: string
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.map((msg) => {
    let content = msg.content;

    // For user messages, prepend the actual username from the message
    if (msg.role === "user" && msg.username) {
      // If this is the current user responding, mark them as {{user}}
      if (msg.username === currentUserName) {
        content = `{{user}}: ${content}`;
      } else {
        // Otherwise, use their actual Discord username
        content = `${msg.username}: ${content}`;
      }
    }

    return {
      role: msg.role,
      content: content,
    };
  });
}
