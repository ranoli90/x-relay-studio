import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  archiveIsPartial,
  archiveScope,
  fairSelect,
  mapOutboxStatus,
  pickOwnPhoto,
  studioTickGate,
} from "./integrity.ts";

const KEYS = [
  "STUDIO_TICK_ENABLED",
  "OPENROUTER_ENABLED",
  "OPENROUTER_API_KEY",
  "FXTWITTER_ENABLED",
  "VERCEL",
  "NODE_ENV",
] as const;

const snapshot: Record<string, string | undefined> = {};
for (const key of KEYS) snapshot[key] = process.env[key];

afterEach(() => {
  for (const key of KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("XR-046 archive scope", () => {
  it("labels an incomplete backfill as partial", () => {
    assert.equal(
      archiveScope({ tweetsClaimed: 100, tweetsSynced: 12, backfillDone: false, status: "syncing" }),
      "partial",
    );
    assert.equal(
      archiveIsPartial({ tweetsClaimed: 100, tweetsSynced: 12, backfillDone: false, status: "syncing" }),
      true,
    );
  });

  it("labels a short archive against the claimed count as partial", () => {
    assert.equal(
      archiveScope({ tweetsClaimed: 80, tweetsSynced: 40, backfillDone: true, status: "ready" }),
      "partial",
    );
  });

  it("labels a finished matching archive as complete", () => {
    assert.equal(
      archiveScope({ tweetsClaimed: 12, tweetsSynced: 12, backfillDone: true, status: "ready" }),
      "complete",
    );
  });
});

describe("XR-046 own media only", () => {
  it("returns the post's own photo and never a neighbor", () => {
    const own = pickOwnPhoto([
      { type: "video", url: "https://cdn.example/v.mp4" },
      { type: "photo", url: "https://cdn.example/this.jpg" },
    ]);
    assert.equal(own, "https://cdn.example/this.jpg");
  });

  it("does not invent a substitute when the post has no photo", () => {
    assert.equal(pickOwnPhoto([]), null);
    assert.equal(pickOwnPhoto([{ type: "video", url: "https://cdn.example/v.mp4" }]), null);
    assert.equal(pickOwnPhoto(null), null);
  });
});

describe("XR-047 tenant fairness", () => {
  it("does not let one tenant take the whole tick", () => {
    const rows = [
      { user_id: "desk_a", id: "a1" },
      { user_id: "desk_a", id: "a2" },
      { user_id: "desk_a", id: "a3" },
      { user_id: "desk_b", id: "b1" },
    ];
    assert.deepEqual(
      fairSelect(rows, 2).map((r) => r.id),
      ["a1", "b1"],
    );
  });
});

describe("XR-056 truthful outbox status", () => {
  it("never promotes unknown or queued rows to sent", () => {
    assert.equal(mapOutboxStatus("due"), "due");
    assert.equal(mapOutboxStatus("queued"), "due");
    assert.equal(mapOutboxStatus("posted"), "due");
    assert.equal(mapOutboxStatus(""), "due");
    assert.equal(mapOutboxStatus("sent"), "sent");
    assert.equal(mapOutboxStatus("skipped"), "skipped");
  });
});

describe("XR-045/flags studio tick gate", () => {
  it("hold flag stops the tick before external callers", () => {
    process.env.STUDIO_TICK_ENABLED = "false";
    const gate = studioTickGate({ openRouter: true, xLookup: true });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.reason, "studio");
  });

  it("openrouter kill switch stops search/rewrite callers", () => {
    delete process.env.STUDIO_TICK_ENABLED;
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_ENABLED = "false";
    const gate = studioTickGate({ openRouter: true });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.reason, "openrouter");
  });

  it("unofficial X lookup kill switch stops fxtwitter callers", () => {
    delete process.env.STUDIO_TICK_ENABLED;
    process.env.FXTWITTER_ENABLED = "off";
    const gate = studioTickGate({ xLookup: true });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.reason, "x-lookup");
  });
});
