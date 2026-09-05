/** Follow-for-$5 rules. Live membership is checked at invoice create, not at tap-Verify. */

export const TELEGRAM_OK = new Set(["member", "administrator", "creator"]);

export const DISCOUNT_HOLD_STATUSES = ["creating", "pending", "uncertain"] as const;

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

/** A pending discounted invoice already holds the one-time $5 off. */
export function followDiscountHeld(
  invoices: { discountCents: number; status: string }[],
): boolean {
  return invoices.some(
    (row) => row.discountCents > 0 && (DISCOUNT_HOLD_STATUSES as readonly string[]).includes(row.status),
  );
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchTelegramMemberStatus(opts: {
  botToken: string;
  chatId: string;
  telegramUserId: string;
  fetchImpl?: FetchLike;
}): Promise<string | null> {
  if (!opts.botToken || !opts.chatId || !opts.telegramUserId) return null;
  try {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(
      `https://api.telegram.org/bot${opts.botToken}/getChatMember?chat_id=${encodeURIComponent(opts.chatId)}&user_id=${encodeURIComponent(opts.telegramUserId)}`,
    );
    const body = (await res.json()) as { ok?: boolean; result?: { status?: string } };
    if (!body.ok) return null;
    return body.result?.status ?? null;
  } catch {
    return null;
  }
}

export async function fetchDiscordMemberOk(opts: {
  botToken: string;
  guildId: string;
  discordUserId: string;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  if (!opts.botToken || !opts.guildId || !opts.discordUserId) return false;
  try {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(
      `https://discord.com/api/v10/guilds/${opts.guildId}/members/${opts.discordUserId}`,
      { headers: { authorization: `Bot ${opts.botToken}` } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Server-side membership. Client booleans are ignored. Fail closed on missing
 * config, missing ids, or network errors — no $5 off without a live check.
 */
export async function verifyFollowMembership(opts: {
  telegramUserId: string | null;
  discordUserId: string | null;
  telegramChatId?: string;
  telegramBotToken?: string;
  discordGuildId?: string;
  discordBotToken?: string;
  fetchImpl?: FetchLike;
}): Promise<{ telegram: boolean; discord: boolean; verified: boolean }> {
  const chatId = opts.telegramChatId ?? process.env.FOLLOW_TELEGRAM_CHAT_ID?.trim() ?? "";
  const tgBot = opts.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const guildId = opts.discordGuildId ?? process.env.FOLLOW_DISCORD_GUILD_ID?.trim() ?? "";
  const dcBot = opts.discordBotToken ?? process.env.DISCORD_BOT_TOKEN?.trim() ?? "";

  const tgStatus = opts.telegramUserId
    ? await fetchTelegramMemberStatus({
        botToken: tgBot,
        chatId,
        telegramUserId: opts.telegramUserId,
        fetchImpl: opts.fetchImpl,
      })
    : null;
  const telegram = telegramMemberOk(tgStatus);
  const discord = opts.discordUserId
    ? await fetchDiscordMemberOk({
        botToken: dcBot,
        guildId,
        discordUserId: opts.discordUserId,
        fetchImpl: opts.fetchImpl,
      })
    : false;
  return { telegram, discord, verified: telegram && discord };
}
