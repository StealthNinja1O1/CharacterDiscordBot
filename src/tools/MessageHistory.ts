import { Message } from "discord.js";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  username?: string; // Discord name of the message author
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
  currentUserName: string
): Array<{ role: "user" | "assistant"; content: string; createdAt: Date }> {
  return messages.map((msg) => {
    let content = msg.content;

    if (msg.role === "user" && msg.username) {
      if (msg.username === currentUserName) content = `{{user}}: ${content}`;
      else content = `${msg.username}: ${content}`;
    }

    return {
      role: msg.role,
      content: content,
      createdAt: msg.createdAt,
    };
  });
}
