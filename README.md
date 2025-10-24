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
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o

# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_channel_id
DISCORD_ALLOWED_USERS=comma,separated,user,ids

# Bot Behavior
RANDOM_RESPONSE_RATE=50
MAX_HISTORY_MESSAGES=30
MAX_CONTEXT_TOKENS=20000
IGNORE_OTHER_BOTS=true
TRIGGER_KEYWORDS=optional,comma,separated,keywords,assistant,bot,
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
- `RANDOM_RESPONSE_RATE` - Responds randomly to 1 in X messages (0 to disable)
- `MAX_HISTORY_MESSAGES` - Number of recent messages to fetch
- `MAX_CONTEXT_TOKENS` - Maximum tokens for context (includes system prompt)
- `IGNORE_OTHER_BOTS` - Whether to ignore messages from other bots
- `TRIGGER_KEYWORDS` - Additional keywords that trigger responses

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
- `data.extensions.depth_prompt` - Depth prompt

Example:
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

Admin commands:
- `/togglerandom` - Enable/disable random responses (allowed users only)

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