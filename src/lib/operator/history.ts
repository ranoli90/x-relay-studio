/** Confirmed history: filter local notes BEFORE applying the limit. */

export type HistoryKind =
  | "confirmed_inbound"
  | "confirmed_outbound"
  | "local_note"
  | "draft"
  | "imported";

export type HistoryItem = {
  id: string;
  kind: HistoryKind;
  body: string;
  providerAt: string | null;
  localAt: string;
};

export function selectConfirmedHistory(items: HistoryItem[], limit: number): HistoryItem[] {
  const confirmed = items.filter(
    (item) => item.kind === "confirmed_inbound" || item.kind === "confirmed_outbound",
  );
  if (limit <= 0) return [];
  return confirmed.slice(-limit);
}

export function historyTimestamp(item: HistoryItem): string {
  return item.providerAt ?? item.localAt;
}

export function sortByProviderTime(items: HistoryItem[]): HistoryItem[] {
  return items.slice().sort((a, b) => {
    const ta = Date.parse(historyTimestamp(a));
    const tb = Date.parse(historyTimestamp(b));
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}
