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

  const systemPrompt = replacePlaceholders(DEFAULT_PRESET.prompt_template, replacements);

  const aiMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  // Add conversation history
  messages.forEach((msg) => {
    aiMessages.push({
      role: msg.role,
      content: msg.content,
    });
  });

  const temperature = DEFAULT_PRESET.temperature > 1 ? DEFAULT_PRESET.temperature / 100 : DEFAULT_PRESET.temperature;

  // replace all  {{user}} and {{char}} in the messages content
  aiMessages.forEach((msg) => {
    msg.content = replacePlaceholders(msg.content, replacements);
  });

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
