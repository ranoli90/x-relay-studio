/** Per-desk MTProto mutex. Row lease with an owner token — stale workers cannot clear a newer lease. */
import { getSql } from "@/lib/db";
import { newId } from "@/lib/agent/ids";
import { TelegramError } from "./errors";
import {
  LEASE_RENEW_EVERY_MS,
  claimMtprotoLease,
  releaseMtprotoLease,
  renewMtprotoLease,
  sessionGeneration,
} from "./lease";

export {
  LEASE_RENEW_EVERY_MS,
  LEASE_SECONDS,
  claimMtprotoLease,
  disconnectMtprotoSession,
  releaseMtprotoLease,
  renewMtprotoLease,
  seizeSessionGeneration,
  sessionGeneration,
  wipeDisconnectedSession,
} from "./lease";

function busy(): TelegramError {
  return new TelegramError(
    "flood",
    "Telegram is already busy on this desk. Try again in a moment.",
    429,
    2,
  );
}

export async function withMtprotoLease<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const sql = await getSql();
  const owner = newId("lease");
  const claimed = await claimMtprotoLease(sql, userId, owner);
  if (!claimed) throw busy();

  let lost = false;
  const timer = setInterval(() => {
    void renewMtprotoLease(sql, userId, owner, claimed.generation).then((ok) => {
      if (!ok) lost = true;
    });
  }, LEASE_RENEW_EVERY_MS);
  timer.unref?.();

  try {
    const result = await fn();
    const generation = await sessionGeneration(sql, userId);
    if (generation !== claimed.generation) {
      throw new TelegramError("unlinked", "Telegram signed this desk out. Connect again.", 401);
    }
    if (lost) throw busy();
    return result;
  } finally {
    clearInterval(timer);
    try {
      await releaseMtprotoLease(sql, userId, owner);
    } catch {
      /* lease expires on lease_until even if this fails */
    }
  }
}
