# Quick Setup Guide

## Step-by-step Setup

### 1. Install Dependencies
```powershell
npm install
```

### 2. Create Discord Bot
1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Go to "Bot" section → Click "Add Bot"
4. Enable these under "Privileged Gateway Intents":
   - ✅ MESSAGE CONTENT INTENT
5. Click "Reset Token" and copy your bot token
6. Go to "OAuth2" → "URL Generator"
   - Scopes: ✅ bot, ✅ applications.commands
   - Bot Permissions: ✅ Send Messages, ✅ Read Message History
7. Copy the generated URL and open it to invite bot to your server

### 3. Get Discord IDs
1. Enable Developer Mode in Discord:
   - Settings → Advanced → Developer Mode ✅
2. Right-click the channel where bot should respond → Copy ID
3. Right-click your username → Copy ID (for admin access)

### 4. Configure .env
```env
GLM_API_KEY=your_api_key_here
GLM_BASE_URL=

DISCORD_BOT_TOKEN=paste_bot_token_here
DISCORD_CHANNEL_ID=paste_channel_id_here
DISCORD_ALLOWED_USERS=paste_your_user_id_here

RANDOM_RESPONSE_RATE=50
MAX_HISTORY_MESSAGES=20
```

### 5. Build and Run
```powershell
npm run build
npm start
```

## Testing the Bot

Once running, in Discord:
- Mention the bot: `@YourBot hello!`
- Say the character's name: `Hey ENTITY_0, how are you?`
- Just chat - bot will randomly respond
- Use `/togglerandom` to disable/enable random responses

## Troubleshooting

**Bot not responding?**
- Check console for errors
- Verify channel ID is correct
- Make sure "Message Content Intent" is enabled
- Ensure bot has permissions in the channel

**Build errors?**
- Delete `node_modules` and `dist` folders
- Run `npm install` again
- Run `npm run build`

**API errors?**
- Check GLM_API_KEY is valid
- Verify API endpoint URL
