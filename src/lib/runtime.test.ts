import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSimulatorAllowed, demoFixturesAllowed, isProductionRuntime } from "./runtime.ts";

describe("simulator gate F02", () => {
  it("rejects without isolated-fixture flag", () => {
    const prev = process.env.XRELAY_ALLOW_SIMULATOR;
    const node = process.env.NODE_ENV;
    delete process.env.XRELAY_ALLOW_SIMULATOR;
    process.env.NODE_ENV = "test";
    assert.equal(demoFixturesAllowed(), false);
    assert.throws(() => assertSimulatorAllowed("Payment simulation"), /disabled/);
    if (prev === undefined) delete process.env.XRELAY_ALLOW_SIMULATOR;
    else process.env.XRELAY_ALLOW_SIMULATOR = prev;
    process.env.NODE_ENV = node;
  });

  it("rejects in production even with the flag", () => {
    const prev = process.env.XRELAY_ALLOW_SIMULATOR;
    const node = process.env.NODE_ENV;
    const vercel = process.env.VERCEL;
    process.env.XRELAY_ALLOW_SIMULATOR = "isolated-fixture";
    process.env.NODE_ENV = "production";
    assert.equal(isProductionRuntime(), true);
    assert.throws(() => assertSimulatorAllowed(), /production/);
    if (prev === undefined) delete process.env.XRELAY_ALLOW_SIMULATOR;
    else process.env.XRELAY_ALLOW_SIMULATOR = prev;
    process.env.NODE_ENV = node;
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  });

  it("allows isolated-fixture outside production", () => {
    const prev = process.env.XRELAY_ALLOW_SIMULATOR;
    const node = process.env.NODE_ENV;
    const vercel = process.env.VERCEL;
    process.env.XRELAY_ALLOW_SIMULATOR = "isolated-fixture";
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    assert.equal(demoFixturesAllowed(), true);
    assert.doesNotThrow(() => assertSimulatorAllowed());
    if (prev === undefined) delete process.env.XRELAY_ALLOW_SIMULATOR;
    else process.env.XRELAY_ALLOW_SIMULATOR = prev;
    process.env.NODE_ENV = node;
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  });
});
