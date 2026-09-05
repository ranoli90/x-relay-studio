import { z } from "zod";
import { TelegramError } from "./errors.ts";
import { graphemeCount, sliceGraphemes } from "./graphemes.ts";
import { BIO_GRAPHEME_LIMIT } from "./types.ts";

const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/;
const USERNAME = /^[A-Za-z0-9_]{5,32}$/;

export const ChatIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(CHAT_ID, "Chat not found.");

export const SendSchema = z.object({
  chatId: ChatIdSchema,
  body: z.string().trim().min(1, "Message is empty.").max(4000, "Message is too long."),
});

export const MessagesSchema = z.object({
  chatId: ChatIdSchema,
});

export const SyncSchema = z.object({
  chatId: ChatIdSchema.nullable().optional(),
});

export const PreviewNameSchema = z.object({
  displayName: z.string().trim().max(64).optional(),
});

export const SaveKeySchema = z.object({
  token: z.string().min(1).max(200),
});

export const ProfileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(64),
  lastName: z.string().trim().max(64),
  about: z.string().max(400),
  username: z.string().trim().max(32).optional(),
});

export type ProfileInput = z.infer<typeof ProfileSchema>;

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new TelegramError("invalid", issue?.message || "That request was invalid.", 400);
  }
  return result.data;
}

/** Only http(s) URLs. Drops javascript:, data:, and malformed picture claims. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^@/, "");
  if (!value) return null;
  if (!USERNAME.test(value)) {
    throw new TelegramError(
      "invalid",
      "Username must be 5–32 letters, numbers, or underscores.",
      400,
    );
  }
  return value;
}

export function clampBio(raw: string): string {
  return sliceGraphemes(raw.trim(), BIO_GRAPHEME_LIMIT);
}

export function assertBioLimit(raw: string): void {
  if (graphemeCount(raw) > BIO_GRAPHEME_LIMIT) {
    throw new TelegramError("invalid", "Bio is too long.", 400);
  }
}

const ALLOWED_CREDENTIAL_FIELDS = new Set([
  "start_payload",
  "start_payload_exp",
  "webhook_secret",
  "webhook_active",
  "last_update_id",
  "hello_at",
  "checks_json",
  "onboarded_at",
  "bot_token_enc",
  "bot_id",
  "bot_username",
  "bot_name",
  "token_hint",
]);

export function pickCredentialFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_CREDENTIAL_FIELDS.has(key)) {
      throw new TelegramError("invalid", "Could not save that field.", 400);
    }
    out[key] = value;
  }
  return out;
}
