export type MediaKind = "image" | "video" | "audio" | "file";
export type AssetApproval = "pending" | "approved" | "revoked";
export type DeliveryStatus =
  | "proposed"
  | "approved_not_sent"
  | "queued"
  | "sending"
  | "confirmed"
  | "failed"
  | "missing"
  | "revoked"
  | "canceled";

export type IncomingAttachment = {
  id: string;
  conversationId: string;
  kind: MediaKind;
  caption: string | null;
  providerMediaId: string;
  bytesAvailable: boolean;
  providerAt: string;
};

export type LibraryAsset = {
  id: string;
  ownerUserId: string;
  bindingId: string;
  kind: MediaKind;
  title: string;
  mime: string;
  byteSize: number;
  storageKey: string;
  approval: AssetApproval;
  /** Stored or generated media never proves a live human act. */
  provesLiveHuman: false;
};

export type MediaProposal = {
  id: string;
  conversationId: string;
  assetId: string;
  status: DeliveryStatus;
};

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function attachmentCaption(att: IncomingAttachment): string | null {
  const c = att.caption?.trim() ?? "";
  return c ? c : null;
}

export function canProposeAsset(asset: LibraryAsset | null): { ok: true } | { ok: false; reason: string } {
  if (!asset) return { ok: false, reason: "missing_asset" };
  if (asset.approval === "revoked") return { ok: false, reason: "revoked" };
  if (asset.approval !== "approved") return { ok: false, reason: "not_approved" };
  return { ok: true };
}

export function canSendAsset(
  asset: LibraryAsset | null,
  ownerUserId: string,
  bindingId?: string,
): { ok: true } | { ok: false; reason: string } {
  const gate = canProposeAsset(asset);
  if (!gate.ok) return gate;
  if (asset!.ownerUserId !== ownerUserId) return { ok: false, reason: "wrong_tenant" };
  if (bindingId && asset!.bindingId && asset!.bindingId !== bindingId) {
    return { ok: false, reason: "wrong_binding" };
  }
  if (!asset!.storageKey.trim()) return { ok: false, reason: "missing_bytes" };
  return { ok: true };
}

export function validateUpload(input: {
  mime: string;
  byteSize: number;
  title?: string;
}): { ok: true; kind: MediaKind; mime: string; title: string } | { ok: false; reason: string } {
  const mime = input.mime.trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return { ok: false, reason: "unsupported_type" };
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, reason: "empty_file" };
  }
  if (input.byteSize > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  const title = (input.title ?? "Still").trim().slice(0, 80) || "Still";
  return { ok: true, kind: "image", mime, title };
}

export function deliveryAfterTransport(
  proposal: MediaProposal,
  asset: LibraryAsset | null,
  transport: "confirmed" | "failed" | "uncertain" | "canceled",
): MediaProposal {
  const gate = canProposeAsset(asset);
  if (!gate.ok) {
    return { ...proposal, status: gate.reason === "revoked" ? "revoked" : "missing" };
  }
  if (transport === "confirmed") return { ...proposal, status: "confirmed" };
  if (transport === "canceled") return { ...proposal, status: "canceled" };
  if (transport === "uncertain") return { ...proposal, status: "failed" };
  return { ...proposal, status: "failed" };
}

export function honestMediaCopy(asset: LibraryAsset): string {
  return `${asset.title} — stored media, not proof of a live person.`;
}
