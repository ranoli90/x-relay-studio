import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixtureKickUrl, initialKickIndex, OWNER_KICKS } from "./kick-steps.ts";

describe("owner kick steps", () => {
  it("starts on the security check unless wait copy names a later gate", () => {
    assert.equal(initialKickIndex(null), 0);
    assert.equal(initialKickIndex("Complete the security check yourself. We will not solve it."), 0);
    assert.equal(initialKickIndex("Read and accept the terms yourself."), 1);
    assert.equal(initialKickIndex("Submit the account form yourself. We will not click Create."), 2);
  });

  it("points the practice page at the real control for that step", () => {
    assert.equal(OWNER_KICKS.length, 3);
    const url = fixtureKickUrl({ username: "relayabcd1234", step: "captcha" });
    assert.match(url, /\/__reddit-onboarding-fixture\/index.html\?/);
    assert.match(url, /kick=captcha/);
    assert.match(url, /username=relayabcd1234/);
  });
});
