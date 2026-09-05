import { botGetChat, botGetMe, botSendMessage } from "./bot.server";
import { helperChatId, notesChatId } from "./bot-token";
import {
  mergeCheckResults,
  parseChecksJson,
  requiredChecksPassed,
  type TelegramCheckId,
  type TelegramCheckResult,
} from "./checks";
import {
  getCredentialRow,
  getDecryptedToken,
  markOnboarded,
  pullUpdates,
  saveChecks,
} from "./credentials.server";
import { TelegramError } from "./errors";
import { appendMessage, getAccount, seedStudioNotes, sendNote } from "./snapshot.server";

function stamp(
  results: TelegramCheckResult[],
  id: TelegramCheckId,
  ok: boolean,
  detail: string,
): TelegramCheckResult[] {
  const now = new Date().toISOString();
  return mergeCheckResults(results).map((row) =>
    row.id === id ? { id, ok, detail, ranAt: now } : row,
  );
}

export async function runOneCheck(userId: string, id: TelegramCheckId): Promise<TelegramCheckResult[]> {
  const cred = await getCredentialRow(userId);
  if (!cred) throw new TelegramError("invalid", "Save a helper key first.", 400);
  const token = await getDecryptedToken(userId);
  if (!token) throw new TelegramError("invalid", "Could not read the saved key.", 500);
  let results = parseChecksJson(cred.checks_json);

  try {
    switch (id) {
      case "helper_alive": {
        const me = await botGetMe(token);
        const name = me.username ? `@${me.username}` : me.first_name;
        results = stamp(results, id, true, `Online as ${name}.`);
        break;
      }
      case "its_you": {
        await pullUpdates(userId);
        const account = await getAccount(userId);
        const fresh = await getCredentialRow(userId);
        if (!fresh?.hello_at || !account || account.preview) {
          results = stamp(results, id, false, "Still waiting for Start in Telegram.");
        } else {
          results = stamp(results, id, true, `Connected as ${account.displayName}.`);
        }
        break;
      }
      case "studio_notes": {
        const account = await getAccount(userId);
        if (!account || account.preview) {
          results = stamp(results, id, false, "Say hello in Telegram first.");
          break;
        }
        await seedStudioNotes(userId, account.displayName);
        await sendNote(
          userId,
          notesChatId(userId),
          "Notes are working. This desk is yours.",
          "Studio",
          { asSelf: false },
        );
        results = stamp(results, id, true, "Studio notes are ready.");
        break;
      }
      case "helper_message": {
        const account = await getAccount(userId);
        if (!account || account.preview) {
          results = stamp(results, id, false, "Say hello in Telegram first.");
          break;
        }
        const ping = "Your X Relay desk is connected. This is a check from the studio.";
        const sent = await botSendMessage(token, account.telegramUserId, ping);
        await appendMessage({
          userId,
          chatId: helperChatId(userId),
          fromSelf: false,
          authorName: cred.bot_name ?? "Helper",
          body: ping,
          telegramMessageId: sent.message_id,
        });
        results = stamp(results, id, true, "Ping sent to your Telegram.");
        break;
      }
      case "see_chat": {
        const account = await getAccount(userId);
        if (!account || account.preview) {
          results = stamp(results, id, false, "Say hello in Telegram first.");
          break;
        }
        const chat = await botGetChat(token, account.telegramUserId);
        const label = chat.first_name ?? chat.title ?? "your chat";
        results = stamp(results, id, true, `Opened ${label}.`);
        break;
      }
      default:
        throw new TelegramError("invalid", "Unknown check.", 400);
    }
  } catch (err) {
    const detail = err instanceof TelegramError ? err.message : "That check didn’t pass. Try again.";
    results = stamp(results, id, false, detail);
  }

  await saveChecks(userId, results);
  return results;
}

export async function runAllChecks(userId: string): Promise<TelegramCheckResult[]> {
  const order: TelegramCheckId[] = [
    "helper_alive",
    "its_you",
    "studio_notes",
    "helper_message",
    "see_chat",
  ];
  let results: TelegramCheckResult[] = [];
  for (const id of order) {
    results = await runOneCheck(userId, id);
  }
  return results;
}

export async function finishOnboarding(userId: string): Promise<void> {
  const cred = await getCredentialRow(userId);
  if (!cred) throw new TelegramError("invalid", "Save a helper key first.", 400);
  const results = parseChecksJson(cred.checks_json);
  if (!requiredChecksPassed(results)) {
    throw new TelegramError(
      "checks_incomplete",
      "Run the required checks first. They’re the ones without “optional”.",
      400,
    );
  }
  const account = await getAccount(userId);
  if (!account || account.preview) {
    throw new TelegramError("hello_wait", "Say hello in Telegram first.", 400);
  }
  await markOnboarded(userId);
  console.info("[telegram]", { event: "onboarded", userId, telegramUserId: account.telegramUserId });
}
