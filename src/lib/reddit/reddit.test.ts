import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, decodeAmp } from "./html.ts";
import { isPlausibleOrigin, redirectUriFromOrigin } from "./origin.ts";
import { asMessage, redditPermalink } from "./parse.ts";
import {
  appIdForDesk,
  appNameForDesk,
  apiSignupBlurb,
  assertSafeAppName,
  userAgentFor,
} from "./naming.ts";
import { REDDIT_SCOPES } from "./types.ts";

describe("app naming", () => {
  it("is unique per desk and never includes reddit", () => {
    const a = appNameForDesk("1554477288539986");
    const b = appNameForDesk("9999000011112222");
    assert.notEqual(a, b);
    assert.equal(/\breddit\b/i.test(a), false);
    assert.equal(/\breddit\b/i.test(appIdForDesk("1554477288539986")), false);
    assert.throws(() => assertSafeAppName("Reddit Relay"));
    const ua = userAgentFor("alice", appIdForDesk("1554477288539986"));
    assert.match(ua, /^web:desk\.1554\.9986:v1\.0\.0 \(by \/u\/alice\)$/);
    assert.equal(/\breddit\b/i.test(ua), false);
    assert.match(apiSignupBlurb("1554477288539986"), /warmed-up/);
    assert.match(apiSignupBlurb("1554477288539986"), /not a moderator/i);
  });
});

describe("oauth safety", () => {
  it("does not request write scopes", () => {
    assert.equal(REDDIT_SCOPES.includes("submit"), false);
    assert.equal(REDDIT_SCOPES.includes("edit"), false);
    assert.equal(REDDIT_SCOPES.includes("vote"), false);
    assert.match(REDDIT_SCOPES, /identity/);
    assert.match(REDDIT_SCOPES, /privatemessages/);
  });

  it("builds redirect uri without a trailing slash trap", () => {
    assert.equal(
      redirectUriFromOrigin("https://app.example.com/"),
      "https://app.example.com/api/reddit/oauth/callback",
    );
    assert.equal(isPlausibleOrigin("javascript:alert(1)"), false);
    assert.equal(isPlausibleOrigin("https://ok.example"), true);
  });
});

describe("html", () => {
  it("escapes callback copy and decodes reddit icon urls", () => {
    const escaped = escapeHtml('<img src="x">');
    assert.equal(escaped.includes("<"), false);
    assert.equal(escaped.includes(">"), false);
    assert.equal(escaped.startsWith("&"), true);
    assert.equal(decodeAmp("https://i.redd.it/a.png&" + "amp;s=1"), "https://i.redd.it/a.png&s=1");
  });
});

describe("inbox parse", () => {
  it("threads comments and builds permalinks", () => {
    const msg = asMessage({
      kind: "t1",
      data: {
        id: "c1",
        name: "t1_c1",
        author: "bob",
        dest: "me",
        body: "hi",
        created_utc: 10,
        new: true,
        was_comment: true,
        subreddit: "test",
        context: "/r/test/comments/abc/t/",
      },
    });
    assert.equal(msg?.kind, "comment");
    assert.equal(msg?.isNew, true);
    assert.equal(redditPermalink(msg?.context ?? null), "https://www.reddit.com/r/test/comments/abc/t/");
  });
});
