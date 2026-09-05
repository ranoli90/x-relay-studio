import type { TelegramCheckResult } from "./checks";

export type TelegramPath = "oidc" | "mtproto";

export type TelegramChatKind = "notes" | "bot" | "user";

export type TelegramOnboardingStep = "welcome" | "key" | "hello" | "checks" | "done";

export type TelegramAccount = {
  telegramUserId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  authDate: string | null;
  path: TelegramPath;
  botCanWrite: boolean;
  preview: boolean;
  replicaFirstName: string | null;
  replicaLastName: string | null;
  replicaAbout: string | null;
  displayFirstName: string;
  displayLastName: string | null;
  displayName: string;
};

export type TelegramChat = {
  id: string;
  kind: TelegramChatKind;
  title: string;
  photoUrl: string | null;
  lastPreview: string | null;
  lastAt: string | null;
  unread: number;
  pinned: boolean;
  muted: boolean;
};

export type TelegramMessage = {
  id: string;
  chatId: string;
  fromSelf: boolean;
  authorName: string;
  body: string;
  createdAt: string;
};

export type TelegramCredentialPublic = {
  hasToken: boolean;
  botUsername: string | null;
  botName: string | null;
  botId: number | null;
  tokenHint: string | null;
  helloLink: string | null;
  helloReceived: boolean;
  onboarded: boolean;
  webhookActive: boolean;
  checks: TelegramCheckResult[];
  step: TelegramOnboardingStep;
};

export type TelegramSnapshot = {
  configured: boolean;
  mtprotoEnabled: boolean;
  onboarded: boolean;
  account: TelegramAccount | null;
  chats: TelegramChat[];
  credential: TelegramCredentialPublic | null;
};

export type TelegramStatus = {
  configured: boolean;
  mtprotoEnabled: boolean;
  linked: boolean;
  preview: boolean;
  onboarded: boolean;
  hasOwnKey: boolean;
  platformLogin: boolean;
  step: TelegramOnboardingStep;
  credential: TelegramCredentialPublic | null;
};

export const STUDIO_NOTES_CHAT_ID = "studio-notes";
export const BIO_GRAPHEME_LIMIT = 70;
