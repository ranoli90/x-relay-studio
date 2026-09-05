export type AutoDispatchInput = {
  userId: string;
  peer: string;
  chat?: string;
  body: string;
  agentName: string;
};

export type AutoDispatchResult =
  | { status: "ok" }
  | { status: "not_live" }
  | { status: "fail"; error: string };

type PeerSend = (opts: Record<string, unknown>) => Promise<unknown>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function isNotLiveText(s: string): boolean {
  return /not_live|skipped|preview|unlinked|auth_dead|chat_not_found|not onboarded/i.test(s);
}

function classifyThrown(err: unknown): AutoDispatchResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Failed to resolve|Cannot resolve|Failed to fetch dynamically imported/i.test(
      msg,
    )
  ) {
    return { status: "not_live" };
  }
  if (isNotLiveText(msg)) return { status: "not_live" };
  return { status: "fail", error: msg.slice(0, 240) };
}

function classifyReturned(value: unknown): AutoDispatchResult {
  if (value == null || value === true) return { status: "ok" };
  if (value === false) return { status: "fail", error: "dispatch rejected" };
  const rec = asRecord(value);
  if (!rec) return { status: "ok" };
  const status = String(rec.status ?? rec.reason ?? rec.code ?? "");
  if (isNotLiveText(status)) return { status: "not_live" };
  if (rec.ok === false) {
    if (isNotLiveText(String(rec.reason ?? rec.error ?? ""))) return { status: "not_live" };
    return { status: "fail", error: String(rec.error ?? rec.reason ?? "dispatch failed").slice(0, 240) };
  }
  if (/fail|error/i.test(status) && !/ok|sent/i.test(status)) {
    return { status: "fail", error: String(rec.error ?? rec.reason ?? status).slice(0, 240) };
  }
  if (rec.ok === true || /ok|sent/i.test(status) || status === "") return { status: "ok" };
  return { status: "ok" };
}

async function loadPeerSend(): Promise<PeerSend | null> {
  try {
    const mod = (await import("../telegram/agent-send.server.ts")) as unknown as {
      agentSendToPeer?: PeerSend;
    };
    if (typeof mod.agentSendToPeer === "function") return mod.agentSendToPeer;
  } catch (err) {
    const classified = classifyThrown(err);
    if (classified.status === "not_live") return null;
    throw err;
  }
  return null;
}

export async function tryDispatchAutoSend(opts: AutoDispatchInput): Promise<AutoDispatchResult> {
  let send: PeerSend | null;
  try {
    send = await loadPeerSend();
  } catch (err) {
    return classifyThrown(err);
  }
  if (!send) return { status: "not_live" };
  try {
    const result = await send({
      userId: opts.userId,
      peerId: opts.peer,
      chatId: opts.chat ?? opts.peer,
      body: opts.body,
      agentName: opts.agentName,
    });
    return classifyReturned(result);
  } catch (err) {
    return classifyThrown(err);
  }
}
