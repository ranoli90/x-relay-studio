/** Production vs isolated-fixture gates. No DB imports — safe from db.ts. */

export function isProductionRuntime(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

/**
 * Demo customers, fake proof assets, and payment/inbound simulators.
 * Explicit isolated-fixture only — a hidden button or NODE_ENV=development is not enough.
 */
export function demoFixturesAllowed(): boolean {
  return process.env.XRELAY_ALLOW_SIMULATOR === "isolated-fixture";
}

export function assertSimulatorAllowed(kind = "Simulator"): void {
  if (isProductionRuntime()) {
    throw new Error(`${kind} is disabled in production.`);
  }
  if (!demoFixturesAllowed()) {
    throw new Error(`${kind} is disabled.`);
  }
}
