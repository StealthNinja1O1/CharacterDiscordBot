import { Message, User } from "discord.js";

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
