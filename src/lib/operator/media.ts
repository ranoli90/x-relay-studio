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
