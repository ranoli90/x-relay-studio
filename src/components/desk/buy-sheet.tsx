import { useEffect, useMemo, useState } from "react";
import { copyText } from "@/lib/clipboard";
import {
  createThreadInvoice,
  getWallet,
  pollInvoice,
  type InvoicePublic,
  type WalletPublic,
} from "@/lib/billing/fns";

type Step = "packs" | "coin" | "pay" | "done";

const TAP = "min-h-11 min-w-11";

function threadsLabel(wallet: WalletPublic | null): string {
  if (!wallet) return "—";
  return String(wallet.threads);
}

function invoiceNotice(invoice: InvoicePublic): { tone: "wait" | "fail" | "ok"; text: string } {
  if (invoice.status === "paid") {
    return { tone: "ok", text: "Paid. Threads are on the desk." };
  }
  if (invoice.status === "underpay") {
    return {
      tone: "fail",
      text: "Underpaid. This invoice is not credited. Open a new one and send the exact amount.",
    };
  }
  if (invoice.status === "expired") {
    return {
      tone: "fail",
      text: "Invoice expired. Late payment is not credited. Open a new invoice.",
    };
  }
  if (invoice.status === "cancelled") {
    return { tone: "fail", text: "Invoice cancelled. Open a new one to pay." };
  }
  if (invoice.status === "uncertain") {
    return {
      tone: "fail",
      text: "Payment status is uncertain. Do not send again until this invoice settles.",
    };
  }
  return { tone: "wait", text: "Waiting for payment. A screenshot is not paid." };
}

export function BuySheet({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState<WalletPublic | null>(null);
  const [step, setStep] = useState<Step>("packs");
  const [skuId, setSkuId] = useState("pack:starter");
  const [coinId, setCoinId] = useState("USDT_TRX");
  const [invoice, setInvoice] = useState<InvoicePublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void getWallet()
      .then((w) => {
        setWallet(w);
        setCoinId(w.defaultCoin);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open || step !== "pay" || !invoice) return;
    if (invoice.status === "paid") return;
    if (invoice.status === "expired" || invoice.status === "cancelled") return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      void pollInvoice({ data: { invoiceId: invoice.id } })
        .then((row) => {
          setInvoice(row);
          if (row.status === "paid") {
            setStep("done");
            void getWallet()
              .then(setWallet)
              .catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [open, step, invoice]);

  const selected = useMemo(
    () => wallet?.packs.find((p) => p.id === skuId) ?? wallet?.plans.find((p) => p.id === skuId),
    [wallet, skuId],
  );

  const remain = invoice?.expiresAt ? Math.max(0, Date.parse(invoice.expiresAt) - now) : 0;
  const mm = String(Math.floor(remain / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, "0");
  const notice = invoice ? invoiceNotice(invoice) : null;
  const paid = invoice?.status === "paid";

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const row = await createThreadInvoice({
        data: { skuId, coinId, multiples: 1 },
      });
      setInvoice(row);
      if (row.status === "paid") setStep("done");
      else setStep("pay");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function copyAddr() {
    if (!invoice?.walletHash) return;
    const ok = await copyText(invoice.walletHash);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  function openSheet() {
    setStep("packs");
    setError(null);
    setOpen(true);
  }

  const trigger = compact ? (
    <button
      type="button"
      onClick={openSheet}
      className={`${TAP} shrink-0 rounded-md border border-border bg-surface px-2.5 py-1 text-left`}
    >
      <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Threads</span>
      <span className="block font-mono text-xs text-fg">{threadsLabel(wallet)}</span>
    </button>
  ) : (
    <button
      type="button"
      onClick={openSheet}
      className={`${TAP} fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))] z-40 rounded-full border border-border bg-surface px-4 py-3 text-sm text-fg shadow-[0_12px_40px_rgb(0_0_0/0.45)]`}
    >
      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Threads</span>
      <span className="block text-left text-base">{threadsLabel(wallet)}</span>
    </button>
  );

  return (
    <>
      {trigger}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/55" onClick={() => setOpen(false)} />
          <section className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border border-border bg-bg px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 sm:max-w-md sm:rounded-xl sm:px-5">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border sm:hidden" />
            <header className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Buy threads</p>
                <h2 className="text-lg text-fg">
                  {wallet ? `${wallet.threads} left` : "Balance unknown"}
                </h2>
              </div>
              <button type="button" className={`${TAP} px-3 text-sm text-muted`} onClick={() => setOpen(false)}>
                Close
              </button>
            </header>

            {wallet?.followDiscountAvailable ? (
              <div className="mb-4 rounded-md border border-border bg-surface px-3 py-3 text-sm text-muted">
                First payment: follow Telegram and Discord for $5 off. Membership is checked on the server when you open an invoice.
                <div className="mt-2 flex flex-wrap gap-2">
                  {wallet.telegramUrl ? (
                    <a
                      className={`${TAP} inline-flex items-center text-fg underline decoration-border underline-offset-4`}
                      href={wallet.telegramUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Telegram
                    </a>
                  ) : null}
                  {wallet.discordUrl ? (
                    <a
                      className={`${TAP} inline-flex items-center text-fg underline decoration-border underline-offset-4`}
                      href={wallet.discordUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Discord
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === "packs" ? (
              <div className="grid grid-cols-2 gap-2">
                {wallet?.packs.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => setSkuId(pack.id)}
                    className={`${TAP} rounded-md border px-3 py-3 text-left ${
                      skuId === pack.id ? "border-accent bg-surface-2" : "border-border bg-surface"
                    }`}
                  >
                    <span className="block text-sm text-fg">{pack.label}</span>
                    <span className="block font-mono text-xs text-muted">{pack.threads.toLocaleString()} threads</span>
                    <span className="mt-2 block text-fg">{pack.priceLabel}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`${TAP} col-span-2 mt-2 rounded-md bg-accent text-sm text-accent-fg disabled:opacity-40`}
                  disabled={!selected}
                  onClick={() => setStep("coin")}
                >
                  Continue
                </button>
              </div>
            ) : null}

            {step === "coin" ? (
              <div>
                <p className="mb-2 text-sm text-muted">
                  {selected?.label} · {selected?.priceLabel}. Pick a coin.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {wallet?.coins.map((coin) => (
                    <button
                      key={coin.id}
                      type="button"
                      onClick={() => setCoinId(coin.id)}
                      className={`${TAP} rounded-md border px-3 py-3 text-left ${
                        coinId === coin.id ? "border-accent bg-surface-2" : "border-border bg-surface"
                      }`}
                    >
                      <span className="block text-sm text-fg">{coin.ticker}</span>
                      <span className="block font-mono text-[11px] text-muted">{coin.network}</span>
                    </button>
                  ))}
                </div>
                {error ? <p className="mt-3 text-sm text-down">{error}</p> : null}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className={`${TAP} flex-1 rounded-md border border-border text-sm text-muted`}
                    onClick={() => setStep("packs")}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className={`${TAP} flex-1 rounded-md bg-accent text-sm text-accent-fg disabled:opacity-40`}
                    disabled={busy}
                    onClick={() => void pay()}
                  >
                    {busy ? "Opening…" : "Get address"}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "pay" && invoice ? (
              <div>
                <p className="text-sm text-muted">
                  Send exactly {invoice.amountCrypto ?? invoice.amountLabel} in {invoice.coinLabel}.
                  {invoice.expiresAt ? ` Expires ${mm}:${ss}.` : ""}
                </p>
                {invoice.qrCode ? (
                  <img src={invoice.qrCode} alt="Payment QR" className="mx-auto my-4 h-44 w-44 rounded-md bg-fg p-2" />
                ) : null}
                {invoice.walletHash ? (
                  <button
                    type="button"
                    onClick={() => void copyAddr()}
                    className={`${TAP} w-full break-all rounded-md border border-border bg-surface px-3 py-3 text-left font-mono text-xs text-fg`}
                  >
                    {invoice.walletHash}
                    <span className="mt-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
                      {copied ? "Copied" : "Tap to copy"}
                    </span>
                  </button>
                ) : (
                  <a
                    href={invoice.invoiceUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className={`${TAP} mt-3 flex items-center rounded-md border border-border bg-surface px-3 py-3 text-sm text-fg`}
                  >
                    Open payment page
                  </a>
                )}
                <p
                  className={`mt-3 font-mono text-xs uppercase tracking-[0.14em] ${
                    notice?.tone === "fail" ? "text-down" : notice?.tone === "ok" ? "text-ok" : "text-muted"
                  }`}
                >
                  {notice?.text}
                </p>
              </div>
            ) : null}

            {step === "done" && paid ? (
              <div className="py-6 text-center">
                <p className="text-ok">Paid. Threads are on the desk.</p>
                <p className="mt-2 font-mono text-sm text-muted">
                  {wallet ? `${wallet.threads} available` : "Balance unknown"}
                </p>
                <button
                  type="button"
                  className={`${TAP} mt-4 w-full rounded-md bg-accent text-sm text-accent-fg`}
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
