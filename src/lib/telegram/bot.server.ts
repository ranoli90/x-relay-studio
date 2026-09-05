import { TelegramError } from "./errors";

const API = "https://api.telegram.org";
const TIMEOUT_MS = 15_000;

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramChatInfo = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramApiMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: { id: number; type: string };
  from?: TelegramUser;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramApiMessage;
  edited_message?: TelegramApiMessage;
};

export type BotMe = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
};

type ApiOk<T> = { ok: true; result: T };
type ApiFail = { ok: false; description?: string; error_code?: number; parameters?: { retry_after?: number } };

async function call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${API}/bot${token}/${method}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TelegramError("invalid", "Telegram didn’t answer. Try again.", 502);
  }

  let json: ApiOk<T> | ApiFail;
  try {
    json = (await response.json()) as ApiOk<T> | ApiFail;
  } catch {
    throw new TelegramError("invalid", "Telegram sent a response we couldn’t read.", 502);
  }

  if (!json.ok) {
    const retry = json.parameters?.retry_after;
    if (json.error_code === 429 || retry) {
      const wait = retry ?? 30;
      throw new TelegramError("flood", `Telegram asked us to wait ${wait} seconds.`, 429, wait);
    }
    if (json.error_code === 401) {
      throw new TelegramError("bad_key", "That key didn’t work. Copy it again from BotFather.", 401);
    }
    if (json.error_code === 403) {
      throw new TelegramError(
        "hello_wait",
        "Open your helper in Telegram and tap Start, then try again.",
        403,
      );
    }
    const desc = json.description ?? "Telegram request failed.";
    throw new TelegramError("invalid", friendlyBotError(desc), response.status || 400);
  }
  return json.result;
}

function friendlyBotError(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("webhook") && d.includes("getupdates")) {
    return "The helper is waiting on a live connection. We’ll use that instead of a pull.";
  }
  if (d.includes("chat not found")) return "That chat isn’t open yet.";
  if (d.includes("bot was blocked")) return "The helper is blocked in Telegram. Unblock it and try again.";
  if (d.includes("unauthorized")) return "That key didn’t work. Copy it again from BotFather.";
  return "Telegram couldn’t complete that check.";
}

export async function botGetMe(token: string): Promise<BotMe> {
  return call<BotMe>(token, "getMe");
}

export async function botGetUpdates(
  token: string,
  offset?: number | null,
): Promise<TelegramUpdate[]> {
  const body: Record<string, unknown> = {
    timeout: 0,
    allowed_updates: ["message"],
  };
  if (offset != null) body.offset = offset;
  return call<TelegramUpdate[]>(token, "getUpdates", body);
}

export async function botSendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<TelegramApiMessage> {
  return call<TelegramApiMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function botGetChat(token: string, chatId: number): Promise<TelegramChatInfo> {
  return call<TelegramChatInfo>(token, "getChat", { chat_id: chatId });
}

export async function botSetWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<boolean> {
  try {
    await call<true>(token, "setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    return true;
  } catch {
    return false;
  }
}

export async function botDeleteWebhook(token: string): Promise<void> {
  try {
    await call<true>(token, "deleteWebhook", { drop_pending_updates: false });
  } catch {
    // ignore — next getUpdates may still work
  }
}
