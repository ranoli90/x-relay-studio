import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DESK_STARTING, publicDeskError } from "./public-error.ts";

describe("publicDeskError", () => {
  it("hides schema-behind operator copy", () => {
    assert.equal(
      publicDeskError(
        new Error(
          "Schema is behind (0027_reddit_onboarding.sql not applied). Run npm run db:migrate with a release credential.",
        ),
      ),
      DESK_STARTING,
    );
  });

  it("hides missing _migrations copy", () => {
    assert.equal(
      publicDeskError(new Error("Schema is missing _migrations. Run npm run db:migrate before serving traffic.")),
      DESK_STARTING,
    );
  });

  it("keeps ordinary desk errors", () => {
    assert.equal(publicDeskError(new Error("A desk number is 16 digits.")), "A desk number is 16 digits.");
    assert.equal(publicDeskError(new Error("That desk number is already taken. Open a new desk instead.")), "That desk number is already taken. Open a new desk instead.");
  });

  it("falls back when the error is empty", () => {
    assert.equal(publicDeskError(null), "Could not open a desk.");
    assert.equal(publicDeskError({}, "Could not return."), "Could not return.");
  });
});
