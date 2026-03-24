export interface DiscordConfig {
  botToken: string;
  channelId: string;
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
  allowRenaming: boolean;
  enableUserStatus: boolean;
  timeoutSeconds: number;
}

export const discordConfig: DiscordConfig = {
  botToken: process.env.DISCORD_BOT_TOKEN || "",
  channelId: process.env.DISCORD_CHANNEL_ID || "",
  allowedUserIds: (process.env.DISCORD_ALLOWED_USERS || "").split(",").filter(Boolean),
  randomResponseRate: parseInt(process.env.RANDOM_RESPONSE_RATE || "50", 10),
  maxHistoryMessages: parseInt(process.env.MAX_HISTORY_MESSAGES || "20", 10),
  maxContextTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || "20000", 10),
  ignoreOtherBots: process.env.IGNORE_OTHER_BOTS === "true" || true,
  triggerKeywords: (process.env.TRIGGER_KEYWORDS || "").split(",").filter(Boolean),
  allowLorebookEditing: process.env.ALLOW_LOREBOOK_EDITING === "true" || false,
  characterFilePath: process.env.CHARACTER_FILE_PATH || "./character.json",
  addTimestamps: process.env.ADD_TIMESTAMPS === "true" || false,
  minResponseIntervalSeconds: parseInt(process.env.MIN_RESPONSE_INTERVAL_SECONDS || "0", 10),
  replyToMentions: process.env.REPLY_TO_MENTIONS === "true" || true,
  mentionTriggerAllowedUserIds: (process.env.MENTION_TRIGGER_ALLOWED_USERS || "").split(",").filter(Boolean),
  addNothink: process.env.ADD_NOTHINK === "true" || false,
  enableVision: process.env.ENABLE_VISION === "true" || false,
  allowRenaming: process.env.ALLOW_RENAMING === "true" || false,
  enableUserStatus: process.env.ENABLE_USER_STATUS === "true" || false,
  timeoutSeconds: parseInt(process.env.TIMEOUT_SECONDS || "0", 10),
};

if (!discordConfig.botToken) throw new Error("DISCORD_BOT_TOKEN is not configured in .env file");
// doesnt have to be locked to 1 channel, so commented out
// if (!discordConfig.channelId) throw new Error("DISCORD_CHANNEL_ID is not configured in .env file");

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
    enabled: discordConfig.allowRenaming,
  },
  {
    name: "renameUser",
    args: { userId: "string", newName: "string" },
    description: "Change the nickname of the specified user in the server to newName.",
    enabled: discordConfig.allowRenaming,
  },
  {
    name: "editOrAddToLorebook",
    args: { entryName: "string", keywords: ["name1", "..."], content: "string" },
    description:
      `You can create or update existing lorebook entries about people or things you learn. Do this when you learn something new about a user.
      You can also add entries but please only update entries that you can see the value of.
      Keywords are what trigger the entry to be included in context, so use them wisely, its smart to add userid, username and displayname, along with possible nicknames or descriptive keywords. 
      USE THIS COMMAND CONSISTENTLY`,
    enabled: discordConfig.allowLorebookEditing,
  },
];

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
Your message history will always show empty command lists, but you did actually do them, so always fully write out the commands you want to use in the "commands" array.
]
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
  model: process.env.LLM_MODEL || "gpt-5-mini",
  temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7") || 0.7,
  is_default: true,
} as const;
