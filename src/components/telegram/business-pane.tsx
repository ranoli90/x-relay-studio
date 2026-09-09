import { useEffect, useRef, useState } from "react";

import { loadOperatorDeskFn, publishBusinessFn } from "@/lib/operator/fns";
import { formatMoney, moneyFromFractional, minorToFractionalString } from "@/lib/operator/money";
import { cn } from "@/lib/utils";
import { tgFocusClass } from "./format";

type OfferDraft = { title: string; amount: string; currency: string; available: boolean };

export function BusinessPane() {
  const [plain, setPlain] = useState("");
  const [offers, setOffers] = useState<OfferDraft[]>([{ title: "", amount: "", currency: "USD", available: true }]);
  const [paymentCopy, setPaymentCopy] = useState("");
  const [destinationRef, setDestinationRef] = useState("");
  const [voice, setVoice] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const dirtyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [published, setPublished] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadOperatorDeskFn()
      .then((desk) => {
        if (cancelled) return;
        if (dirtyRef.current) {
          setLoadState("ready");
          return;
        }

        if (desk.projection) {
          setPlain(`${desk.projection.displayName}\n${desk.projection.about}`.trim());
          setPaymentCopy(desk.projection.paymentCopy || "");
          setVoice(desk.projection.voice || "");
          setBoundaries(desk.projection.boundaries || "");
          setRevision(desk.projection.revision);
          if (desk.projection.offers.length) {
            setOffers(
              desk.projection.offers.map((o) => ({
                title: o.title,
                amount: minorToFractionalString(o.amount.minor, o.amount.currency),
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
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
        setError("Could not load the published business. Retry before publishing.");
      });
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
          amountMinor: moneyFromFractional(Number(o.amount), o.currency).minor,
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
          voice,
          boundaries,
        },
      });
      setRevision(result.revision);
      setVoice(result.voice || voice);
      setBoundaries(result.boundaries || boundaries);
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
        {loadState === "loading" ? (
          <p className="mt-3 text-sm text-[var(--tg-text-secondary)]" data-testid="business-load">
            Loading published business…
          </p>
        ) : (
          <p className="sr-only" data-testid="business-ready">
            ready
          </p>
        )}
        {published ? (

          <p className="mt-3 rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-sm">{published}</p>
        ) : (
          <p className="mt-3 text-sm text-[var(--tg-text-secondary)]">No published revision yet.</p>
        )}
        <label className="mt-4 block text-sm">
          Brief
          <textarea
            value={plain}
            onChange={(e) => {
              dirtyRef.current = true;
              setPlain(e.target.value);
            }}

            rows={4}
            data-testid="business-brief"
            className={cn(
              "mt-1 w-full rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-base text-[var(--tg-text)]",
              tgFocusClass,
            )}
          />
        </label>
        <label className="mt-4 block text-sm">
          Voice
          <textarea
            value={voice}
            data-testid="business-voice"
            onChange={(e) => {
              dirtyRef.current = true;
              setVoice(e.target.value);
            }}
            rows={2}
            className={cn(
              "mt-1 w-full rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-base",
              tgFocusClass,
            )}
          />
        </label>
        <label className="mt-3 block text-sm">
          Boundaries
          <textarea
            value={boundaries}
            data-testid="business-boundaries"
            onChange={(e) => {
              dirtyRef.current = true;
              setBoundaries(e.target.value);
            }}
            rows={2}
            className={cn(
              "mt-1 w-full rounded-xl bg-[var(--tg-item-hover)] px-3 py-2 text-base",
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
                data-testid={`offer-title-${i}`}
                onChange={(e) => {
                  dirtyRef.current = true;
                  setOffers((rows) => rows.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)));
                }}

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
                  data-testid={`offer-amount-${i}`}
                  onChange={(e) => {
                    dirtyRef.current = true;
                    setOffers((rows) => rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)));
                  }}

                  className={cn("mt-1 h-11 w-full rounded-lg bg-[var(--tg-bg)] px-3 text-base", tgFocusClass)}
                />
              </label>
              <label className="text-sm">
                Currency
                <input
                  value={offer.currency}
                  onChange={(e) => {
                    dirtyRef.current = true;
                    setOffers((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, currency: e.target.value.toUpperCase() } : r)),
                    );
                  }}

                  className={cn("mt-1 h-11 w-full rounded-lg bg-[var(--tg-bg)] px-3 text-base", tgFocusClass)}
                />
              </label>
            </div>
            <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={offer.available}
                onChange={(e) => {
                  dirtyRef.current = true;
                  setOffers((rows) => rows.map((r, j) => (j === i ? { ...r, available: e.target.checked } : r)));
                }}

              />
              Available
            </label>
          </div>
        ))}
        <button
          type="button"
          className={cn("mt-3 min-h-[44px] text-sm text-[var(--tg-primary)]", tgFocusClass)}
          onClick={() => {
            dirtyRef.current = true;
            setOffers((rows) => [...rows, { title: "", amount: "", currency: "USD", available: true }]);
          }}

        >
          Add offer
        </button>
        <label className="mt-4 block text-sm">
          Public payment instructions
          <textarea
            value={paymentCopy}
            data-testid="business-payment-copy"
            onChange={(e) => {
              dirtyRef.current = true;
              setPaymentCopy(e.target.value);
            }}

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
            data-testid="business-destination"
            onChange={(e) => {
              dirtyRef.current = true;
              setDestinationRef(e.target.value);
            }}

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
          disabled={busy || loadState !== "ready"}
          data-testid="business-publish"
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
