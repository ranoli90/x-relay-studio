/** Follow-for-$5 rules. Live membership is checked at invoice create, not at tap-Verify. */

export const TELEGRAM_OK = new Set(["member", "administrator", "creator"]);

export function telegramMemberOk(status: string | null | undefined): boolean {
  return Boolean(status && TELEGRAM_OK.has(status));
}

export function discordMemberOk(guildIds: string[], requiredGuildId: string): boolean {
  if (!requiredGuildId) return false;
  return guildIds.includes(requiredGuildId);
}

export function bothFollowsLive(opts: {
  telegramStatus: string | null;
  discordGuilds: string[];
  requiredGuildId: string;
}): boolean {
  return telegramMemberOk(opts.telegramStatus) && discordMemberOk(opts.discordGuilds, opts.requiredGuildId);
}

export function followBindAllowed(opts: {
  network: "telegram" | "discord";
  externalId: string;
  existingDeskUserId: string | null;
  thisDeskUserId: string;
}): boolean {
  if (!opts.externalId) return false;
  if (!opts.existingDeskUserId) return true;
  return opts.existingDeskUserId === opts.thisDeskUserId;
}
