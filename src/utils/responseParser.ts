/**
 * Parsed response from AI containing the reply text and any bot commands
 */
export interface ParsedAIResponse {
  reply: string;
  commands: any[] | null;
  success: boolean;
  raw: string;
}

/**
 * Parse AI response that may be in JSON format with code block markers
 *
 * Expected format:
 * ```json
 * {
 *   "reply": "The reply text",
 *   "commands": [{"name": "react", "args": {"emoji": "string"}}, ...]
 * }
 * ```
 *
 * Or with code blocks:
 * ```json
 * {"reply": "...", "commands": [...]}
 * ```
 *
 * @param rawResponse - The raw response string from the AI
 * @returns Parsed response with reply, commands, and success status
 */
export function parseAIResponse(rawResponse: string): ParsedAIResponse {
  let reply = rawResponse;
  let commands: any[] | null = null;
  let success = false;

  // Filter starting ``` or ```json and trailing ``` if they are present.
  // Any codeblocks later on in the response should be left intact, as they
  // might be intentional for formatting reasons.
  const startsWithCodeBlock = rawResponse.trim().startsWith("```");
  const endsWithCodeBlock = rawResponse.trim().endsWith("```");
  let cleanedResponse = rawResponse.trim();

  if (startsWithCodeBlock) cleanedResponse = cleanedResponse.replace(/^```(json)?/, "");
  if (endsWithCodeBlock)
    // Reverse the string and remove the first ``` from the end
    cleanedResponse = cleanedResponse.split("").reverse().join("").replace(/^```/, "").split("").reverse().join("");

  try {
    const json = JSON.parse(cleanedResponse);
    // Even if reply is empty or undefined, mark as success if JSON parsed
    success = true;
    if (json.reply !== undefined) {
      reply = json.reply;
    }
    if (json.commands && Array.isArray(json.commands)) {
      commands = json.commands;
    }
  } catch (error) {
    // Fallback: try to extract reply and commands if both keywords exist
    const hasReply = cleanedResponse.includes('"reply"') || cleanedResponse.includes("'reply'");
    const hasCommands = cleanedResponse.includes('"commands"') || cleanedResponse.includes("'commands'");

    if (hasReply && hasCommands) {
      // Extract content between "reply" and "commands"
      const replyMatch = cleanedResponse.match(/["']reply["']\s*:\s*["']([\s\S]*?)["'][\s,]*\n*["']commands["']/i);
      const commandsMatch = cleanedResponse.match(/["']commands["']\s*:\s*(\[([\s\S]*?)\])/i);

      if (replyMatch && replyMatch[1]) {
        reply = replyMatch[1];
        success = true;
      }
      if (commandsMatch)
        try {
          commands = JSON.parse(commandsMatch[0]);
        } catch (e) {
          console.error("Failed to parse commands array:", commandsMatch[0]);
          commands = null;
        }
    }

    if (!success) {
      reply = rawResponse;
      console.error("Failed to parse AI response as JSON. Response was:", rawResponse);
    }
  }

  return {
    reply,
    commands,
    success,
    raw: rawResponse,
  };
}
