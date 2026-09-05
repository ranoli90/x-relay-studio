import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptPaid,
  decodePlisioTxUrls,
  plisioCallbackHttpStatus,
  plisioCallbackValid,
  plisioJsonSignature,
  plisioSignature,
} from "./verify.ts";
import { fiatCentsFromPlisio, parsePlisioCallbackBody, plisioOrderNumber } from "./plisio.ts";

const base = {
  signatureOk: true,
  status: "completed",
  invoiceAmountCents: 2900,
  paidAmountCents: 2900,
  alreadyMinted: false,
  deskUserId: "desk_a",
  expired: false,
};

describe("plisioCallbackValid", () => {
  it("accepts a matching PHP-serialize hash and rejects a forged one", () => {
    const secret = "test-plisio-secret";
    const payload: Record<string, unknown> = {
      status: "completed",
      order_number: "inv_aaaaaaaaaaaaaaaa",
      txn_id: "txn12345",
      source_amount: "29.00",
    };
    payload.verify_hash = plisioSignature(secret, payload);
    assert.equal(plisioCallbackValid(secret, payload), true);
    assert.equal(plisioCallbackValid(secret, { ...payload, verify_hash: "deadbeef" }), false);
    assert.equal(plisioCallbackValid("", payload), false);
  });

  it("accepts a matching JSON callback hash", () => {
    const secret = "test-plisio-secret";
    const payload: Record<string, unknown> = {
      order_number: "inv_bbbbbbbbbbbbbbbb",
      status: "completed",
      txn_id: "txn99999",
    };
    payload.verify_hash = plisioJsonSignature(secret, payload);
    assert.equal(plisioCallbackValid(secret, payload), true);
  });

  it("decodes tx_urls HTML entities before hashing", () => {
    const secret = "test-plisio-secret";
    const decoded = "https://etherscan.io/tx/0xabc?a=1&b=2";
    const encoded = "https://etherscan.io/tx/0xabc?a=1&b=2";
    assert.equal(decodePlisioTxUrls(encoded), decoded);
    const signed: Record<string, unknown> = {
      status: "completed",
      order_number: "inv_cccccccccccccccc",
      tx_urls: decoded,
    };
    signed.verify_hash = plisioSignature(secret, signed);
    const wire = { ...signed, tx_urls: encoded };
    assert.equal(plisioCallbackValid(secret, wire), true);
    const jsonSigned: Record<string, unknown> = {
      status: "completed",
      order_number: "inv_cccccccccccccccc",
      tx_urls: decoded,
    };
    jsonSigned.verify_hash = plisioJsonSignature(secret, jsonSigned);
    assert.equal(plisioCallbackValid(secret, { ...jsonSigned, tx_urls: encoded }), true);
  });
});

describe("acceptPaid", () => {
  it("never accepts a bad signature", () => {
    const v = acceptPaid({ ...base, signatureOk: false });
    assert.equal(v.accept, false);
    if (!v.accept) assert.equal(v.reason, "bad_signature");
  });

  it("marks underpay and expired without accepting", () => {
    const under = acceptPaid({ ...base, paidAmountCents: 1000, status: "mismatch" });
    assert.equal(under.accept, false);
    if (!under.accept) assert.equal(under.reason, "underpay");
    const late = acceptPaid({ ...base, expired: true, status: "completed" });
    assert.equal(late.accept, false);
    if (!late.accept) assert.equal(late.reason, "expired");
  });

  it("completed with the invoice amount accepts; already minted is replay", () => {
    const ok = acceptPaid(base);
    assert.equal(ok.accept, true);
    if (ok.accept) assert.equal(ok.replay, false);
    const replay = acceptPaid({ ...base, alreadyMinted: true });
    assert.equal(replay.accept, true);
    if (replay.accept) assert.equal(replay.replay, true);
  });

  it("unbound and pending do not look like paid", () => {
    const unbound = acceptPaid({ ...base, deskUserId: null });
    assert.equal(unbound.accept, false);
    if (!unbound.accept) assert.equal(unbound.reason, "unbound");
    const pending = acceptPaid({ ...base, status: "pending" });
    assert.equal(pending.accept, false);
    if (!pending.accept) assert.equal(pending.reason, "bad_status");
  });

  it("error and unknown statuses are uncertain, not paid", () => {
    const error = acceptPaid({ ...base, status: "error" });
    assert.equal(error.accept, false);
    if (!error.accept) assert.equal(error.reason, "uncertain");
    const unknown = acceptPaid({ ...base, status: "maybe" });
    assert.equal(unknown.accept, false);
    if (!unknown.accept) assert.equal(unknown.reason, "uncertain");
  });

  it("mismatch with a full amount is treated as paid (overpay)", () => {
    const over = acceptPaid({ ...base, status: "mismatch", paidAmountCents: 3000 });
    assert.equal(over.accept, true);
  });
});

describe("plisio bind", () => {
  it("binds invoices only via inv_ order_number and ignores crypto amount as fiat", () => {
    assert.equal(plisioOrderNumber({ order_number: "inv_aaaaaaaaaaaaaaaa" }), "inv_aaaaaaaaaaaaaaaa");
    assert.equal(plisioOrderNumber({ order_number: "other" }), null);
    assert.equal(fiatCentsFromPlisio({ source_amount: "29.00" }), 2900);
    assert.equal(fiatCentsFromPlisio({ amount: "29" }), 0);
  });

  it("parses JSON and form-encoded callback bodies", () => {
    assert.deepEqual(parsePlisioCallbackBody('{"status":"completed"}'), { status: "completed" });
    const form = parsePlisioCallbackBody("status=completed&order_number=inv_aaaaaaaaaaaaaaaa");
    assert.equal(form?.status, "completed");
    assert.equal(form?.order_number, "inv_aaaaaaaaaaaaaaaa");
    assert.equal(parsePlisioCallbackBody("not-json"), null);
  });
});

describe("plisioCallbackHttpStatus", () => {
  it("returns 200 for paid and replay, 400 for permanent rejects, 5xx otherwise", () => {
    assert.equal(plisioCallbackHttpStatus({ ok: true, minted: 250 }), 200);
    assert.equal(plisioCallbackHttpStatus({ ok: true, minted: 0, replay: true, reason: "replay" }), 200);
    assert.equal(plisioCallbackHttpStatus({ ok: false, reason: "underpay" }), 400);
    assert.equal(plisioCallbackHttpStatus({ ok: false, reason: "expired" }), 400);
    assert.equal(plisioCallbackHttpStatus({ ok: false, reason: "bad_signature" }), 400);
    assert.equal(plisioCallbackHttpStatus({ ok: false, reason: "uncertain" }), 400);
    assert.equal(plisioCallbackHttpStatus({ ok: false, reason: "db" }), 500);
    assert.equal(plisioCallbackHttpStatus({ ok: false }), 500);
  });
});
