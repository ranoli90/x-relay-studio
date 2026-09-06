/** Canonical confirmed transcript: observed inbound + acknowledged outbound. */

export type TranscriptRole = "fan" | "persona" | "system" | "draft";

export type HistoryRow = {
  role: string;
  body: string;
  status?: string | null;
  origin?: string | null;
};

const CONFIRMED_STATUS = new Set(["sent", "sent_confirmed", "observed"]);

export function isConfirmedOutbound(row: HistoryRow): boolean {
  if (row.role !== "persona") return false;
  const status = (row.status ?? "").toLowerCase();
  if (!status) return false;
  if (status === "approved" || status === "held" || status === "local" || status === "draft") return false;
  return CONFIRMED_STATUS.has(status);
}

export function isConfirmedInbound(row: HistoryRow): boolean {
  return row.role === "fan" || row.role === "inbound" || row.origin === "observed_partner";
}

export function confirmedTranscript(rows: HistoryRow[]): { role: "fan" | "persona"; body: string }[] {
  const out: { role: "fan" | "persona"; body: string }[] = [];
  for (const row of rows) {
    if (isConfirmedInbound(row) && (row.status == null || CONFIRMED_STATUS.has((row.status ?? "sent").toLowerCase()) || row.status === "sent")) {
      out.push({ role: "fan", body: row.body });
      continue;
    }
    if (isConfirmedOutbound(row)) {
      out.push({ role: "persona", body: row.body });
    }
  }
  return out;
}

export function confirmedTurnCount(rows: HistoryRow[]): number {
  return confirmedTranscript(rows).length;
}
