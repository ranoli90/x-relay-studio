import type { TelegramCheckResult } from "./checks";

export type TelegramPath = "oidc" | "mtproto";

export type TelegramChatKind = "notes" | "bot" | "user";

export type TelegramFolder = "all" | "personal" | "saved";

export type TelegramOnboardingStep =
  | "welcome"
  | "app"
  | "phone"
  | "code"
  | "password"
  | "checks"
  | "done";

export type TelegramMessageStatus = "sending" | "sent";

export type TelegramAiStatus = "queued" | "outbound" | "held";

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
  replicaUsername: string | null;
  displayFirstName: string;
  displayLastName: string | null;
  displayUsername: string | null;
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
  peerId: string | null;
};

export type TelegramMessage = {
  id: string;
  chatId: string;
  fromSelf: boolean;
  authorName: string;
  body: string;
  createdAt: string;
  status: TelegramMessageStatus;
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

export type TelegramWatch = {
  watching: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  chatsWatched: number;
  messagesIngested: number;
  pendingForAi: number;
  openRouterReady: boolean;
  automationArmed: boolean;
  phoneHint: string | null;
  needsPassword: boolean;
  hasSession: boolean;
};

export type TelegramSnapshot = {
  configured: boolean;
  mtprotoEnabled: boolean;
  onboarded: boolean;
  account: TelegramAccount | null;
  chats: TelegramChat[];
  credential: TelegramCredentialPublic | null;
  watch: TelegramWatch | null;
};

export type TelegramStatus = {
  configured: boolean;
  mtprotoEnabled: boolean;
  linked: boolean;
  preview: boolean;
  onboarded: boolean;
  hasOwnKey: boolean;
  platformLogin: boolean;
  needsAppKeys: boolean;
  persistent: boolean;
  step: TelegramOnboardingStep;
  credential: TelegramCredentialPublic | null;
  watch: TelegramWatch | null;
  checks: TelegramCheckResult[];
};

export const STUDIO_NOTES_CHAT_ID = "studio-notes";
export const BIO_GRAPHEME_LIMIT = 70;
