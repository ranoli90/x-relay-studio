/**
 * Plain Node worker. Production must set DATABASE_URL and never applies DDL.
 * Preview without DATABASE_URL is a no-op: the web process drains the fake provider.
 */
import pg from "pg";
import { drainOnce } from "../lib/reddit/onboarding/worker-core.ts";
import { selectProvider } from "../lib/reddit/onboarding/worker-core.ts";
import { environmentId, redditAssistedSignupEnabled, redditBrowserProvider } from "../lib/reddit/onboarding/config.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();
const workerId = `reddit-onboarding-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;

if (!databaseUrl) {
  console.log("[reddit-onboarding-worker] DATABASE_URL unset — not claiming work.");
  process.exit(0);
}

if (environmentId() === "production" && redditAssistedSignupEnabled() && redditBrowserProvider() === "fake") {
  console.error("[reddit-onboarding-worker] fake provider cannot run assisted signup in production.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const sql = {
  query: async <T>(text: string, params: unknown[] = []) => {
    const res = await pool.query(text, params);
    return res.rows as T[];
  },
};

let draining = false;
async function shutdown() {
  draining = true;
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

const provider = selectProvider();
console.log(`[reddit-onboarding-worker] ${workerId} provider=${provider.name}`);

while (!draining) {
  try {
    const { didWork } = await drainOnce(sql, workerId, provider);
    await new Promise((r) => setTimeout(r, didWork ? 250 : 1500));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reddit-onboarding-worker]", message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
