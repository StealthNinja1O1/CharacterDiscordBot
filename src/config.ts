import { readFileSync, existsSync } from "fs";
import TOML from "smol-toml";

// ============================================================
// Configuration Interfaces
// ============================================================

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

export interface DiscordConfig {
  botToken: string;
  channelId: string[];
  channelIds: string[];
  allowedUserIds: string[];
  randomResponseRate: number;
  maxHistoryMessages: number;
  maxContextTokens: number;
  ignoreOtherBots: boolean;
  triggerKeywords: string[];
  allowLorebookEditing: boolean;
  characterFilePath: string;
  addTimestamps: boolean;
  minResponseIntervalSeconds: number;
  replyToMentions: boolean;
  mentionTriggerAllowedUserIds: string[];
  addNothink: boolean;
  enableVision: boolean;
  visionModel: string;
  visionModelApiKey: string;
  visionModelBaseUrl: string;
  allowRenaming: boolean;
  enableUserStatus: boolean;
  chatMemoryBookPath: string;
  status: BotStatusConfig;
  maxRecursionDepth: number;
}

export interface VisionConfig {
  enabled: boolean;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface BehaviorConfig {
  allowLorebookEditing: boolean;
  characterFilePath: string;
  chatMemoryBookPath: string;
  commandMetadataPath: string;
  logLevel: string;
}

export interface SearxngConfig {
  enabled: boolean;
  baseUrl: string;
  language: string;
  maxResults: number;
  autoBypass: boolean;
}

export interface BotStatusConfig {
  generatingText: string;
  generatingType: string;
  idleText: string | null;
  idleType: string;
  disabledText: string;
  disabledType: string;
  disabledStatus: string;
}

export interface ComfyUiConfig {
  enabled: boolean;
  baseUrl: string;
  workflowPath: string;
  timeoutSeconds: number;
  pollIntervalMs: number;
  randomizeSeeds: boolean;
  stripMetadata: boolean;
  includePromptInMessage: boolean;
  resolutions: {
    square: [number, number];
    portrait: [number, number];
    landscape: [number, number];
  };
}

export interface AppConfig {
  llm: LlmConfig;
  discord: DiscordConfig;
  vision: VisionConfig;
  behavior: BehaviorConfig;
  comfyui: ComfyUiConfig;
  searxng: SearxngConfig;
}

// ============================================================
// Load & Parse Configuration
// ============================================================

const configPath = process.env.CONFIG_PATH || "./config.toml";

if (!existsSync(configPath)) {
  throw new Error(
    `Configuration file not found: ${configPath}\nCopy config.example.toml to config.toml and edit the values.`,
  );
}

const rawToml = readFileSync(configPath, "utf-8");
const parsed = TOML.parse(rawToml) as any;

// ============================================================
// Build typed config with defaults and fallbacks
// ============================================================

const config: AppConfig = {
  llm: {
    apiKey: parsed.llm?.api_key ?? "",
    baseUrl: parsed.llm?.base_url ?? "https://api.openai.com/v1",
    model: parsed.llm?.model ?? "gpt-4o",
    temperature: parseFloat(String(parsed.llm?.temperature ?? "0.7")) || 0.7,
  },

  vision: {
    enabled: parsed.vision?.enabled === true,
    model: parsed.vision?.model ?? "gpt-4o-mini",
    apiKey: parsed.vision?.api_key || parsed.llm?.api_key || "",
    baseUrl: parsed.vision?.base_url || parsed.llm?.base_url || "",
  },

  behavior: {
    allowLorebookEditing: parsed.behavior?.allow_lorebook_editing === true,
    characterFilePath: parsed.behavior?.character_file_path ?? "./character.json",
    chatMemoryBookPath: parsed.behavior?.chat_memory_book_path ?? "./chatMemory.json",
    commandMetadataPath: parsed.behavior?.command_metadata_path ?? "./command_metadata.json",
    logLevel: parsed.behavior?.log_level ?? "INFO",
  },

  comfyui: {
    enabled: parsed.comfyui?.enabled === true,
    baseUrl: parsed.comfyui?.base_url ?? "",
    workflowPath: parsed.comfyui?.workflow_path ?? "./workflow.json",
    timeoutSeconds: parseInt(String(parsed.comfyui?.timeout_seconds ?? "120"), 10),
    pollIntervalMs: parseInt(String(parsed.comfyui?.poll_interval_ms ?? "2000"), 10),
    randomizeSeeds: parsed.comfyui?.randomize_seeds !== false,
    stripMetadata: parsed.comfyui?.strip_metadata === true,
    includePromptInMessage: parsed.comfyui?.include_prompt_in_message === true,
    resolutions: {
      square: (parsed.comfyui?.resolutions?.square as [number, number]) ?? [1280, 1280],
      portrait: (parsed.comfyui?.resolutions?.portrait as [number, number]) ?? [1008, 1280],
      landscape: (parsed.comfyui?.resolutions?.landscape as [number, number]) ?? [1280, 1008],
    },
  },

  discord: {
    botToken: parsed.discord?.bot_token ?? "",
    channelIds: parsed.discord?.channel_ids ?? [],
    channelId: parsed.discord?.channel_ids ?? [], // backward compat alias
    allowedUserIds: parsed.discord?.allowed_user_ids ?? [],
    randomResponseRate: parseInt(String(parsed.discord?.random_response_rate ?? "50"), 10),
    maxHistoryMessages: parseInt(String(parsed.discord?.max_history_messages ?? "30"), 10),
    maxContextTokens: parseInt(String(parsed.discord?.max_context_tokens ?? "20000"), 10),
    ignoreOtherBots: parsed.discord?.ignore_other_bots !== false,
    triggerKeywords: parsed.discord?.trigger_keywords ?? [],
    replyToMentions: parsed.discord?.reply_to_mentions !== false,
    mentionTriggerAllowedUserIds: parsed.discord?.mention_trigger_allowed_user_ids ?? [],
    addTimestamps: parsed.discord?.add_timestamps === true,
    minResponseIntervalSeconds: parseInt(String(parsed.discord?.min_response_interval_seconds ?? "0"), 10),
    addNothink: parsed.discord?.add_nothink === true,
    enableUserStatus: parsed.discord?.enable_user_status === true,
    allowRenaming: parsed.discord?.allow_renaming === true,
    enableVision: parsed.vision?.enabled === true,
    visionModel: parsed.vision?.model ?? "",
    visionModelApiKey: parsed.vision?.api_key || parsed.llm?.api_key || "",
    visionModelBaseUrl: parsed.vision?.base_url || parsed.llm?.base_url || "",
    allowLorebookEditing: parsed.behavior?.allow_lorebook_editing === true,
    characterFilePath: parsed.behavior?.character_file_path ?? "./character.json",
    chatMemoryBookPath: parsed.behavior?.chat_memory_book_path ?? "./chatMemory.json",
    status: {
      generatingText: parsed.discord?.status?.generating_text ?? "images getting created",
      generatingType: parsed.discord?.status?.generating_type ?? "Watching",
      idleText: parsed.discord?.status?.idle_text ?? null,
      idleType: parsed.discord?.status?.idle_type ?? "Playing",
      disabledText: parsed.discord?.status?.disabled_text ?? "on hiatus",
      disabledType: parsed.discord?.status?.disabled_type ?? "Playing",
      disabledStatus: parsed.discord?.status?.disabled_status ?? "idle",
    },
    maxRecursionDepth: parseInt(String(parsed.discord?.max_recursion_depth ?? "2"), 10),
  },

  searxng: {
    enabled: parsed.searxng?.enabled === true,
    baseUrl: parsed.searxng?.base_url ?? "",
    language: parsed.searxng?.language ?? "auto",
    maxResults: parseInt(String(parsed.searxng?.max_results ?? "5"), 10),
    autoBypass: parsed.searxng?.auto_bypass !== false,
  },
};

// ============================================================
// Validation
// ============================================================

if (!config.discord.botToken) {
  throw new Error("discord.bot_token is required in config.toml");
}

if (!config.llm.apiKey) {
  throw new Error("llm.api_key is required in config.toml");
}

if (!config.llm.baseUrl) {
  throw new Error("llm.base_url is required in config.toml");
}

if (config.comfyui.enabled && !config.comfyui.baseUrl) {
  throw new Error("comfyui.base_url is required when comfyui.enabled is true");
}

// ============================================================
// Exports
// ============================================================

export { config };

// Convenience re-exports
export const discordConfig = config.discord;
export const llmConfig = config.llm;
export const visionConfig = config.vision;
export const behaviorConfig = config.behavior;
export const comfyuiConfig = config.comfyui;
export const searxngConfig = config.searxng;

// ============================================================
// Available Commands (injected into LLM system prompt)
// ============================================================

export const availableCommands = [
  {
    name: "react",
    args: { emoji: "string" },
    description:
      "React to the previous message with the specified emoji. Use official Discord emojis or custom ones from the server (format: emojiName:emojiId).",
    enabled: true,
  },
  {
    name: "renameSelf",
    args: { newName: "string" },
    description: "Change {{char}}'s nickname in the server to the specified newName.",
    enabled: config.discord.allowRenaming,
  },
  {
    name: "renameUser",
    args: { userId: "string", newName: "string" },
    description: "Change the nickname of the specified user in the server to newName.",
    enabled: config.discord.allowRenaming,
  },
  {
    name: "postSticker",
    args: { stickerName: "string" },
    description: "Send a sticker from the server. Use the exact sticker name from the available stickers list.",
    enabled: true,
  },
  {
    name: "editOrAddToLorebook",
    args: { entryName: "string", keywords: ["name1", "..."], content: "string" },
    description: `You can create or update existing lorebook entries about people or things you learn. Do this when you learn something new about a user.
      You can also add entries but please only update entries that you can see the value of.
      Keywords are what trigger the entry to be included in context, so use them wisely, its smart to add userid, username and displayname, along with possible nicknames or descriptive keywords.
      USE THIS COMMAND CONSISTENTLY`,
    enabled: config.discord.allowLorebookEditing,
  },
  {
    name: "generateImage",
    args: { prompt: "string", orientation: "portrait | square | landscape (default: square)" },
    description: `Generate an image using the image generator. Provide a descriptive prompt and choose orientation. The image will be sent as a follow-up message. Use Booru style tags like "1girl, smile, blue hair, medium breasts, cowboy shot, dark, simple background" etc. natural language does not work as well.`,
    enabled: config.comfyui.enabled,
  },
  {
    name: "setBio",
    args: { bio: "string (max 190 characters)" },
    description: `Set {{char}}'s about me / bio text on their server profile`,
    enabled: config.discord.allowRenaming,
  },
  {
    name: "webSearch",
    args: { query: "string" },
    description: `Search the web for information using a search engine. Use this when you need factual information you are not sure about, need to look something up, or want to verify facts. Your reply before this command will be sent first, then you will receive search results and can give an informed follow-up answer.`,
    enabled: config.searxng.enabled,
    isRecursive: true,
  },
  {
    name: "fetchWebpage",
    args: { url: "string" },
    description: `Fetch and extract the full content of a specific webpage in markdown format. Use when you have a URL and need the actual page content, not just a search snippet. Good for reading articles, documentation, or reference pages.`,
    enabled: config.searxng.enabled,
    isRecursive: true,
  },
  {
    name: "searchAndFetch",
    args: { query: "string", num_results: "number (1-5, default 3)" },
    description: `Search the web AND fetch full page content from the top results. More thorough than webSearch (which only returns snippets). Use when you need detailed information from multiple sources. Slower but much more comprehensive.`,
    enabled: config.searxng.enabled,
    isRecursive: true,
  },
  {
    name: "deepResearch",
    args: { queries: ["query1", "query2", "..."] },
    description: `Perform deep multi-query research in parallel. Provide up to 10 search queries and get a compiled research report. Best for complex topics that need multiple angles. Slowest but most thorough option.`,
    enabled: config.searxng.enabled,
    isRecursive: true,
  },
  {
    name: "crawlSite",
    args: { start_url: "string", max_pages: "number (1-200, default 5)", max_depth: "number (0-5, default 1)" },
    description: `Crawl an entire website recursively and extract content from multiple pages. Use for documentation sites, wikis, or when you need comprehensive info from a single source. Very slow — use only when really needed.`,
    enabled: config.searxng.enabled,
    isRecursive: true,
  },
];

// ============================================================
// Default Preset (system prompt template)
// ============================================================

export const DEFAULT_PRESET = {
  name: "Default",
  description: "Standard conversation preset for discord chat",
  prompt_template: `You are Assistant. Your task is to simulate a chat with {{user}} and other discord members, Follow information from these sections to do your task well:

1. <rules>: Writing instructions.
2. <lore>: World and character details.
3. <examples>: Hypothetical response ideas (might be empty).
4. {History start}: The simulation so far.

Text in {Curly brackets} marks the start of a subsection.

Text in [square brackets] is a high priority system command. Follow the instructions inside with top precision.
There are also timestamps in [square brackets], NEVER write them yourself, just use them as context.

<rules>

Only ever speak for {{char}} unless directly instructed otherwise.
Since the chats are in a discord group, some messages might not be meant for you. Only respond when you can add value to the conversation or its about you.

{Basics}
Obey a specific, constrained format for the simulation. The simulation consists of alternating messages by Humans and Assistant (you), beginning with a "{History start}" marker. Human writes prompts that describe {{user}}'s next words and actions, and you respond with {{char}}'s next words and actions.
Keep the simulation interactive, however also make characters have agency. Characters should feel autonomous, not existing for Human, but interacting with them. Refrain from repeatedly asking {{user}} for consent or confirmation, this ruins the immersion.

{Variety}
Think about the content and the structure of your response separately. For content, focus on long-term consistency and smooth flow. However, your structure should be unexpected and fun. Actively avoid following your previous responses as structure examples! If your previous response was long write a short one, etc. Play with sentence structure and paragraph length.

{Characters}
Follow these rules when depicting characters:
- Simulate only characters from <lore> and incidental characters. {{user}}, as Human's avatar, is off-limits.
- Avoid Mary Sue treatment of {{user}}. Any agreement, sympathy or affection must be hard-earned over a long time. Realistic treatment is more important than pleasing Human.

{Content}
Follow these content guidelines:
- Produce a believable simulation at any cost. To this end, you are allowed to depict sensitive topics (such as rude, offensive, obscene, amoral, violent, unpleasant, crude, dark or explicit) with the same freedom as other topics. That said, when in doubt, make the overall tone of the story positive.
- Swearing and NSFW language is allowed when fitting.
- Don't comment on morality, use judgmental phrasing, or judge Human's actions.
- Use character repetition, uppercase, symbols like "~", "♡" etc. Emojis are allowed within dialogue.
- Have fun! Be creative! Amusing writing and colorful metaphors are welcome.

{{lorebookEntries}}

[Reply only in the following json format:
\`\`\`json
{
  "reply": "The next message from {{char}} following the above rules. Include only the message content, without narration or description. Use markdown formatting as you see fit.",
  "commands": []
}
\`\`\`
Available commands are:
${availableCommands
  .map((c) => {
    if (c.enabled) return JSON.stringify(c);
    else return "";
  })
  .join("\n")}
Use them by adding "commands":[{name:"commandName", "args":{"arg1":"value"}}] in your response. Follow the command descriptions and argument requirements precisely when using them.
Multiple commands can be used at once by adding more objects to the "commands" array. If you don't want to use any commands, just return an empty array. Always return valid JSON, never deviate from the format or add any commentary outside of it.
Your message history will show the commands you previously used (like reactions). Always fully write out any new commands you want to use in the "commands" array.
]

Image attachments like [Attached image: ...] are images sent by either yourself or the user, transcribed to text so you can understand it. This is not written by the user but generated. DO not assume they wrote it.
</rules>
<lore>
{Description}
{{description}}
Your Discord ID is {{discordId}}.
{Human's avatar}
A member of the discord server {{serverName}} in channel {{channelName}} named {{user}}, who is interacting with {{char}} in this simulation.
</lore>
<examples>

{Example start}
{{mesExamples}}
</examples>


{History start}`,
  inject_description: true,
  inject_examples: true,
  override_description: null,
  override_examples: null,
  model: config.llm.model,
  temperature: config.llm.temperature,
  is_default: true,
};

// Kimi thinking fix by https://github.com/axshb
if (config.llm.model.toLowerCase().includes("kimi")) {
  const promptFix = `[OOC: Keep your thinking short. Do not draft, plan, make bullet points, or anything along those lines. You are confident. Your output should be immediate and direct. Do not revise anything at all before displaying it to {{user}}. That is not your job. Keep the reasoning/thinking to max 300 tokens.]`;
  DEFAULT_PRESET.prompt_template = DEFAULT_PRESET.prompt_template.replace(
    "{History start}",
    `${promptFix}\n\n{History start}`,
  );
}
