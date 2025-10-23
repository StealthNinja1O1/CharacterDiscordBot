# Character Discord Bot

A Discord bot that behaves like a character defined in `character.json`, using the Character Card V2 standard. The bot responds when mentioned, when its name is included in messages, and randomly at a configurable rate.

## Features

- ✅ Responds when mentioned (@bot)
- ✅ Responds when character name is mentioned in messages
- ✅ Random responses (configurable rate, default 1 in 50 messages)
- ✅ Takes message history into context with proper user attribution
- ✅ Replaces Discord usernames with `{{user}}` for the current user
- ✅ Token-based context limiting (configurable, default 20k tokens)
- ✅ Continuous typing indicator during response generation
- ✅ `/togglerandom` slash command to enable/disable random responses (admin-only)
- ✅ Locked to a specific channel
- ✅ Uses GLM API for AI responses
- ✅ Character Card V2 format support

## Setup

### 1. Install Dependencies

```powershell
npm install
```

### 2. Configure Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section and create a bot
4. Enable the following **Privileged Gateway Intents**:
   - Message Content Intent
5. Copy the bot token
6. Go to OAuth2 → URL Generator
7. Select scopes: `bot` and `applications.commands`
8. Select bot permissions:
   - Send Messages
   - Read Message History
   - Use Slash Commands
9. Use the generated URL to invite the bot to your server

### 3. Get Channel ID

1. Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
2. Right-click on the channel where you want the bot to respond
3. Click "Copy ID"

### 4. Get User IDs (for admin commands)

1. Right-click on your username in Discord
2. Click "Copy ID"
3. Repeat for any other users who should have admin access

### 5. Configure Environment Variables

Edit the `.env` file with your configuration:

```env
# GLM API Configuration
GLM_API_KEY=your_glm_api_key_here
GLM_BASE_URL=

# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here
DISCORD_ALLOWED_USERS=user_id_1,user_id_2,user_id_3

# Bot Behavior Settings
RANDOM_RESPONSE_RATE=50
MAX_HISTORY_MESSAGES=20
```

**Configuration Options:**
- `RANDOM_RESPONSE_RATE`: The bot will respond randomly to 1 in X messages (default: 50)
- `MAX_HISTORY_MESSAGES`: Number of previous messages to initially fetch (default: 20)
- `MAX_CONTEXT_TOKENS`: Maximum tokens for context including system prompt (default: 20000)
- `DISCORD_ALLOWED_USERS`: Comma-separated list of Discord user IDs allowed to use admin commands

### 6. Customize Your Character

Edit `src/character.json` with your character data. The bot uses the Character Card V2 format:

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "YourCharacterName",
    "description": "Character description and personality...",
    "mes_example": "<START>\n{{char}}: Example dialogue...",
    ...
  }
}
```

## Running the Bot

### Build and Start

```powershell
npm run build
npm start
```

### Development Mode (with auto-rebuild)

```powershell
npm run watch
```

Then in another terminal:
```powershell
npm start
```

## Usage

### In Discord

The bot will respond in the configured channel when:

1. **Mentioned**: `@BotName what's up?`
2. **Name included**: `Hey ENTITY_0, are you there?`
3. **Random chance**: Just chat normally, and the bot will randomly join the conversation

### Slash Commands

- `/togglerandom` - Toggle random responses on/off (only allowed users can use this)

## How It Works

1. The bot monitors messages in the specified channel
2. When triggered, it fetches message history from Discord
3. Each message retains the original Discord username (only current user becomes `{{user}}`)
4. Messages are counted using gpt-tokenizer and trimmed to fit within the token limit
5. The system prompt is always included, then as many recent messages as possible
6. The bot shows a typing indicator that loops until the response is ready
7. The GLM API generates a response in character
8. The bot replies in Discord

## Project Structure

```
src/
├── character.json          # Your character definition
├── config.ts              # Bot configuration
├── constants.ts           # Default presets and personas
├── index.ts              # Main bot file
├── api/
│   └── glm.ts           # GLM API client
├── classes/
│   └── MessageHistory.ts # Message history management
└── tools/
    └── prompt.ts        # AI prompt builder
```

## Troubleshooting

### Bot doesn't respond
- Check that the bot is online in Discord
- Verify the channel ID is correct
- Ensure Message Content Intent is enabled
- Check the console for errors

### "Cannot find module" errors
- Run `npm install` to install dependencies
- Make sure you've built the project with `npm run build`

### API errors
- Verify your GLM_API_KEY is correct
- Check your API quota/limits
- Ensure the GLM_BASE_URL is correct

## License

ISC
