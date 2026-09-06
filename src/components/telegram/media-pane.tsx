import { useEffect, useState } from "react";
import { loadOperatorDeskFn, proposeMediaFn } from "@/lib/operator/fns";
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
                <button
                  type="button"
                  disabled={asset.approval !== "approved"}
                  onClick={() => void propose(asset.id)}
                  className={cn(
                    "mt-2 h-11 min-h-[44px] text-sm text-[var(--tg-primary)] disabled:opacity-40",
                    tgFocusClass,
                  )}
                >
                  Propose to open chat
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
