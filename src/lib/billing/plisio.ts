import { assertCoin } from "./coins.ts";

const PLISIO = "https://api.plisio.net/api/v1/invoices/new";

export type PlisioInvoice = {
  txnId: string;
  invoiceUrl: string;
  walletHash: string | null;
  qrCode: string | null;
  amountCrypto: string | null;
  currency: string;
  expireUtc: number | null;
};

function secret(): string {
  const key = process.env.PLISIO_SECRET?.trim();
  if (!key) throw new Error("PLISIO_SECRET is not set.");
  return key;
}

export function publicOrigin(): string {
  const raw =
    process.env.BETTER_AUTH_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : "");
  return raw.replace(/\/$/, "");
}

export async function createPlisioInvoice(input: {
  orderNumber: string;
  orderName: string;
  amountCents: number;
  coinId: string;
  callbackUrl: string;
}): Promise<PlisioInvoice> {
  const coin = assertCoin(input.coinId);
  if (!Number.isInteger(input.amountCents) || input.amountCents < 2400) {
    throw new Error("Invoice too small.");
  }
  const sourceAmount = (input.amountCents / 100).toFixed(2);
  const url = new URL(PLISIO);
  url.searchParams.set("api_key", secret());
  url.searchParams.set("source_currency", "USD");
  url.searchParams.set("source_amount", sourceAmount);
  url.searchParams.set("currency", coin.id);
  url.searchParams.set("allowed_psys_cids", coin.id);
  url.searchParams.set("order_name", input.orderName.slice(0, 80));
  url.searchParams.set("order_number", input.orderNumber);
  url.searchParams.set("description", input.orderName.slice(0, 160));
  url.searchParams.set("callback_url", input.callbackUrl);
  url.searchParams.set("expire_min", "60");
  url.searchParams.set("email", "desk@localhost");

  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  const body = (await res.json()) as {
    status?: string;
    data?: {
      txn_id?: string;
      invoice_url?: string;
      wallet_hash?: string;
      qr_code?: string;
      amount?: string;
      currency?: string;
      expire_utc?: number;
    };
    message?: string;
  };
  const data = body.data;
  if (!res.ok || body.status !== "success" || !data?.txn_id || !data.invoice_url) {
    throw new Error(body.message || "Plisio did not open an invoice.");
  }
  return {
    txnId: data.txn_id,
    invoiceUrl: data.invoice_url,
    walletHash: data.wallet_hash || null,
    qrCode: data.qr_code || null,
    amountCrypto: data.amount || null,
    currency: data.currency || coin.id,
    expireUtc: typeof data.expire_utc === "number" ? data.expire_utc : null,
  };
}

export function fiatCentsFromPlisio(payload: Record<string, unknown>): number {
  const raw = payload.source_amount ?? payload.invoice_total_sum ?? payload.amount;
  const n = typeof raw === "number" ? raw : Number(String(raw ?? ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function plisioOrderNumber(payload: Record<string, unknown>): string | null {
  const n = payload.order_number;
  return typeof n === "string" && n.startsWith("inv_") ? n : null;
}

export function plisioTxnId(payload: Record<string, unknown>): string | null {
  const n = payload.txn_id;
  return typeof n === "string" && n.length > 4 ? n : null;
}
