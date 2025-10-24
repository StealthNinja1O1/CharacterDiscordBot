import { DEFAULT_PRESET } from "../config.js";

interface Message {
  id: string;
  chatId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
  parentId?: string | null;
  variantIndex?: number;
}

interface Character {
  id: string;
  name: string;
  displayName?: string | null;
  description: string;
  mesExample?: string | null;
  depthPrompt?: {
    depth: number;
    prompt: string;
  } | null;
}

interface Preset {
  name: string;
  prompt_template: string;
  inject_description: boolean;
  inject_examples: boolean;
  override_description?: string | null;
  override_examples?: string | null;
  model: string;
  temperature: number;
}

interface AIRequestBody {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature: number;
  character: string;
}

interface BuildPromptOptions {
  character: Character;
  messages: Message[];
  preset?: Preset | null;
  userName?: string;
}

export function buildAIRequest({ character, messages, userName = "User" }: BuildPromptOptions): AIRequestBody {
  const charName = character.name || character.displayName || "Character";
  const charDescription = DEFAULT_PRESET.inject_description
    ? character.description
    : DEFAULT_PRESET.override_description || "";

  const charExamples = DEFAULT_PRESET.inject_examples
    ? character.mesExample || ""
    : DEFAULT_PRESET.override_examples || "";

  // Build replacements object
  const replacements: Record<string, string> = {
    description: charDescription,
    mesExamples: charExamples, // TODO: parse these properly, but it sort of works for now
    // order matters. since the description and examples may contain {{user}} or {{char}}
    user: userName || "User",
    char: charName,
  };

  const aiMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
      content: DEFAULT_PRESET.prompt_template,
    },
  ];

  // Add conversation history
  messages.forEach((msg) => {
    aiMessages.push({
      role: msg.role,
      content: msg.content,
    });
  });

  // Insert depth_prompt if it exists
  if (character.depthPrompt && character.depthPrompt.depth >= 0) {
    const depth = character.depthPrompt.depth;

    // Count backwards through messages, treating consecutive assistant messages as one unit
    let depthCount = 0;
    let targetIndex = -1;
    let lastRole: string | null = null;
    for (let i = aiMessages.length - 1; i > 0; i--) {
      const currentRole = aiMessages[i].role;
      if (currentRole === "user" || (currentRole === "assistant" && lastRole !== "assistant")) {
        if (depthCount === depth) {
          targetIndex = i;
          break;
        }
        depthCount++;
      }
      lastRole = currentRole;
    }

    // If depth is too large (no message at that position), append to system prompt instead
    if (targetIndex <= 0) {
      aiMessages[0].content += "\n" + character.depthPrompt.prompt;
    } else {
      aiMessages[targetIndex].content += "\n" + character.depthPrompt.prompt;
    }
  }

  const temperature = DEFAULT_PRESET.temperature > 1 ? DEFAULT_PRESET.temperature / 100 : DEFAULT_PRESET.temperature;

  // replace all  {{user}} and {{char}} in the messages content
  aiMessages.forEach((msg) => {
    msg.content = replacePlaceholders(msg.content, replacements);
  });
  // console.log(aiMessages, "\n\n\n\n");

  return {
    model: DEFAULT_PRESET.model,
    messages: aiMessages,
    temperature,
    character: character.id,
  };
}

/**
 * Replace placeholders in a template string
 */
function replacePlaceholders(template: string, replacements: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(replacements)) {
    // Case-insensitive replacement for all variations
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    result = result.replace(regex, value);
  }

  return result;
}
