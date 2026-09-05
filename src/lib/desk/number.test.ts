import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deskEmail,
  formatDeskNumber,
  isDeskNumber,
  normalizeDeskNumber,
} from "./number.ts";

describe("desk number", () => {
  it("strips spaces and checks length", () => {
    assert.equal(normalizeDeskNumber("4821 9033 1170 6642"), "4821903311706642");
    assert.equal(isDeskNumber("4821 9033 1170 6642"), true);
    assert.equal(isDeskNumber("123"), false);
  });

  it("formats in groups of four", () => {
    assert.equal(formatDeskNumber("4821903311706642"), "4821 9033 1170 6642");
  });

  it("builds a non-personal email", () => {
    assert.equal(deskEmail("4821903311706642"), "d4821903311706642@example.com");
  });
});
