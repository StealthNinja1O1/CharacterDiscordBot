# Character Discord Bot

A Discord bot that simulates a character defined by a Character Card V2 JSON file. The bot uses OpenAI-compatible APIs to generate responses based on the character's personality and conversation context.

## Overview

This is a straightforward implementation that covers the essential features needed for a character roleplay bot in Discord. It reads character definitions from a standard Character Card V2 file and uses only the core fields (name, description, and example messages) to keep the implementation simple and maintainable.

The bot is functional but basic by design. It focuses on reliable conversation handling rather than advanced features. If you need a simple way to bring a character to life in Discord without complexity, this works well.

## Features

- Responds when mentioned or when the character name appears in messages
- Optional random response chance (configurable)
- Maintains conversation context with token-based limiting
- Admin-only slash command to toggle random responses
- Can be locked to a specific channel

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

Configuration can be done via environment variables (.env file) or by editing `src/config.ts` directly.

### Environment Variables (.env)

```env
# LLM API Configuration
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o

# Discord Bot Configuration
DISCORD_BOT_TOKEN=
DISCORD_CHANNEL_ID=
DISCORD_ALLOWED_USERS=1402920090344755323,1234567890

# Bot Behavior Settings
RANDOM_RESPONSE_RATE=1 # Set to -1 to disable random responses
MAX_HISTORY_MESSAGES=30
MAX_CONTEXT_TOKENS=20000
IGNORE_OTHER_BOTS=true
TRIGGER_KEYWORDS=assistant,bot,helper,chatgpt
ADD_TIMESTAMPS=true # Add timestamps to messages
MIN_RESPONSE_INTERVAL_SECONDS=0
REPLY_TO_MENTIONS=true
MENTION_TRIGGER_ALLOWED_USERS=1402920090344755323,1234567890

# Lorebook
ALLOW_LOREBOOK_EDITING=false
# Character File Path
CHARACTER_FILE_PATH=./character.json

```

### Configuration Options

**LLM Settings:**
- `LLM_API_KEY` - API key for your LLM provider
- `LLM_BASE_URL` - Base URL for the API endpoint
- `LLM_MODEL` - Model name to use

**Discord Settings:**
- `DISCORD_BOT_TOKEN` - Your Discord bot token
- `DISCORD_CHANNEL_ID` - Channel ID where the bot responds (leave empty for all channels)
- `DISCORD_ALLOWED_USERS` - User IDs allowed to use admin commands

**Behavior:**
- `RANDOM_RESPONSE_RATE` - Responds randomly to 1 in X messages (-1 to disable)
- `MAX_HISTORY_MESSAGES` - Number of recent messages to fetch
- `MAX_CONTEXT_TOKENS` - Maximum tokens for context (includes system prompt)
- `IGNORE_OTHER_BOTS` - Whether to ignore messages from other bots
- `TRIGGER_KEYWORDS` - Additional keywords that trigger responses (comma-separated)
- `MIN_RESPONSE_INTERVAL_SECONDS` - Minimum time in seconds to wait before replying again in the same channel (default: 0)
- `REPLY_TO_MENTIONS` - If `false`, the bot will not reply when directly mentioned, only by allowed people
- `MENTION_TRIGGER_ALLOWED_USERS` - Comma-separated list of user IDs allowed to trigger mention/trigger keyword replies even if REPLY_TO_MENTIONS is set to false.

**Lorebook:**
- `ALLOW_LOREBOOK_EDITING` - Allow the character to update their own lorebook entries (true/false)

**Character file:**
- `CHARACTER_FILE_PATH` - File path for the character file (default: `./character.json`)

## Setting Up LLM API

### OpenAI

1. Get an API key from https://platform.openai.com/api-keys
2. Configure:
```env
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

### OpenRouter

OpenRouter provides access to multiple LLM providers through a single API.

1. Get an API key from https://openrouter.ai/keys
2. Configure:
```env
LLM_API_KEY=sk-or-v1-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=anthropic/claude-3.5-sonnet
```

3. Optional: Add HTTP referrer header for rankings (edit `src/api/llm.ts`):
```typescript
headers: {
  "HTTP-Referer": "your-site-url",
  "X-Title": "your-app-name"
}
```

### Other Providers

Any OpenAI-compatible API works:
- **Local LLMs**: Ollama, LM Studio, text-generation-webui
- **Anthropic Claude**: Through OpenRouter or with adapter
- **Zhipu AI (GLM)**: Direct API access
- **Together AI, Groq, etc**: Most modern APIs follow OpenAI format

Just set the `LLM_BASE_URL` to the provider's endpoint.

## Discord Bot Setup

1. Create application at https://discord.com/developers/applications
2. Go to Bot section, create bot, copy token
3. Enable "Message Content Intent" under Privileged Gateway Intents
4. Go to OAuth2 > URL Generator
   - Scopes: `bot`, `applications.commands`
   - Permissions: Send Messages, Read Message History
5. Use generated URL to invite bot to your server
6. Enable Developer Mode in Discord (Settings > Advanced)
7. Right-click channel, Copy ID for `DISCORD_CHANNEL_ID`
8. Right-click your username, Copy ID for `DISCORD_ALLOWED_USERS`

## Character Configuration

Edit `src/character.json` with your character. The bot uses only these fields:
- `data.name` - Character name
- `data.description` - Personality and background
- `data.mes_example` - Example dialogue
- `data.extensions.depth_prompt` - Depth prompt (optional)
- `data.character_book` - Attached lorebook from chub (optional)

Example: (outdated)
```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "Assistant",
    "description": "A helpful AI assistant.",
    "mes_example": "<START>\n{{char}}: Hello! How can I help you today?"
  }
}
```

Other Character Card V2 fields are ignored. This keeps the implementation simple.

## Running

```bash
npm run build
npm start
```

For development with auto-rebuild:
```bash
npm run watch
```

## Usage

In Discord:
- Mention the bot: `@BotName hello`
- Use character name: `Hey CharacterName, how are you?`
- Use trigger keywords (if configured)
- Random responses (if enabled)

Slash commands (admin-only)

The bot exposes a set of admin-only slash commands. Only users listed in `DISCORD_ALLOWED_USERS` may run these commands.

- `/togglerandom`
  - Description: Toggle whether the bot sends random, unsolicited responses.
  - Usage: `/togglerandom`
  - Notes: This flips the runtime flag; it does not persist to disk.

- `/togglementions`
  - Description: Toggle whether the bot replies when directly mentioned.
  - Usage: `/togglementions`
  - Notes: When disabled, mention triggers are ignored (except when a user is explicitly allowed via `MENTION_TRIGGER_ALLOWED_USERS`). This change is runtime-only.

- `/togglebot`
  - Description: Temporarily enable or disable the bot's response behavior.
  - Usage: `/togglebot`
  - Notes: This toggles a runtime 'enabled' flag. Prefer `min response interval` configuration for finer control.

- `/update` (file upload)
  - Description: Upload a new Character Card JSON to replace the active character definition.
  - Usage: `/update file:<attachment>` (attach the character JSON file)
  - Validation: The uploaded file is parsed and checked for required fields (`data.name` and `data.description`). If valid, the file is written to the path configured by `CHARACTER_FILE_PATH` and the in-memory character is reloaded immediately.
  - Notes: The command overwrites the current character file. Consider enabling backups or adding a confirmation workflow if you want safer updates.

- `/lorebook`
  - Description: Browse and edit the character's lorebook entries interactively.
  - Usage: `/lorebook`
  - Behavior: Opens an ephemeral UI for the command user with paginated select menus (10 entries per page), Prev/Next navigation, and an Edit button which opens a modal for editing an entry's content. Submissions update `character.json` and the in-memory character immediately.
  - Notes: Designed to scale to large lorebooks by paging entries. Only the invoking admin sees the UI and can make edits.

- `/configure` (runtime configuration)
  - Description: Change runtime behavior settings without restarting the bot.
  - Usage: `/configure [random_response_rate] [max_history_messages] [max_context_tokens] [ignore_other_bots] [trigger_keywords] [add_timestamps] [min_response_interval_seconds]`
  - Options:
    - `random_response_rate` (integer) — RANDOM_RESPONSE_RATE (1 in N; 0 disables)
    - `max_history_messages` (integer) — MAX_HISTORY_MESSAGES
    - `max_context_tokens` (integer) — MAX_CONTEXT_TOKENS
    - `ignore_other_bots` (boolean) — IGNORE_OTHER_BOTS
    - `trigger_keywords` (string) — TRIGGER_KEYWORDS (comma-separated)
    - `add_timestamps` (boolean) — ADD_TIMESTAMPS
    - `min_response_interval_seconds` (integer) — MIN_RESPONSE_INTERVAL_SECONDS
  - Notes: Changes are applied in-memory only. If you want persistent configuration across restarts, use a saved runtime config file (recommended) or persist to `.env` manually.

## Lorebook Editing (Optional Feature)

If `ALLOW_LOREBOOK_EDITING=true` is set, the character can update their own lorebook entries based on conversations.

### How It Works

1. The character can update existing lorebook entries by using a special command in their response
2. The command format: `createOrEditLore("EntryName", "new content here")`
3. The command is automatically removed from the response before sending to Discord
4. Only entries that already exist in the character_book can be updated
5. Changes are saved directly to the character.json file

### Use Cases

- Character learns new information about Discord server members
- Character updates facts about ongoing events or situations
- Character maintains memory of important details across sessions

### Example

If your character has a lorebook entry named "SteakedGamer", the character can update it:

```
Character's internal response: "I see! createOrEditLore("SteakedGamer", "SteakedGamer is the creator who likes gaming and bot development.")"
What Discord sees: "I see!"
```

The lorebook entry "SteakedGamer" is updated, and the command is hidden from users.

### Security Notes

- Characters can only update existing entries, not create new ones
- Changes persist across bot restarts
- You can disable this feature by setting `ALLOW_LOREBOOK_EDITING=false` or omitting it

## Project Structure

```
src/
  character.json          # Character definition
  config.ts              # Configuration
  index.ts              # Main bot logic
  api/llm.ts           # LLM API client
  classes/MessageHistory.ts  # Message handling
  utils/tokenCounter.ts     # Token counting
  tools/prompt.ts          # Prompt building
```

## License

GPL-3.0

This project is licensed under the GNU General Public License v3.0. You are free to use, modify, and distribute this software, including for commercial purposes, as long as any derivative works are also released under GPL-3.0 and the source code is made publicly available.

See the [LICENSE](LICENSE) file for details.