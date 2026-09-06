import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyInboundAiStatus,
  floodSecondsLeft,
  floodWaitLabel,
  retryBackoffMs,
  watchIsLocked,
  watchTerminal,
  watchTerminalLabel,
} from "./watch-status.ts";

describe("watch-status", () => {
  it("treats past floodUntil as unlocked", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    assert.equal(floodSecondsLeft("2000-01-01T00:00:00.000Z", now), 0);
    assert.equal(watchIsLocked({ floodUntil: "2000-01-01T00:00:00.000Z", authDead: false }, now), false);
  });

  it("locks on authDead or future floodUntil", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    assert.equal(watchIsLocked({ authDead: true }, now), true);
    assert.equal(floodWaitLabel("2026-01-01T00:02:00.000Z", now), "2 min");
    assert.equal(watchIsLocked({ floodUntil: "2026-01-01T00:02:00.000Z" }, now), true);
  });

  it("persists distinct revoked / flood / dead terminals", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    assert.equal(watchTerminal({ authDead: true, lastError: "Telegram revoked this session." }, now), "revoked");
    assert.equal(watchTerminal({ authDead: true, lastError: "Telegram signed this desk out." }, now), "dead");
    assert.equal(watchTerminal({ floodUntil: "2026-01-01T00:02:00.000Z" }, now), "flood");
    assert.match(watchTerminalLabel("revoked") ?? "", /revoked/i);
    assert.match(watchTerminalLabel("dead") ?? "", /signed this desk out/i);
    assert.match(watchTerminalLabel("flood") ?? "", /wait/i);
  });
});

describe("XR-012 historical import vs live ingress", () => {
  it("bootstrap without a watermark is imported, not queued", () => {
    assert.equal(classifyInboundAiStatus({ fromSelf: false, createdAt: "2026-01-01T00:00:00Z" }), "imported");
    assert.equal(classifyInboundAiStatus({ fromSelf: true, createdAt: "2026-01-01T00:00:00Z" }), "outbound");
  });

  it("messages at or before the watermark stay imported; later ones queue", () => {
    const watermark = "2026-09-01T12:00:00.000Z";
    assert.equal(
      classifyInboundAiStatus({ fromSelf: false, createdAt: "2026-09-01T12:00:00.000Z", watermark }),
      "imported",
    );
    assert.equal(
      classifyInboundAiStatus({ fromSelf: false, createdAt: "2026-08-01T00:00:00.000Z", watermark }),
      "imported",
    );
    assert.equal(
      classifyInboundAiStatus({ fromSelf: false, createdAt: "2026-09-01T12:00:01.000Z", watermark }),
      "queued",
    );
  });

  it("retry backoff is bounded", () => {
    assert.equal(retryBackoffMs(1), 15_000);
    assert.ok(retryBackoffMs(8) <= 15 * 60_000);
  });
});
