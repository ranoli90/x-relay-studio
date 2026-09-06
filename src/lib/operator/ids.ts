import { randomBytes } from "node:crypto";

export type OperatorId<P extends string> = `${P}_${string}`;

export function newOperatorId<P extends string>(prefix: P): OperatorId<P> {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
