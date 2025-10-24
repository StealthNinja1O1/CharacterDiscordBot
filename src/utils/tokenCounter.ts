import { encode } from "gpt-tokenizer";

/**
 * Count tokens in a string using gpt-tokenizer
 */
export function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch (error) {
    console.error("Error counting tokens:", error);
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens in an array of messages
 */
export function countMessageTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, msg) => {
    const roleTokens = countTokens(msg.role);
    const contentTokens = countTokens(msg.content);
    return total + roleTokens + contentTokens + 4;
  }, 0);
}
