#!/usr/bin/env node
/**
 * Hit a live deployment and fail if the app shell or legal pages are gone.
 * Usage: node scripts/deploy-smoke.mjs https://x-relay-studio-puce.vercel.app
 */
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");
 if (!base) {
  console.error("usage: node scripts/deploy-smoke.mjs <origin>");
  process.exit(2);
}

const paths = ["/", "/privacy", "/terms", "/status", "/robots.txt"];

const results = [];
for (const path of paths) {
  const url = `${base}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", headers: { accept: "text/html,text/plain,*/*" } });
    results.push({ path, status: res.status, ms: Date.now() - started, ok: res.ok });
  } catch (err) {
    results.push({ path, status: 0, ms: Date.now() - started, ok: false, error: String(err) });
  }
}

const failed = results.filter((r) => !r.ok);
for (const row of results) {
  console.log(`${row.ok ? "ok" : "FAIL"} ${row.status} ${row.path} ${row.ms}ms${row.error ? ` ${row.error}` : ""}`);
}
if (failed.length) {
  process.exit(1);
}
