import type { Message } from "discord.js";
import { discordConfig } from "../../config.js";
import type { CommandDef, CommandResult } from "../registry.js";

/** Change the bot's own nickname in the server. */
async function renameSelf(args: { newName: string }, message: Message | null): Promise<CommandResult> {
  if (!discordConfig.allowRenaming) return { success: false, message: "Renaming is disabled" };
  const { newName } = args;
  if (!newName || typeof newName !== "string") return { success: false, message: "Invalid newName argument" };
  if (!message?.guild) return { success: false, message: "Cannot rename outside of a server" };

  const botMember = message.guild.members.me;
  if (!botMember) return { success: false, message: "Bot is not a member of this server" };

  try {
    await botMember.setNickname(newName);
    return { success: true, message: `Renamed self to "${newName}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to rename: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Change another user's nickname (requires MANAGE_NICKNAMES permission). */
async function renameUser(args: { userId: string; newName: string }, message: Message | null): Promise<CommandResult> {
  if (!discordConfig.allowRenaming) return { success: false, message: "Renaming is disabled" };
  const { userId, newName } = args;
  if (!userId || typeof userId !== "string") return { success: false, message: "Invalid userId argument" };
  if (!newName || typeof newName !== "string") return { success: false, message: "Invalid newName argument" };
  if (!message?.guild) return { success: false, message: "Cannot rename outside of a server" };

  const extractedUserId = userId.match(/^<@!?(\d+)>$/)?.[1] || userId;

  try {
    const targetMember = await message.guild.members.fetch(extractedUserId);
    if (!targetMember) return { success: false, message: `User ${userId} not found in server` };

    if (!message.guild.members.me?.permissions.has("ManageNicknames"))
      return { success: false, message: "Bot lacks MANAGE_NICKNAMES permission" };

    if (targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position)
      return { success: false, message: "Cannot rename users with equal or higher role" };

    await targetMember.setNickname(newName);
    return { success: true, message: `Renamed user ${targetMember.user.username} to "${newName}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to rename user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Set the bot's about me / bio text on the server profile. */
async function setBio(args: { bio: string }, message: Message | null): Promise<CommandResult> {
  if (!discordConfig.allowRenaming) return { success: false, message: "Profile editing is disabled" };
  const { bio } = args;
  if (!bio || typeof bio !== "string") return { success: false, message: "Invalid bio argument" };
  if (bio.length > 190) return { success: false, message: `Bio is too long (${bio.length}/190 characters)` };
  if (!message?.guild) return { success: false, message: "Cannot set bio outside of a server" };

  try {
    // discord.js has no GuildMember.setBio(), fuck discord.js
    const response = await fetch(`https://discord.com/api/v10/guilds/${message.guild.id}/members/@me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${discordConfig.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bio }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { success: false, message: `Failed to set bio (HTTP ${response.status}): ${errorText}` };
    }

    return { success: true, message: `Updated bio to: "${bio.slice(0, 80)}${bio.length > 80 ? "..." : ""}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to set bio: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const renameSelfCommand: CommandDef<{ newName: string }> = {
  name: "renameSelf",
  args: { newName: "string" },
  description: "Change {{char}}'s nickname in the server to the specified newName.",
  kind: "instant",
  enabled: () => discordConfig.allowRenaming,
  execute: async (args, ctx) => renameSelf(args as { newName: string }, ctx.message),
};

export const renameUserCommand: CommandDef<{ userId: string; newName: string }> = {
  name: "renameUser",
  args: { userId: "string", newName: "string" },
  description: "Change the nickname of the specified user in the server to newName.",
  kind: "instant",
  enabled: () => discordConfig.allowRenaming,
  execute: async (args, ctx) => renameUser(args as { userId: string; newName: string }, ctx.message),
};

export const setBioCommand: CommandDef<{ bio: string }> = {
  name: "setBio",
  args: { bio: "string (max 190 characters)" },
  description: `Set {{char}}'s about me / bio text on their server profile`,
  kind: "instant",
  enabled: () => discordConfig.allowRenaming,
  execute: async (args, ctx) => setBio(args as { bio: string }, ctx.message),
};
