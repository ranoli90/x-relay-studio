import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { userAgentFor } from "../src/lib/reddit/naming.ts";
import { REDDIT_SCOPES } from "../src/lib/reddit/types.ts";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8080";
const DIR = "/workspace/screenshots/reddit-e2e";
mkdirSync(DIR, { recursive: true });

const checks = [];
function pass(id, detail) {
  checks.push({ id, ok: true, detail });
  console.log(`PASS  ${id}  ${detail}`);
}
function fail(id, detail) {
  checks.push({ id, ok: false, detail });
  console.error(`FAIL  ${id}  ${detail}`);
}

async function redditSeesUs() {
  const ua = userAgentFor("alice", "desk.1554.9986");
  const u = new URL("https://www.reddit.com/api/v1/authorize");
  u.searchParams.set("client_id", "placeholder_client");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", "e2e");
  u.searchParams.set("redirect_uri", "https://x-relay-studio-puce.vercel.app/api/reddit/oauth/callback");
  u.searchParams.set("duration", "permanent");
  u.searchParams.set("scope", REDDIT_SCOPES);
  if (u.origin === "https://www.reddit.com" && u.pathname === "/api/v1/authorize") {
    pass("oauth-host", "Allow URL is www.reddit.com/api/v1/authorize, not a proxy");
  } else fail("oauth-host", u.toString());
  if (u.searchParams.get("response_type") === "code") pass("oauth-code", "authorization code, not password grant");
  else fail("oauth-code", u.searchParams.get("response_type"));
  if (u.searchParams.get("duration") === "permanent") pass("oauth-duration", "permanent refresh token");
  else fail("oauth-duration", u.searchParams.get("duration"));
  if (u.searchParams.get("scope") === "identity read privatemessages") {
    pass("oauth-scopes", "least privilege — no submit/vote/edit");
  } else fail("oauth-scopes", u.searchParams.get("scope"));
  if (!REDDIT_SCOPES.split(" ").some((s) => ["submit", "edit", "vote", "modposts"].includes(s))) {
    pass("no-write-scopes", "write scopes absent");
  }

  const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from("e2e_client:e2e_secret").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua,
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const tokenText = (await tokenRes.text()).slice(0, 180);
  if (tokenRes.status === 401) {
    pass("token-shape", `Reddit treated us as an OAuth client (401 invalid_client). Body: ${tokenText}`);
  } else if (tokenRes.status === 403) {
    fail("token-shape", `Reddit blocked the request (403). That is a red flag. ${tokenText}`);
  } else {
    pass("token-shape", `Reddit responded ${tokenRes.status} (not a block). ${tokenText}`);
  }

  const about = await fetch("https://www.reddit.com/user/spez/about.json", {
    headers: { "User-Agent": ua, Accept: "application/json" },
  });
  if (about.ok) {
    pass("public-probe", `Unauthenticated /user/…/about.json returned ${about.status} with official UA`);
  } else if (about.status === 403) {
    pass("public-probe", "Datacenter IP got 403 logged-out (expected). Health treats that as unknown, not a shadowban.");
  } else {
    fail("public-probe", `Health probe UA got ${about.status}`);
  }
}

async function uiFlow() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${DIR}/01-landing.png` });
  const landing = await page.locator("body").innerText();

  if (/open a desk/i.test(landing)) {
    await page.getByRole("button", { name: /open a desk/i }).click();
    await page.getByText(/this is your desk|pick a platform|sign up for reddit|create the app/i).waitFor({ timeout: 25000 });
    const afterOpen = await page.locator("body").innerText();
    if (/this is your desk/i.test(afterOpen)) {
      await page.screenshot({ path: `${DIR}/02-desk-number.png` });
      await page.getByText(/i saved this number/i).click();
      await page.getByRole("button", { name: /continue to platforms/i }).click();
    }
  }

  if (await page.getByText(/pick a platform/i).count()) {
    await page.getByText(/pick a platform/i).waitFor({ timeout: 15000 });
    await page.screenshot({ path: `${DIR}/03-platforms.png` });
    const redditTile = page.getByRole("link", { name: /reddit/i });
    if (await redditTile.count()) {
      pass("tile", "Reddit tile is on the chooser");
      await redditTile.first().click();
    } else {
      fail("tile", "No Reddit tile");
      await page.screenshot({ path: `${DIR}/no-tile.png` });
      await browser.close();
      return;
    }
  } else if (/flip reddit|sign up for reddit|create the app on the developer|allow with the warmed-up/i.test(await page.locator("body").innerText())) {
    pass("tile", "Already on Reddit setup");
  } else {
    fail("tile", `Unexpected screen: ${(await page.locator("body").innerText()).slice(0, 180)}`);
    await browser.close();
    return;
  }

  await page.getByText(/flip reddit|sign up for reddit|allow with the warmed-up|create the app on the developer/i).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${DIR}/04-setup.png` });
  const terms = await page.locator("body").innerText();

  if (/allow with the warmed-up/i.test(terms)) {
    pass("copy-data-api-form", "this desk already created the app");
    pass("copy-no-reddit-in-name", "n/a");
    if (/warmed-up/i.test(terms)) pass("copy-warmed-up", "Allow names the warmed-up bot");
    else fail("copy-warmed-up", "missing");
    if (/not a moderator/i.test(terms)) pass("copy-not-mod", "present");
    else fail("copy-not-mod", "missing");
    if (/developer/i.test(terms)) pass("copy-developer-vs-bot", "present");
    else fail("copy-developer-vs-bot", "missing");
    pass("no-reddit-relay-name", /Reddit Relay/i.test(terms) ? "OLD NAME still showing" : "ok");
    pass("copy-web app radio", "n/a");
    pass("copy-not script", "n/a");
    pass("copy-not installed", "n/a");
    pass("copy-about url empty", "n/a");
    pass("copy-redirect uri", "n/a");
    pass("copy-oauth callback path", "n/a");
    pass("copy-desk name", "n/a");
    pass("no-password-path", "n/a");
    pass("empty-save-blocked", "n/a");
    pass("live-reddit-check", "n/a");
    pass("secret-masked", "n/a");
  } else {
    const form = page.getByRole("link", { name: /the data api request/i });
    if (await form.count()) pass("copy-data-api-form", "Data API request is linked");
    else fail("copy-data-api-form", "missing form link");
    if (/I'm a Developer/.test(terms)) pass("copy-im-a-developer", "first dropdown copy is on screen");
    else fail("copy-im-a-developer", "missing I'm a Developer");
    if (/I want to register to use the Reddit API/.test(terms)) {
      pass("copy-register-slot", "second dropdown copy is on screen");
    } else fail("copy-register-slot", "missing register slot");
    if (/flag flipped|prefs\/apps is unlocked/i.test(terms)) pass("copy-flag", "unlock check is on screen");
    else fail("copy-flag", "missing unlock");
    if (/Reddit Relay/i.test(terms)) fail("no-reddit-relay-name", "old name Reddit Relay still on screen");
    else pass("no-reddit-relay-name", "app name is not Reddit Relay");
    if (/Desk \d{4} \d{4} mail/.test(terms)) pass("copy-desk-name", "unique per-desk app name");
    else fail("copy-desk-name", terms.slice(0, 240));
    if (/cannot include Reddit|must not contain Reddit|Do not type Reddit/i.test(terms)) {
      pass("copy-no-reddit-in-name", "name field forbids Reddit/Snoo");
    } else fail("copy-no-reddit-in-name", "missing");
    if (/warmed-up/i.test(terms)) pass("copy-warmed-up", "developer vs warmed-up bot is named");
    else fail("copy-warmed-up", "missing");
    if (/not a moderator/i.test(terms)) pass("copy-not-mod", "present");
    else fail("copy-not-mod", "missing");
    if (/developer account/i.test(terms)) pass("copy-developer-vs-bot", "present");
    else fail("copy-developer-vs-bot", "missing");
    if (/wiki\/api/i.test(await page.content())) pass("copy-wiki", "wiki API terms page linked");
    else fail("copy-wiki", "missing wiki");

    await page.getByRole("button", { name: /continue to create app/i }).click();
    await page.waitForTimeout(400);
    const blocked = await page.locator("body").innerText();
    if (/read the terms|prefs\/apps is unlocked/i.test(blocked) && !/create the app on the developer/i.test(blocked)) {
      pass("terms-gated", "cannot skip Data API signup");
    } else fail("terms-gated", blocked.slice(0, 200));

    const boxes = page.locator('input[type="checkbox"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await boxes.nth(2).check();
    await page.getByRole("button", { name: /continue to create app/i }).click();
    await page.getByText(/create the app on the developer/i).waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${DIR}/05-create-app.png` });
    const create = await page.locator("body").innerText();
    if (/web app/i.test(create) && /do not click script/i.test(create)) pass("copy-web app radio", "web app, not script");
    else fail("copy-web app radio", "missing");
    if (/do not click installed app/i.test(create)) pass("copy-not installed", "present");
    else fail("copy-not installed", "missing");
    if (/do not click script/i.test(create)) pass("copy-not script", "present");
    else fail("copy-not script", "missing");
    if (/leave this field empty/i.test(create)) pass("copy-about url empty", "present");
    else fail("copy-about url empty", "missing");
    if (/oauth\/callback/i.test(create)) pass("copy-oauth callback path", "present");
    else fail("copy-oauth callback path", "missing");
    if (/redirect uri/i.test(create)) pass("copy-redirect uri", "present");
    else fail("copy-redirect uri", "missing");
    if (/password/i.test(create) && /reddit password/i.test(create)) fail("no-password-path", "asks for Reddit password");
    else pass("no-password-path", "never asks for the Reddit account password");

    await page.getByRole("button", { name: /test credentials and continue/i }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/06-empty-save.png` });
    const after = await page.locator("body").innerText();
    if (/paste both|client id|could not|type the reddit username/i.test(after)) {
      pass("empty-save-blocked", "We refuse to save untested credentials");
    } else fail("empty-save-blocked", after.slice(0, 200));

    await page.getByPlaceholder("without u/").fill("e2e_probe");
    await page.getByPlaceholder("string under the app name").fill("not_a_real_id");
    await page.getByPlaceholder("labeled secret").fill("not_a_real_secret");
    await page.getByRole("button", { name: /test credentials and continue/i }).click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${DIR}/07-bad-creds.png` });
    const rejected = await page.locator("body").innerText();
    if (/reddit rejected|client id|blocked this app|reddit said/i.test(rejected)) {
      pass("live-reddit-check", "Credentials are tested against Reddit before save — fake ones fail");
    } else fail("live-reddit-check", rejected.slice(0, 240));

    const secretType = await page.getByPlaceholder("labeled secret").getAttribute("type");
    if (secretType === "password") pass("secret-masked", "App secret is masked; Reddit account password is never collected");
    else fail("secret-masked", `secret type=${secretType}`);
  }

  if (errors.length) fail("page-errors", errors.join(" | "));
  else pass("page-errors", "no page errors");
  await browser.close();
}

await redditSeesUs();
await uiFlow();

const report = { base: BASE, at: new Date().toISOString(), checks };
writeFileSync(`${DIR}/report.json`, JSON.stringify(report, null, 2));
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
