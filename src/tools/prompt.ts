import { DEFAULT_PERSONA, DEFAULT_PRESET } from "../constants.js";

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

interface Persona {
  id: string;
  name: string;
  description: string;
}

interface Preset {
  id: string;
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
  persona?: Persona | null;
  userName?: string;
}

export function buildAIRequest({
  character,
  messages,
  preset,
  persona,
  userName = "User",
}: BuildPromptOptions): AIRequestBody {
  // Use default preset from constants if none provided

  const defaultPreset: Preset = {
    id: "default",
    name: DEFAULT_PRESET.name,
    prompt_template: DEFAULT_PRESET.prompt_template,
    inject_description: DEFAULT_PRESET.inject_description,
    inject_examples: DEFAULT_PRESET.inject_examples,
    override_description: DEFAULT_PRESET.override_description,
    override_examples: DEFAULT_PRESET.override_examples,
    model: DEFAULT_PRESET.model,
    temperature: DEFAULT_PRESET.temperature,
  };

  const activePreset = preset || defaultPreset;

  // Process lorebooks to find triggered entries
  // TODO: These will be used later to inject into the prompt
  //   const lorebookEntries = processLorebooks(messages, books);

  // Prepare replacement values
  const charName = character.name || character.displayName || "Character";
  const charDescription = activePreset.inject_description
    ? character.description
    : activePreset.override_description || "";

  const charExamples = activePreset.inject_examples ? character.mesExample || "" : activePreset.override_examples || "";

  const personaDescription = persona ? persona.description : DEFAULT_PERSONA.description;

  // Build replacements object
  const replacements: Record<string, string> = {
    persona: personaDescription,
    description: charDescription,
    mesExamples: charExamples, // TODO: parse these properly
    // order matters. since the description and examples may contain {{user}} or {{char}}
    user: persona?.name || userName || "User",
    char: charName,
  };

  // Process the preset template
  const systemPrompt = replacePlaceholders(activePreset.prompt_template, replacements);

  // Build the messages array
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

  // Convert temperature from 0-100 scale to 0.0-1.0 if needed
  const temperature = activePreset.temperature > 1 ? activePreset.temperature / 100 : activePreset.temperature;

  // replace all  {{user}} and {{char}} in the messages content
  aiMessages.forEach((msg) => {
    msg.content = replacePlaceholders(msg.content, replacements);
  });
  console.log("AI Request Messages:", aiMessages);

  return {
    model: activePreset.model,
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
