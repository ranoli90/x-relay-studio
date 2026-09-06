#!/usr/bin/env node
/**
 * Real Chromium proof that Automate is one click on the isolated Reddit page.
 * Spins a dedicated Vite with auth off (dev-user). Does not hit reddit.com.
 * Fails if the owner kick board appears, if connection is not verified, or if
 * a second account still asks the owner to tap anything.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.REDDIT_E2E_PORT || 8091);
const BASE = `http://127.0.0.1:${PORT}`;

function waitFor(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (res.ok || res.status === 200) {
          resolve();
          return;
        }
      } catch {
        /* still booting */
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Preview at ${url} did not become ready.`));
        return;
      }
      setTimeout(tick, 400);
    };
    void tick();
  });
}

function startPreview() {
  const child = spawn(
    "node",
    ["scripts/with-app-env.mjs", join(ROOT, "node_modules/.bin/vite"), "dev", "--host", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        VITE_AUTH_ENABLED: "false",
        REDDIT_ONBOARDING_ENABLED: "true",
        REDDIT_ASSISTED_SIGNUP_ENABLED: "true",
        REDDIT_ONBOARDING_FIXTURE: "true",
        REDDIT_BROWSER_PROVIDER: "fake",
        REDDIT_DRAFTING_ENABLED: "true",
        REDDIT_EMAIL_BINDING_ENABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    log += String(chunk);
  });
  child.log = () => log;
  return child;
}

async function dump(page, err) {
  const text = await page.locator("body").innerText().catch(() => "");
  const html = await page.content().catch(() => "");
  return `${err instanceof Error ? err.stack || err.message : err}\nurl=${page.url()}\ntext=\n${text}\nhtml-len=${html.length}`;
}

async function assertNoOwnerKicks(page) {
  const blocked = page.locator("#accept-terms, #final-submit, #captcha-pass, [data-testid='kick-board']");
  if (await blocked.count()) {
    const visible = [];
    for (const loc of await blocked.all()) {
      if (await loc.isVisible().catch(() => false)) visible.push(await loc.getAttribute("id") || await loc.getAttribute("data-testid"));
    }
    if (visible.length) {
      throw new Error(`Owner kick controls were shown; Automate must finish without them. Saw: ${visible.join(", ")}`);
    }
  }
  const overlay = await page.locator("body").innerText();
  if (/async_hooks|AsyncLocalStorage|Something went wrong/i.test(overlay) && !/What is actually done/i.test(overlay)) {
    throw new Error(`Page crashed before Automate could run.\n${overlay.slice(0, 1500)}`);
  }
}

async function clickAutomateAndWait(page) {
  const automate = page.locator("#mode-assisted");
  try {
    await automate.waitFor({ state: "visible", timeout: 30_000 });
  } catch (err) {
    throw new Error(await dump(page, err));
  }
  await assertNoOwnerKicks(page);
  await automate.click();
  const result = page.locator("[data-testid='onboarding-result']");
  try {
    await result.waitFor({ state: "visible", timeout: 45_000 });
  } catch (err) {
    throw new Error(await dump(page, err));
  }
  await assertNoOwnerKicks(page);
  const body = await result.innerText();
  if (!/What is actually done/i.test(body)) {
    throw new Error(`Result heading missing. Saw:\n${body}`);
  }
  const name = body.match(/u\/relay[0-9a-f]+/i)?.[0];
  if (!name) {
    throw new Error(`Practice username missing. Saw:\n${body}`);
  }
  const connection = page.locator("[data-testid='result-connection-verified']");
  await connection.waitFor({ state: "visible" });
  const connectionText = await connection.innerText();
  if (!/\byes\b/i.test(connectionText)) {
    throw new Error(`Connection was not verified. Saw:\n${connectionText}`);
  }
  return name;
}

async function main() {
  const preview = startPreview();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    try {
      await waitFor(`${BASE}/`, 60_000);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : err}\n--- vite ---\n${preview.log()}`);
    }
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(`${BASE}/reddit`, { waitUntil: "domcontentloaded" });
    const first = await clickAutomateAndWait(page);
    await page.getByRole("button", { name: /Open Reddit dashboard/i }).click();
    await page.getByRole("button", { name: /^Add$/i }).waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("button", { name: /^Add$/i }).click();
    const second = await clickAutomateAndWait(page);
    if (pageErrors.some((e) => /async_hooks|AsyncLocalStorage/i.test(e))) {
      throw new Error(`Client bundle still pulled Node async_hooks:\n${pageErrors.join("\n")}`);
    }
    if (first.toLowerCase() === second.toLowerCase()) {
      throw new Error(`Second Automate reused ${first} instead of creating another practice account.`);
    }
    console.log("ok: automate created", first, "then", second);
  } finally {
    await browser.close().catch(() => undefined);
    preview.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    try {
      preview.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
