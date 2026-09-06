import { useEffect, useState } from "react";
import { loadOperatorDeskFn, publishBusinessFn } from "@/lib/operator/fns";
import { formatMoney, money } from "@/lib/operator/money";
import { cn } from "@/lib/utils";
import { tgFocusClass } from "./format";

type OfferDraft = { title: string; amount: string; currency: string; available: boolean };

export function BusinessPane() {
  const [plain, setPlain] = useState("");
  const [offers, setOffers] = useState<OfferDraft[]>([
    { title: "Photo notes pack", amount: "12.50", currency: "USD", available: true },
  ]);
  const [paymentCopy, setPaymentCopy] = useState(
    "Approved USD instructions: send to the listed handle. Workspace credits never settle this.",
  );
  const [destinationRef, setDestinationRef] = useState("@studio_pay");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadOperatorDeskFn()
      .then((desk) => {
        if (cancelled) return;
        if (desk.projection) {
          setPlain(`${desk.projection.displayName}\n${desk.projection.about}`.trim());
          setPaymentCopy(desk.projection.paymentCopy || paymentCopy);
          setRevision(desk.projection.revision);
          if (desk.projection.offers.length) {
            setOffers(
              desk.projection.offers.map((o) => ({
                title: o.title,
                amount: (o.amount.minor / 100).toFixed(2),
                currency: o.amount.currency,
                available: o.available,
              })),
            );
          }
          setPublished(
            `${desk.projection.displayName} · revision ${desk.projection.revision} · ${desk.projection.offers
              .map((o) => `${o.title} ${formatMoney(o.amount)}`)
              .join(", ")}`,
          );
        }
        if (desk.payment.destinationRef) setDestinationRef(desk.payment.destinationRef);
        if (desk.payment.copy) setPaymentCopy(desk.payment.copy);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const parsed = offers
        .map((o) => ({
          title: o.title.trim(),
          amountMinor: money(Math.round(Number(o.amount) * 100), o.currency || "USD").minor,
          currency: o.currency.trim().toUpperCase(),
          available: o.available,
        }))
        .filter((o) => o.title && o.amountMinor > 0);
      const result = await publishBusinessFn({
        data: {
          plainText: plain,
          offers: parsed,
          paymentCopy,
          destinationRef,
        },
      });
      setRevision(result.revision);
      setPublished(
        `${result.displayName} · revision ${result.revision} · ${result.offers
          .map((o) => `${o.title} ${formatMoney(o.amount)}`)
          .join(", ")}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center px-4">
        <h2 className="text-sm font-medium">Business</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <p className="text-sm leading-relaxed text-[var(--tg-text-secondary)]">
          Write a short brief. Review the priced offers. Publish. The assistant only uses that
          published revision — it will not invent a catalog.
        </p>
        {published ? (
          <p className="mt-3 rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-sm">{published}</p>
        ) : (
          <p className="mt-3 text-sm text-[var(--tg-text-secondary)]">No published revision yet.</p>
        )}
        <label className="mt-4 block text-sm">
          Brief
          <textarea
            value={plain}
            onChange={(e) => setPlain(e.target.value)}
            rows={4}
            className={cn(
              "mt-1 w-full rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-base text-[var(--tg-text)]",
              tgFocusClass,
            )}
          />
        </label>
        {offers.map((offer, i) => (
          <div key={i} className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-3">
            <label className="block text-sm">
              Offer
              <input
                value={offer.title}
                onChange={(e) =>
                  setOffers((rows) => rows.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))
                }
                className={cn(
                  "mt-1 h-11 w-full rounded-lg bg-[var(--tg-bg)] px-3 text-base",
                  tgFocusClass,
                )}
              />
            </label>
            <div className="mt-2 grid grid-cols-[1fr_5rem] gap-2">
              <label className="text-sm">
                Amount
                <input
                  inputMode="decimal"
                  value={offer.amount}
                  onChange={(e) =>
                    setOffers((rows) => rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                  }
                  className={cn("mt-1 h-11 w-full rounded-lg bg-[var(--tg-bg)] px-3 text-base", tgFocusClass)}
                />
              </label>
              <label className="text-sm">
                Currency
                <input
                  value={offer.currency}
                  onChange={(e) =>
                    setOffers((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, currency: e.target.value.toUpperCase() } : r)),
                    )
                  }
                  className={cn("mt-1 h-11 w-full rounded-lg bg-[var(--tg-bg)] px-3 text-base", tgFocusClass)}
                />
              </label>
            </div>
            <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={offer.available}
                onChange={(e) =>
                  setOffers((rows) => rows.map((r, j) => (j === i ? { ...r, available: e.target.checked } : r)))
                }
              />
              Available
            </label>
          </div>
        ))}
        <button
          type="button"
          className={cn("mt-3 min-h-[44px] text-sm text-[var(--tg-primary)]", tgFocusClass)}
          onClick={() =>
            setOffers((rows) => [...rows, { title: "", amount: "", currency: "USD", available: true }])
          }
        >
          Add offer
        </button>
        <label className="mt-4 block text-sm">
          Public payment instructions
          <textarea
            value={paymentCopy}
            onChange={(e) => setPaymentCopy(e.target.value)}
            rows={3}
            className={cn(
              "mt-1 w-full rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-base",
              tgFocusClass,
            )}
          />
        </label>
        <label className="mt-3 block text-sm">
          Destination handle
          <input
            value={destinationRef}
            onChange={(e) => setDestinationRef(e.target.value)}
            className={cn(
              "mt-1 h-11 w-full rounded-xl bg-[var(--tg-item-hover)] px-3 text-base",
              tgFocusClass,
            )}
          />
        </label>
        <p className="mt-2 text-xs leading-relaxed text-[var(--tg-text-secondary)]">
          Credentials stay off this screen. Workspace thread credits never settle a customer offer.
        </p>
        {error ? (
          <p className="mt-3 text-sm text-down" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void publish()}
          className={cn(
            "mt-4 h-12 w-full rounded-xl bg-[var(--tg-primary)] text-[var(--tg-own-text)]",
            tgFocusClass,
          )}
        >
          {busy ? "Publishing…" : revision ? "Publish new revision" : "Publish"}
        </button>
      </div>
    </div>
  );
}
