import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { archiveWindowPartial, filterArchiveWindow, tweetBelongsTo, tweetInWindow } from "./archive.ts";
import type { Tweet } from "./types.ts";

function tweet(partial: Partial<Tweet> & { id: string; handle?: string }): Tweet {
  return {
    id: partial.id,
    url: partial.url ?? `https://x.com/${partial.handle ?? "naval"}/status/${partial.id}`,
    text: partial.text ?? "hello",
    createdAt: partial.createdAt,
    author: {
      id: "",
      handle: partial.handle ?? partial.author?.handle ?? "naval",
      name: partial.handle ?? "naval",
      verified: false,
    },
    metrics: {},
    mediaItems: partial.mediaItems,
  };
}

describe("XR-046 archive window scope", () => {
  it("drops other accounts instead of mixing them into the archive", () => {
    const { tweets, partial, stats } = filterArchiveWindow(
      [
        tweet({ id: "1", handle: "naval", createdAt: "2024-01-02T00:00:00.000Z" }),
        tweet({ id: "2", handle: "someoneelse", createdAt: "2024-01-01T00:00:00.000Z" }),
      ],
      "naval",
      { until: "2024-01-10" },
    );
    assert.deepEqual(
      tweets.map((t) => t.id),
      ["1"],
    );
    assert.equal(stats.droppedWrongAccount, 1);
    assert.equal(partial, true);
  });

  it("drops posts outside the requested window", () => {
    assert.equal(
      tweetInWindow({ createdAt: "2024-02-01T00:00:00.000Z" }, { until: "2024-02-01" }),
      false,
    );
    const { tweets, stats } = filterArchiveWindow(
      [
        tweet({ id: "new", handle: "naval", createdAt: "2024-03-01T00:00:00.000Z" }),
        tweet({ id: "old", handle: "naval", createdAt: "2024-01-15T00:00:00.000Z" }),
      ],
      "naval",
      { since: "2024-01-01", until: "2024-02-01" },
    );
    assert.deepEqual(
      tweets.map((t) => t.id),
      ["old"],
    );
    assert.equal(stats.droppedOutOfWindow, 1);
  });

  it("labels damaged or offline slices as partial; a clean empty window is not", () => {
    assert.equal(archiveWindowPartial({ live: true, kept: 0, droppedWrongAccount: 0, droppedOutOfWindow: 0, undated: 0 }), false);
    assert.equal(archiveWindowPartial({ live: false, kept: 4, droppedWrongAccount: 0, droppedOutOfWindow: 0, undated: 0 }), true);
    assert.equal(archiveWindowPartial({ live: true, kept: 4, droppedWrongAccount: 0, droppedOutOfWindow: 0, undated: 1 }), true);
    assert.equal(archiveWindowPartial({ live: true, kept: 4, droppedWrongAccount: 0, droppedOutOfWindow: 0, undated: 0 }), false);
  });

  it("does not claim a tweet from a different handle via url mismatch", () => {
    assert.equal(tweetBelongsTo(tweet({ id: "9", handle: "paulg" }), "naval"), false);
    assert.equal(tweetBelongsTo(tweet({ id: "9", handle: "naval" }), "naval"), true);
  });
});
