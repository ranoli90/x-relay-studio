import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHealthReport } from "./health.ts";
import { threadMessages } from "./thread.ts";
import type { RedditMessage } from "./types.ts";

describe("buildHealthReport", () => {
  it("flags shadowban and unverified email but still allows read-only inbox", () => {
    const report = buildHealthReport({
      me: {
        name: "test",
        created_utc: Date.now() / 1000 - 400 * 86400,
        comment_karma: 200,
        total_karma: 200,
        has_verified_email: false,
        is_suspended: false,
      },
      rateRemaining: 80,
      publicProfile: "hidden",
    });
    assert.equal(report.postingLocked, true);
    assert.equal(report.okToUse, true);
    assert.equal(report.checks.find((c) => c.id === "visible")?.status, "fail");
    assert.equal(report.checks.find((c) => c.id === "email")?.status, "fail");
  });

  it("passes a healthy established account", () => {
    const report = buildHealthReport({
      me: {
        name: "test",
        created_utc: Date.now() / 1000 - 400 * 86400,
        comment_karma: 200,
        total_karma: 200,
        has_verified_email: true,
        is_suspended: false,
      },
      rateRemaining: 80,
      publicProfile: "visible",
    });
    assert.equal(report.okToUse, true);
  });

  it("blocks inbox when the API identity fails", () => {
    const report = buildHealthReport({
      me: null,
      apiError: "401",
      rateRemaining: null,
      publicProfile: "unknown",
    });
    assert.equal(report.okToUse, false);
  });
});

describe("threadMessages", () => {
  it("groups by thread and sorts unread first", () => {
    const msgs: RedditMessage[] = [
      {
        id: "1",
        fullname: "t4_1",
        kind: "message",
        author: "a",
        dest: "me",
        subject: "old",
        body: "x",
        createdUtc: 1,
        isNew: false,
        wasComment: false,
        threadId: "t4_1",
        subreddit: null,
        context: null,
      },
      {
        id: "2",
        fullname: "t4_2",
        kind: "message",
        author: "b",
        dest: "me",
        subject: "new",
        body: "y",
        createdUtc: 2,
        isNew: true,
        wasComment: false,
        threadId: "t4_2",
        subreddit: null,
        context: null,
      },
    ];
    const threads = threadMessages(msgs);
    assert.equal(threads[0].subject, "new");
    assert.equal(threads[0].unread, 1);
  });
});
