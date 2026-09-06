/** Canonical confirmed transcript: observed inbound + acknowledged outbound. */

export type TranscriptRole = "fan" | "persona" | "system" | "draft";

export type HistoryRow = {
  role: string;
  body: string;
  status?: string | null;
  origin?: string | null;
};

const CONFIRMED_STATUS = new Set(["sent", "sent_confirmed", "observed"]);
const LOCAL_ORIGINS = new Set(["local_note", "local_template", "imported", "operator_note"]);

export function isLocalNote(row: HistoryRow): boolean {
  const origin = (row.origin ?? "").toLowerCase();
  if (LOCAL_ORIGINS.has(origin)) return true;
  const status = (row.status ?? "").toLowerCase();
  return status === "draft" || status === "held" || status === "local";
}

export function isConfirmedOutbound(row: HistoryRow): boolean {
  if (row.role !== "persona") return false;
  if (isLocalNote(row)) return false;
  const status = (row.status ?? "").toLowerCase();
  if (!status) return false;
  if (status === "approved" || status === "held" || status === "local" || status === "draft") return false;
  return CONFIRMED_STATUS.has(status);
}

export function isConfirmedInbound(row: HistoryRow): boolean {
  if (isLocalNote(row)) return false;
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

/** Filter local notes first, then apply the history window. */
export function confirmedTranscriptLimited(rows: HistoryRow[], limit: number): { role: "fan" | "persona"; body: string }[] {
  const confirmed = confirmedTranscript(rows);
  if (limit <= 0) return [];
  return confirmed.slice(-limit);
}

export function confirmedTurnCount(rows: HistoryRow[]): number {
  return confirmedTranscript(rows).length;
}
