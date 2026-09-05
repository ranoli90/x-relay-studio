import { createFileRoute } from "@tanstack/react-router";
import { applyPaidWebhook } from "@/lib/billing/ledger.server";
import {
  fiatCentsFromPlisio,
  parsePlisioCallbackBody,
  plisioOrderNumber,
  plisioTxnId,
} from "@/lib/billing/plisio";
import { plisioCallbackHttpStatus, plisioCallbackValid } from "@/lib/billing/verify";

export const Route = createFileRoute("/api/payments/plisio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PLISIO_SECRET?.trim();
        if (!secret) {
          return Response.json({ ok: false, error: "unconfigured" }, { status: 503 });
        }
        const raw = await request.text();
        if (raw.length > 64_000) {
          return Response.json({ ok: false, error: "too_large" }, { status: 413 });
        }
        const payload = parsePlisioCallbackBody(raw);
        if (!payload) {
          return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
        }
        const signatureOk = plisioCallbackValid(secret, payload);
        const status = String(payload.status ?? payload.txn_status ?? "");
        const invoiceId = plisioOrderNumber(payload);
        const externalId = plisioTxnId(payload) ?? "missing";
        const paidAmountCents = fiatCentsFromPlisio(payload);
        try {
          const result = await applyPaidWebhook({
            raw,
            payload,
            signatureOk,
            status,
            invoiceId,
            externalId,
            paidAmountCents,
          });
          return Response.json(
            {
              ok: result.ok,
              minted: result.minted,
              replay: result.replay ?? false,
              reason: result.reason,
            },
            { status: plisioCallbackHttpStatus(result) },
          );
        } catch {
          return Response.json({ ok: false, error: "unavailable" }, { status: 500 });
        }
      },
    },
  },
});
