export type TelegramPath = "oidc" | "mtproto";

export type TelegramChatKind = "notes" | "bot" | "user";

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

export type TelegramSnapshot = {
  configured: boolean;
  mtprotoEnabled: boolean;
  account: TelegramAccount | null;
  chats: TelegramChat[];
};

export type TelegramStatus = {
  configured: boolean;
  mtprotoEnabled: boolean;
  linked: boolean;
  preview: boolean;
};

export const STUDIO_NOTES_CHAT_ID = "studio-notes";
export const BIO_GRAPHEME_LIMIT = 70;
