/** Isolated, harmless fixtures. Never copy production chats. */
import { newOperatorId } from "./ids.ts";
import type { IncomingAttachment, LibraryAsset } from "./media.ts";

export const FIXTURE_CREATOR_ID = "creator_preview";

export type FixtureChat = {
  id: string;
  title: string;
  preview: string;
  unread: number;
  lastAt: string;
  peerId: string;
};

export type FixtureMessage = {
  id: string;
  chatId: string;
  fromSelf: boolean;
  authorName: string;
  body: string;
  createdAt: string;
  status: "confirmed" | "draft" | "uncertain";
  providerAt: string;
};

export function isolatedFixtureSet(now = "2026-09-06T12:00:00.000Z"): {
  chats: FixtureChat[];
  messages: FixtureMessage[];
  attachments: IncomingAttachment[];
  assets: LibraryAsset[];
  draft: { chatId: string; body: string };
  offer: { title: string; amountMinor: number; currency: string };
} {
  const alex = "chat_fix_alex";
  const jules = "chat_fix_jules";
  const notes = "chat_fix_notes";
  return {
    chats: [
      {
        id: alex,
        title: "Alex",
        preview: "Does the photo notes pack still include the two stills?",
        unread: 2,
        lastAt: now,
        peerId: "peer_fix_alex",
      },
      {
        id: jules,
        title: "Jules",
        preview: "Thanks — I'll sit with it.",
        unread: 0,
        lastAt: "2026-09-06T11:10:00.000Z",
        peerId: "peer_fix_jules",
      },
      {
        id: notes,
        title: "Saved Messages",
        preview: "Local notes stay on this desk.",
        unread: 0,
        lastAt: "2026-09-05T18:00:00.000Z",
        peerId: "peer_fix_notes",
      },
    ],
    messages: [
      {
        id: "msg_fix_1",
        chatId: alex,
        fromSelf: false,
        authorName: "Alex",
        body: "Hi — is the photo notes pack still available?",
        createdAt: "2026-09-06T11:54:00.000Z",
        status: "confirmed",
        providerAt: "2026-09-06T11:54:00.000Z",
      },
      {
        id: "msg_fix_2",
        chatId: alex,
        fromSelf: false,
        authorName: "Alex",
        body: "Does the photo notes pack still include the two stills?",
        createdAt: now,
        status: "confirmed",
        providerAt: now,
      },
      {
        id: "msg_fix_3",
        chatId: jules,
        fromSelf: false,
        authorName: "Jules",
        body: "Thanks — I'll sit with it.",
        createdAt: "2026-09-06T11:10:00.000Z",
        status: "confirmed",
        providerAt: "2026-09-06T11:10:00.000Z",
      },
      {
        id: "msg_fix_4",
        chatId: notes,
        fromSelf: true,
        authorName: "You",
        body: "Local notes stay on this desk. They are not a message to a customer.",
        createdAt: "2026-09-05T18:00:00.000Z",
        status: "draft",
        providerAt: "2026-09-05T18:00:00.000Z",
      },
    ],
    attachments: [
      {
        id: newOperatorId("inatt"),
        conversationId: alex,
        kind: "image",
        caption: null,
        providerMediaId: "fix_img_1",
        bytesAvailable: true,
        providerAt: now,
      },
    ],
    assets: [
      {
        id: "asset_fix_notes",
        ownerUserId: "preview",
        bindingId: "bind_preview",
        kind: "image",
        title: "Photo notes still A",
        mime: "image/svg+xml",
        byteSize: 420,
        storageKey: "fixture:still-a",
        approval: "approved",
        provesLiveHuman: false,
      },
      {
        id: "asset_fix_revoked",
        ownerUserId: "preview",
        bindingId: "bind_preview",
        kind: "image",
        title: "Revoked still",
        mime: "image/svg+xml",
        byteSize: 120,
        storageKey: "fixture:revoked",
        approval: "revoked",
        provesLiveHuman: false,
      },
    ],
    draft: { chatId: alex, body: "The published pack is $12.50 and includes two stills." },
    offer: { title: "Photo notes pack", amountMinor: 1250, currency: "USD" },
  };
}
