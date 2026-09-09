import { useEffect, useState } from "react";
import {
  loadOperatorDeskFn,
  proposeMediaFn,
  uploadMediaFn,
  setMediaApprovalFn,
  sendMediaFn,
} from "@/lib/operator/fns";
import { useTelegram } from "@/lib/telegram/store";
import { cn } from "@/lib/utils";
import { tgFocusClass } from "./format";

type Asset = { id: string; title: string; kind: string; approval: string; provesLiveHuman: false };
type Attachment = {
  id: string;
  conversationId: string;
  kind: string;
  caption: string | null;
  bytesAvailable: boolean;
};

export function MediaPane() {
  const selectedChatId = useTelegram((s) => s.selectedChatId);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const desk = await loadOperatorDeskFn();
    setAssets(desk.assets);
    setAttachments(desk.attachments);
  }

  useEffect(() => {
    let cancelled = false;
    void loadOperatorDeskFn()
      .then((desk) => {
        if (cancelled) return;
        setAssets(desk.assets);
        setAttachments(desk.attachments);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function propose(assetId: string) {
    if (!selectedChatId) {
      setNote("Open a chat first, then propose a still.");
      return;
    }
    const result = await proposeMediaFn({ data: { conversationId: selectedChatId, assetId } });
    setNote(
      result.ok
        ? "Approved — not sent. A stored still is not proof of a live person."
        : result.reason === "revoked"
          ? "That still is revoked."
          : result.reason === "missing_asset"
            ? "That still is missing."
            : "Not approved.",
    );
    if (result.ok) {
      const sent = await sendMediaFn({ data: { proposalId: result.id } });
      if (sent.ok && sent.status === "confirmed") {
        setNote("Sent through the desk transport. Stored media is still not proof of a live person.");
      } else if (!sent.ok && sent.reason === "media_transport_not_live") {
        setNote("Approved — not sent. Live photo send is not available on this session.");
      }
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const bytesBase64 = btoa(binary);
      const uploaded = await uploadMediaFn({
        data: { title: file.name.replace(/\.[a-z0-9]+$/i, "") || "Still", mime: file.type, bytesBase64 },
      });
      if (!uploaded.ok) {
        setNote(
          uploaded.reason === "too_large"
            ? "That file is too large."
            : uploaded.reason === "unsupported_type"
              ? "Use a JPEG, PNG, WebP, or GIF."
              : "Could not store that file.",
        );
        return;
      }
      await reload();
      setNote("Uploaded as pending. Approve it before proposing.");
    } catch {
      setNote("Could not store that file.");
    } finally {
      setBusy(false);
    }
  }

  async function setApproval(assetId: string, approval: "approved" | "revoked") {
    setBusy(true);
    try {
      const result = await setMediaApprovalFn({ data: { assetId, approval } });
      if (!result.ok) setNote("Could not update that still.");
      else {
        await reload();
        setNote(approval === "approved" ? "Approved. Not sent." : "Revoked. It cannot send.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center px-4">
        <h2 className="text-sm font-medium">Media</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <p className="text-sm leading-relaxed text-[var(--tg-text-secondary)]">
          Private library. Stored or generated media is never treated as a live sitting.
        </p>
        <label className="mt-4 block text-sm">
          Upload a still
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={busy}
            data-testid="media-upload"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            className={cn("mt-2 block w-full text-sm", tgFocusClass)}
          />
        </label>
        {note ? (
          <p className="mt-3 rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-sm" role="status">
            {note}
          </p>
        ) : null}
        <h3 className="mt-5 text-sm font-medium">Incoming</h3>
        {attachments.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--tg-text-secondary)]">No incoming files on this desk.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {attachments.map((a) => (
              <li key={a.id} className="rounded-xl bg-[var(--tg-item-hover)] px-3 py-3 text-sm">
                <p className="capitalize">{a.kind}</p>
                <p className="mt-1 text-[var(--tg-text-secondary)]">
                  {a.caption?.trim() ? a.caption : "No caption"}
                  {a.bytesAvailable ? "" : " · bytes not available"}
                </p>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-6 text-sm font-medium">Approved library</h3>
        {assets.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--tg-text-secondary)]">No library stills yet.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {assets.map((asset) => (
              <li key={asset.id} className="rounded-xl bg-[var(--tg-item-hover)] px-3 py-3">
                <p className="text-sm">{asset.title}</p>
                <p className="mt-1 text-xs text-[var(--tg-text-secondary)]">
                  {asset.approval} · stored media, not proof of a live person
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {asset.approval === "pending" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setApproval(asset.id, "approved")}
                      className={cn("h-11 min-h-[44px] text-sm text-[var(--tg-primary)]", tgFocusClass)}
                    >
                      Approve
                    </button>
                  ) : null}
                  {asset.approval !== "revoked" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setApproval(asset.id, "revoked")}
                      className={cn("h-11 min-h-[44px] text-sm text-[var(--tg-text-secondary)]", tgFocusClass)}
                    >
                      Revoke
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={asset.approval !== "approved" || busy}
                    onClick={() => void propose(asset.id)}
                    className={cn(
                      "h-11 min-h-[44px] text-sm text-[var(--tg-primary)] disabled:opacity-40",
                      tgFocusClass,
                    )}
                  >
                    Propose and send
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
