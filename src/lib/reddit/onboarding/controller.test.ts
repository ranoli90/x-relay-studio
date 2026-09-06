import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { plannedSteps } from "./workflows/email-signup.ts";
import {
  FakePageDriver,
  FIXTURE_TITLE,
  runBoundedSignup,
  type SignupPlanItem,
} from "./controller.ts";

const ENV_KEYS = [
  "VERCEL",
  "NODE_ENV",
  "REDDIT_ONBOARDING_FIXTURE",
  "REDDIT_ONBOARDING_FIXTURE_PORT",
  "PORT",
] as const;
const snapshot: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) snapshot[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function enableFixture() {
  delete process.env.VERCEL;
  process.env.NODE_ENV = "test";
  process.env.REDDIT_ONBOARDING_FIXTURE = "true";
  process.env.REDDIT_ONBOARDING_FIXTURE_PORT = "8080";
  delete process.env.PORT;
}

const FIXTURE_HTML = readFileSync(
  fileURLToPath(new URL("../../../../public/__reddit-onboarding-fixture/index.html", import.meta.url)),
  "utf8",
);

function fixturePlan(): SignupPlanItem[] {
  const url = "http://127.0.0.1:8080/__reddit-onboarding-fixture/";
  return plannedSteps({ signupUrl: url, expectedUsername: "alice" }).map((step) => ({
    action: step.action,
    value: step.action.fieldLabel === "username" ? "alice" : step.action.fieldLabel === "email" ? "alice@example.test" : undefined,
  }));
}

describe("bounded signup controller", () => {
  it("observes the fixture title and fields from the driver instead of a TEST shortcut", async () => {
    enableFixture();
    const htmlTitle = FIXTURE_HTML.match(/<title>([^<]+)<\/title>/i)?.[1];
    assert.equal(htmlTitle, FIXTURE_TITLE);
    assert.notEqual(htmlTitle, "TEST signup fixture");
    assert.match(FIXTURE_HTML, /name="username"/);
    assert.match(FIXTURE_HTML, /name="email"/);

    const driver = new FakePageDriver();
    const observation = await runBoundedSignup(driver, fixturePlan(), {
      fixtureMode: true,
      fillValues: { username: "alice", email: "alice@example.test" },
    });
    const page = await driver.observe();
    assert.equal(page.title, htmlTitle);
    assert.equal(page.title, FIXTURE_TITLE);
    assert.ok(page.fields.some((f) => f.name === "username"));
    assert.ok(page.fields.some((f) => f.name === "email"));
    assert.equal(page.fields.find((f) => f.name === "password")?.filled, false);
    assert.equal(driver.navigations, 1);
    assert.equal(observation.errorCode, null);
    assert.equal(observation.supportedVariant, "email");
    assert.notEqual(observation.requiredHumanAction, null);
  });

  it("requires the owner for captcha, terms, and final submit", async () => {
    enableFixture();
    const driver = new FakePageDriver();
    await driver.navigate("http://127.0.0.1:8080/__reddit-onboarding-fixture/");
    const page = await driver.observe();
    assert.equal(page.hasCaptcha, true);
    assert.equal(page.hasTerms, true);
    assert.equal(page.hasFinalSubmit, true);

    const captcha = await driver.click({ name: "captcha" });
    assert.equal(captcha.blocked, true);
    assert.equal(captcha.requiredHumanAction, "captcha");
    const terms = await driver.click({ name: "terms" });
    assert.equal(terms.blocked, true);
    assert.equal(terms.requiredHumanAction, "terms");
    const submit = await driver.click({ name: "submit-final" });
    assert.equal(submit.blocked, true);
    assert.equal(submit.requiredHumanAction, "final_submit");

    const observation = await runBoundedSignup(driver, fixturePlan(), { fixtureMode: true });
    assert.ok(["captcha", "terms", "final_submit"].includes(observation.requiredHumanAction || ""));
  });

  it("does not auto-fill password and rejects sensitive fills", async () => {
    enableFixture();
    const driver = new FakePageDriver();
    await driver.navigate("http://127.0.0.1:8080/__reddit-onboarding-fixture/");
    await assert.rejects(() => driver.fill("input[name='password']", "secret", "password"), /SENSITIVE_FIELD/);
    const denied = await runBoundedSignup(
      driver,
      [{ action: { method: "fill", fieldLabel: "password", selector: "input[name='password']" }, value: "secret" }],
      { fixtureMode: true, pageOrigin: "http://127.0.0.1:8080" },
    );
    assert.equal(denied.errorCode, "SENSITIVE_FIELD");
    const page = await driver.observe();
    assert.equal(page.fields.find((f) => f.name === "password")?.filled, false);
  });

  it("pauses before executing and resumes", async () => {
    enableFixture();
    const driver = new FakePageDriver();
    driver.pause();
    let finished = false;
    const pending = runBoundedSignup(driver, fixturePlan(), { fixtureMode: true }).then((obs) => {
      finished = true;
      return obs;
    });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(finished, false);
    assert.equal(driver.navigations, 0);
    driver.resume();
    const observation = await pending;
    assert.equal(finished, true);
    assert.equal(driver.navigations, 1);
    assert.equal(observation.supportedVariant, "email");
  });
});
