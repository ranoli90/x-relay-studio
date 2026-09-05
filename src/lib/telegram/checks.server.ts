import type { TelegramCheckId, TelegramCheckResult } from "./checks";
import { finishWatchOnboarding, runWatchChecks } from "./watch.server";

/** Path B checks. Helper-bot checks are unused. */
export async function runOneCheck(userId: string, _id: TelegramCheckId): Promise<TelegramCheckResult[]> {
  return runWatchChecks(userId);
}

export async function runAllChecks(userId: string): Promise<TelegramCheckResult[]> {
  return runWatchChecks(userId);
}

export async function finishOnboarding(userId: string): Promise<void> {
  await finishWatchOnboarding(userId);
}
