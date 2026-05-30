# Character Discord Bot

A Discord bot that roleplays as a character defined by a Character Card V2 JSON file. Uses OpenAI-compatible APIs for response generation with a DIY tool-calling system that works with any model - including non-tool-calling ones.

## Features

### Core
- **Character-based RP** - Reads Character Card V2 files (name, description, examples, depth prompt, lorebook)
- **Smart triggers** - Responds when mentioned, when the character name appears, on configured keywords, or randomly
- **Token-aware context** - Automatically trims message history to fit within token limits
- **Multi-channel support** - Can be locked to specific channels or monitor all channels
- **Timestamps** - Optional timestamps in message context for temporal awareness
- **User presence** - Optionally shows Discord status/activities in context

### Tool-Calling System (DIY JSON)
The bot outputs structured JSON with `reply` and `commands` fields. This works with any model that can follow JSON format instructions:

- **`react`** - React to messages with emojis (unicode or custom server emojis)
- **`renameSelf`** - Change the bot's nickname (gated by `allow_renaming`, runtime-guarded against prompt injection)
- **`renameUser`** - Change a user's nickname (permission-checked, runtime-guarded)
- **`postSticker`** - Send a server sticker by name
- **`editOrAddToLorebook`** - Create or update dynamic memory entries (writes to `chatMemory.json`, never touches static lorebook)
- **`generateImage`** - Generate an image via ComfyUI with a prompt and orientation (sent as follow-up message)

### Stickers
- Server stickers are listed in the system prompt so the bot knows what's available
- Sticker-only messages are translated to `Sent sticker: "Name"` in context
- When vision is enabled, sticker images are passed to the LLM so the bot can "see" them
- Stickers in replied-to messages are also passed as vision context

### Reactions
- Per-message reactions are shown inline in context: `[Reactions: 👍 by Alice; 😂 by Bot]`
- The bot's past reactions are reconstructed in history as commands - so the LLM sees what it previously did
- The bot can also see reactions from others on its own messages

### Lorebook System
- **Static lorebook** - Entries from the character card (`character.json`). Read-only in the prompt; the bot is told not to edit these
- **Chat Memory Book** - Dynamic entries stored in `chatMemory.json`. The bot creates and updates these as it learns about users and events
- Both are merged and processed together, with static entries taking higher priority
- The prompt clearly labels which entries are editable vs read-only

### Slash Commands
| Command | Description |
|---------|-------------|
| `/togglerandom` | Toggle random responses on/off |
| `/togglementions` | Toggle whether the bot responds to mentions |
| `/togglebot` | Enable/disable all bot responses |
| `/update` | Upload a new character JSON file |
| `/lorebook` | Browse and edit static lorebook entries |
| `/memory` | Browse, edit, or delete dynamic memory book entries |
| `/configure` | Adjust runtime settings (history, tokens, keywords, etc.) |
| `/ask` | Send a prompt directly to the character |
| `Right-click → Ask` | Context menu command to ask about a specific message |

## Requirements

- Node.js 18 or higher
- Discord bot token
- OpenAI-compatible API endpoint (OpenAI, OpenRouter, local LLM, etc.)
- Character Card V2 JSON file

## Installation

```bash
npm install
```

## Configuration

Configuration is via `config.toml`. Copy the example file and edit it:

```bash
cp config.example.toml config.toml
```

### config.toml

```toml
# --- LLM API ---
[llm]
api_key = "sk-..."                          # Required. API key for your LLM provider
base_url = "https://api.openai.com/v1"      # Base URL for chat completions
model = "gpt-4o"                            # Model identifier
temperature = 0.7                           # Generation temperature (0-2)

# --- Discord Bot ---
[discord]
bot_token = ""                              # Required. Discord bot token
channel_ids = []                            # Channel IDs (empty = all channels)
allowed_user_ids = []                       # Admin slash command users
random_response_rate = 50                   # 1 in X messages (-1 to disable)
max_history_messages = 30                   # Context history size
max_context_tokens = 20000                  # Max tokens for context
ignore_other_bots = true
trigger_keywords = []
reply_to_mentions = true
mention_trigger_allowed_user_ids = []
add_timestamps = true
min_response_interval_seconds = 0
add_nothink = false
enable_user_status = false                  # Requires Presence Intent
allow_renaming = false

# --- Vision Model ---
[vision]
enabled = false                             # Pass images to LLM (must support vision)
model = "gpt-4o-mini"
api_key = ""                                # Falls back to llm.api_key
base_url = ""                               # Falls back to llm.base_url

# --- Behavior ---
[behavior]
allow_lorebook_editing = false
character_file_path = "./character.json"
chat_memory_book_path = "./chatMemory.json"
log_level = "INFO"                          # DEBUG, INFO, WARN, ERROR

# --- ComfyUI Image Generation ---
[comfyui]
enabled = false                             # Enable image generation
base_url = ""                               # ComfyUI server URL
workflow_path = "./workflow.json"           # Workflow template path
timeout_seconds = 120                       # Max wait time
poll_interval_ms = 2000                     # Poll frequency

[comfyui.resolutions]
square = [1280, 1280]
portrait = [1008, 1280]
landscape = [1280, 1008]
```

### Configuration Details

**LLM Settings:**
- `llm.api_key` - API key for your provider
- `llm.base_url` - Base URL for the chat completions endpoint
- `llm.model` - Model identifier (e.g. `gpt-4o`, `anthropic/claude-3.5-sonnet`, `deepseek/deepseek-v3.2`)
- `llm.temperature` - Generation temperature (0 = deterministic, 2 = very random)

**Discord Settings:**
- `discord.bot_token` - Bot token from the Discord Developer Portal
- `discord.channel_ids` - Restrict to specific channels. Empty array to respond everywhere
- `discord.allowed_user_ids` - User IDs that can use admin slash commands

**Trigger Behavior:**
- `discord.random_response_rate` - Bot responds to roughly 1-in-X messages. Set to `0` or `-1` to disable
- `discord.reply_to_mentions` - Whether the bot responds when mentioned or its name is said
- `discord.mention_trigger_allowed_user_ids` - Users who bypass `reply_to_mentions=false` and cooldowns
- `discord.trigger_keywords` - Additional words that trigger a response (full word match)
- `discord.min_response_interval_seconds` - Cooldown between responses per channel

**Vision & Media:**
- `vision.enabled` - When `true`, image attachments and sticker images are passed to the LLM. Your model must support multimodal input
- `discord.enable_user_status` - When `true`, user presence (online/idle/dnd, activities) is added to context. Requires the Presence Intent

**Lorebook & Memory:**
- `behavior.allow_lorebook_editing` - When `true`, the bot can create and update entries in the Chat Memory Book. Static lorebook entries are never modified
- `behavior.character_file_path` - Path to the Character Card V2 JSON file
- `behavior.chat_memory_book_path` - Path to the dynamic memory book. Auto-created if it doesn't exist

**ComfyUI Image Generation:**
- `comfyui.enabled` - Enable the `generateImage` command
- `comfyui.base_url` - URL of your ComfyUI instance (e.g. `https://comfyui.example.com`)
- `comfyui.workflow_path` - Path to the workflow template JSON file
- `comfyui.timeout_seconds` - Maximum time to wait for image generation
- `comfyui.resolutions` - Width/height for each orientation (square, portrait, landscape)

## Setting Up ComfyUI Image Generation

The bot can generate images via ComfyUI when enabled. The flow is:
1. The LLM uses the `generateImage` command with a prompt and orientation
2. The bot loads your workflow template, injects the prompt and resolution
3. The workflow is submitted to your ComfyUI instance
4. The bot polls for completion, downloads the image, and sends it as a follow-up

### Creating a Workflow Template

1. Design your workflow in ComfyUI and export it as JSON
2. Find the node that contains your prompt text and replace its value with exactly `<PROMPT>`
3. The bot will find any node with both `width` and `height` inputs and set the resolution
4. Save as `workflow.json`

Example workflow snippet:
```json
{
  "120": {
    "inputs": {
      "text": "<PROMPT>"
    },
    "class_type": "PrimitiveText",
    "_meta": { "title": "Prompt to inject" }
  },
  "5": {
    "inputs": {
      "width": 1280,
      "height": 1280,
      "batch_size": 1
    },
    "class_type": "EmptySD3LatentImage"
  }
}
```

See `workflow.example.json` for a complete example.

## Setting Up the LLM API

### OpenAI
```toml
[llm]
api_key = "sk-..."
base_url = "https://api.openai.com/v1"
model = "gpt-4o"
```

### OpenRouter
OpenRouter provides access to many providers through a single API:
```toml
[llm]
api_key = "sk-or-v1-..."
base_url = "https://openrouter.ai/api/v1"
model = "anthropic/claude-3.5-sonnet"
```

### Other Providers
Any OpenAI-compatible API works:
- **Local LLMs**: Ollama, LM Studio, text-generation-webui
- **Zhipu AI (GLM)**: Direct API access
- **Together AI, Groq, DeepSeek**: Most modern APIs follow the OpenAI format

Just set `llm.base_url` to the provider's chat completions endpoint.

## Discord Bot Setup

1. Create an application at https://discord.com/developers/applications
2. Go to **Bot** → create bot → copy token
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. Optionally enable **Presence Intent** (only if `ENABLE_USER_STATUS=true`)
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: Send Messages, Read Message History
   - Optional: Add Reactions, Manage Nicknames
6. Use the generated URL to invite the bot
7. Enable **Developer Mode** in Discord (Settings → Advanced) to copy IDs

## Character Configuration

The bot reads Character Card V2 files. Supported fields:

| Field | Description |
|-------|-------------|
| `data.name` | Character name (used for triggers and `{{char}}`) |
| `data.description` | Personality, background, and behavior rules |
| `data.mes_example` | Example dialogue format |
| `data.extensions.depth_prompt` | Instructions injected at a specific conversation depth |
| `data.character_book` | Static lorebook entries (read-only at runtime) |

Example minimal character:
```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "MyCharacter",
    "description": "A friendly and curious AI character who loves to chat.",
    "mes_example": "<START>\n{{char}}: Hello! Nice to meet you!"
  }
}
```

### Template Placeholders

The system prompt supports these placeholders:
- `{{char}}` - Character name
- `{{user}}` - Display name of the user who triggered the response
- `{{description}}` - Character description
- `{{mesExamples}}` - Example messages
- `{{lorebookEntries}}` - Lorebook entry listing (for editing context)
- `{{serverName}}` - Discord server name
- `{{channelName}}` - Discord channel name
- `{{discordId}}` - Bot's Discord user ID

## Running

```bash
npm run build
npm start
```

For development with auto-rebuild:
```bash
npm run watch
```

With Docker:
```bash
docker-compose up -d
```

## How It Works

1. A message triggers the bot (mention, keyword, name, or random chance)
2. Message history is fetched, with reactions and stickers extracted
3. The system prompt is built with character info, lorebook matches, emoji/sticker lists, and conversation history
4. The LLM returns JSON: `{ "reply": "...", "commands": [...] }`
5. Instant commands are executed (react, rename, post sticker, edit memory)
6. The text reply is sent to Discord immediately
7. Async commands run after the reply (e.g. image generation) and results are sent as follow-up messages

## Project Structure

```
src/
  index.ts              # Entry point
  config.ts             # TOML configuration loader and command definitions
  models.ts             # TypeScript type definitions
  types.ts              # Lorebook-specific types
  api/
    llm.ts              # OpenAI-compatible API client
    comfyui.ts          # ComfyUI image generation client
    vision.ts           # Vision model API client
  classes/
    DiscordBot.ts       # Main bot class with event handlers
    MessageQueue.ts     # Per-channel message queue
  commands/
    CommandHandler.ts   # Slash command handler
    CommandManager.ts   # Slash command registration
  tools/
    lorebook.ts         # Lorebook keyword matching engine
    normalizeLorebook.ts # Lorebook format normalization
    chatMemoryBook.ts   # Dynamic memory book load/save/upsert
    MessageHistory.ts   # History fetching, reactions, stickers, vision
    prompt.ts           # Prompt building, token trimming, reaction reconstruction
  utils/
    botCommandHandler.ts # Execute commands from AI responses
    ResponseContexts.ts  # Unified reply/followUp interface for messages & interactions
    responseParser.ts   # Parse AI JSON responses
    tokenCounter.ts     # Token counting for context management
    logger.ts           # Timestamped logger
    lorebookEditor.ts   # Legacy lorebook command processing
```

## License

GPL-3.0

This project is licensed under the GNU General Public License v3.0. You are free to use, modify, and distribute this software, including for commercial purposes, as long as any derivative works are also released under GPL-3.0 and the source code is made publicly available.

See the [LICENSE](LICENSE) file for details.
