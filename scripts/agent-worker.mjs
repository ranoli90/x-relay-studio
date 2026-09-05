#!/usr/bin/env node
/**
 * Sandbox / long-running host companion for `/api/cron/studio`.
 *
 * When `CRON_SECRET` is set, poll the local cron route every 20s with Bearer
 * auth. When it is unset, do not invent an unauthenticated bypass — wait until
 * the app is up, then exit: the in-process loop started by telegram me/status
 * (and by the cron handler itself) covers ticks.
 */
const STUDIO = "http://127.0.0.1:8080/api/cron/studio";
const ORIGIN = "http://127.0.0.1:8080/";
const INTERVAL_MS = 20_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  let n = 0;
  for (;;) {
    try {
      const res = await fetch(ORIGIN, {
        redirect: "manual",
        signal: AbortSignal.timeout(2500),
      });
      if (res.status > 0) return;
    } catch {
      n += 1;
      if (n === 1 || n % 10 === 0) {
        console.info("[agent-worker] waiting for 127.0.0.1:8080");
      }
    }
    await sleep(1000);
  }
}

async function tick(secret) {
  const res = await fetch(STUDIO, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401) {
    console.info("[agent-worker] cron unauthorized");
    return;
  }
  if (!res.ok) {
    console.info("[agent-worker] tick failed", res.status);
  }
}

async function main() {
  await waitForServer();
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // In-process loop on the server covers ticks when CRON_SECRET is unset.
    console.info("[agent-worker] CRON_SECRET unset; in-process server loop covers ticks");
    process.exit(0);
  }
  console.info("[agent-worker] ticking /api/cron/studio every 20s");
  for (;;) {
    try {
      await tick(secret);
    } catch {
      console.info("[agent-worker] tick failed");
    }
    await sleep(INTERVAL_MS);
  }
}

main().catch(() => {
  process.exit(1);
});
