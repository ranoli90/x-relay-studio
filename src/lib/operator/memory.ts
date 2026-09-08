/** Durable customer memory. Facts are tenant + customer scoped. */

export type MemoryFact = {
  id: string;
  userId: string;
  customerId: string;
  subject: string;
  predicate: string;
  value: string;
  status: "active" | "superseded" | "deleted";
  speaker: "customer" | "operator" | "assistant";
  assertion: "asserted" | "inferred" | "negated";
};

export function factsForCustomer(facts: MemoryFact[], userId: string, customerId: string): MemoryFact[] {
  return facts.filter(
    (f) => f.userId === userId && f.customerId === customerId && f.status === "active",
  );
}

export function forgetFact(facts: MemoryFact[], id: string, userId: string): MemoryFact[] {
  return facts.map((f) => (f.id === id && f.userId === userId ? { ...f, status: "deleted" as const } : f));
}

export function correctFact(
  facts: MemoryFact[],
  input: { id: string; userId: string; value: string; replacementId: string },
): MemoryFact[] {
  const prev = facts.find((f) => f.id === input.id && f.userId === input.userId && f.status === "active");
  if (!prev) return facts;
  return [
    ...facts.map((f) => (f.id === prev.id ? { ...f, status: "superseded" as const } : f)),
    {
      ...prev,
      id: input.replacementId,
      value: input.value,
      status: "active",
      assertion: "asserted",
    },
  ];
}

export function promptLines(facts: MemoryFact[], userId: string, customerId: string, limit = 12): string[] {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return factsForCustomer(facts, userId, customerId)
    .slice(0, cap)
    .map((f) => `${f.predicate}=${f.value}`);
}
