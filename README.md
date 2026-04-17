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
- **`renameSelf`** - Change the bot's nickname (gated by `ALLOW_RENAMING`, runtime-guarded against prompt injection)
- **`renameUser`** - Change a user's nickname (permission-checked, runtime-guarded)
- **`postSticker`** - Send a server sticker by name
- **`editOrAddToLorebook`** - Create or update dynamic memory entries (writes to `chatMemory.json`, never touches static lorebook)

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

All configuration is via environment variables (`.env` file).

### Environment Variables

```env
# ===========================================
# LLM API Configuration
# ===========================================
LLM_API_KEY=                    # API key for your LLM provider
LLM_BASE_URL=https://api.openai.com/v1  # Base URL for the chat completions endpoint
LLM_MODEL=gpt-4o               # Model name to use
LLM_TEMPERATURE=0.7            # Model temperature (0-2)

# ===========================================
# Discord Bot Configuration
# ===========================================
DISCORD_BOT_TOKEN=              # Your Discord bot token (required)
DISCORD_CHANNEL_ID=             # Channel IDs to respond in (comma-separated, leave empty for all)
DISCORD_ALLOWED_USERS=          # User IDs allowed to use admin slash commands (comma-separated)

# ===========================================
# Bot Behavior Settings
# ===========================================
RANDOM_RESPONSE_RATE=50         # Respond randomly to 1 in X messages (-1 to disable)
MAX_HISTORY_MESSAGES=30         # Number of recent messages to fetch for context
MAX_CONTEXT_TOKENS=20000        # Maximum tokens for context (includes system prompt)
IGNORE_OTHER_BOTS=true          # Whether to ignore messages from other bots
TRIGGER_KEYWORDS=               # Additional keywords that trigger responses (comma-separated)
ADD_TIMESTAMPS=true             # Add timestamps to messages in context
MIN_RESPONSE_INTERVAL_SECONDS=0 # Minimum seconds between responses in the same channel
REPLY_TO_MENTIONS=true          # If false, bot won't reply to mentions (unless whitelisted)
MENTION_TRIGGER_ALLOWED_USERS=  # User IDs that always trigger mention/keyword replies (comma-separated)
ADD_NOTHINK=false               # Adds disable-thinking tag for models that support it
ENABLE_VISION=true              # Pass images/stickers to the LLM (model must support vision)
ENABLE_USER_STATUS=true         # Show user Discord status/activities in context (requires Presence Intent)
ALLOW_RENAMING=false            # Allow the bot to rename itself and others via commands

# ===========================================
# Lorebook & Memory
# ===========================================
ALLOW_LOREBOOK_EDITING=false    # Allow the character to create/update memory book entries
CHARACTER_FILE_PATH=./character.json  # Path to the character card JSON file
CHAT_MEMORY_BOOK_PATH=./chatMemory.json  # Path to the dynamic memory book (auto-created)
LOG_LEVEL=INFO                  # Log level: DEBUG, INFO, WARN, ERROR (default: INFO)
```

### Configuration Details

**LLM Settings:**
- `LLM_API_KEY` - API key for your provider
- `LLM_BASE_URL` - Base URL for the chat completions endpoint
- `LLM_MODEL` - Model identifier (e.g. `gpt-4o`, `anthropic/claude-3.5-sonnet`, `deepseek/deepseek-v3.2`)
- `LLM_TEMPERATURE` - Generation temperature (0 = deterministic, 2 = very random)

**Discord Settings:**
- `DISCORD_BOT_TOKEN` - Bot token from the Discord Developer Portal
- `DISCORD_CHANNEL_ID` - Restrict to specific channels (comma-separated). Leave empty to respond everywhere
- `DISCORD_ALLOWED_USERS` - User IDs that can use admin slash commands (comma-separated)

**Trigger Behavior:**
- `RANDOM_RESPONSE_RATE` - Bot responds to roughly 1-in-X messages. Set to `0` or `-1` to disable
- `REPLY_TO_MENTIONS` - Whether the bot responds when mentioned or its name is said
- `MENTION_TRIGGER_ALLOWED_USERS` - Users who bypass `REPLY_TO_MENTIONS=false` and `MIN_RESPONSE_INTERVAL_SECONDS`
- `TRIGGER_KEYWORDS` - Additional words that trigger a response (full word match)
- `MIN_RESPONSE_INTERVAL_SECONDS` - Cooldown between responses per channel

**Vision & Media:**
- `ENABLE_VISION` - When `true`, image attachments and sticker images are passed to the LLM as base64. Your model must support multimodal input
- `ENABLE_USER_STATUS` - When `true`, user presence (online/idle/dnd, activities) is added to context. Requires the Presence Intent in the Discord Developer Portal

**Lorebook & Memory:**
- `ALLOW_LOREBOOK_EDITING` - When `true`, the bot can create and update entries in the Chat Memory Book via the `editOrAddToLorebook` command. Static lorebook entries are never modified
- `CHARACTER_FILE_PATH` - Path to the Character Card V2 JSON file
- `CHAT_MEMORY_BOOK_PATH` - Path to the dynamic memory book file. Auto-created if it doesn't exist

## Setting Up the LLM API

### OpenAI
```env
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

### OpenRouter
OpenRouter provides access to many providers through a single API:
```env
LLM_API_KEY=sk-or-v1-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=anthropic/claude-3.5-sonnet
```

### Other Providers
Any OpenAI-compatible API works:
- **Local LLMs**: Ollama, LM Studio, text-generation-webui
- **Zhipu AI (GLM)**: Direct API access
- **Together AI, Groq, DeepSeek**: Most modern APIs follow the OpenAI format

Just set `LLM_BASE_URL` to the provider's chat completions endpoint.

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
5. Commands are executed (react, rename, post sticker, edit memory, etc.)
6. The reply is sent to Discord

## Project Structure

```
src/
  index.ts              # Entry point
  config.ts             # Configuration and command definitions
  models.ts             # TypeScript type definitions
  types.ts              # Lorebook-specific types
  api/
    llm.ts              # OpenAI-compatible API client
  classes/
    DiscordBot.ts       # Main bot class with event handlers
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
    responseParser.ts   # Parse AI JSON responses
    tokenCounter.ts     # Token counting for context management
    lorebookEditor.ts   # Legacy lorebook command processing (regex-based)
```

## License

GPL-3.0

This project is licensed under the GNU General Public License v3.0. You are free to use, modify, and distribute this software, including for commercial purposes, as long as any derivative works are also released under GPL-3.0 and the source code is made publicly available.

See the [LICENSE](LICENSE) file for details.
