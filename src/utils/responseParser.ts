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
    if (json.reply) {
      reply = json.reply;
      success = true;
    }
    if (json.commands && Array.isArray(json.commands)) {
      commands = json.commands;
    }
  } catch (error) {
    reply = rawResponse;
    success = false;
    console.error("Failed to parse AI response as JSON. Response was:", rawResponse);
  }

  return {
    reply,
    commands,
    success,
    raw: rawResponse,
  };
}
