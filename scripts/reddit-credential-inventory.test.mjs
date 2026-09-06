import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/reddit-credential-inventory.mjs");

describe("reddit credential inventory CLI", () => {
  it("exits 0 with a dry-run JSON summary and never prints secret values", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || "expected exit 0");
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.dryRun, true);
    assert.equal(summary.skipped, true);
    assert.equal(summary.reason, "DATABASE_URL unset");
    assert.equal(/\bv[12]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(result.stdout), false);
    assert.equal(result.stdout.includes("legacy-refresh-token-value"), false);
  });
});
