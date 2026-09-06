#!/usr/bin/env node
/**
 * Dry-run inventory of Reddit credential envelope versions.
 *
 * Prints a JSON summary of counts by envelope prefix / part count / length
 * bucket. NEVER prints secret values, ciphertext, or the first segment of a
 * non-envelope blob (that segment may be the secret).
 *
 * Always dry-run. Always exit 0 so operators can capture the summary even
 * when reconnect work remains. Fail-closed decrypt is unchanged.
 *
 *   node scripts/reddit-credential-inventory.mjs
 *
 * Uses DATABASE_URL. Does not write. Does not decrypt.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 0);
}

const {
  emptyInventorySummary,
  inventoryFromQuery,
  summaryLooksSafe,
} = await import("../src/lib/reddit/onboarding/credential-inventory.ts");

const databaseUrl = process.env.DATABASE_URL?.trim();

function print(summary) {
  if (!summaryLooksSafe(summary)) {
    const safe = emptyInventorySummary(
      "refusing to print a summary that looks like it contains a secret",
      true,
    );
    process.stdout.write(`${JSON.stringify(safe)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function main() {
  if (!databaseUrl) {
    print(emptyInventorySummary("DATABASE_URL unset", true));
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const summary = await inventoryFromQuery(async (text) => {
      const res = await pool.query(text);
      return res.rows;
    });
    print(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    print(emptyInventorySummary(`inventory query failed: ${message.split("\n")[0]}`, true));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await main();
process.exit(0);
