import { createHash } from "node:crypto";
import { importHashKey, type ImportIdentity } from "@/lib/import-hash-key";

export { importHashKey, type ImportIdentity };

/** SHA-256 of the identity key; stored on Trade.importHash. */
export function importHash(identity: ImportIdentity): string {
  return hashKey(importHashKey(identity));
}

/** SHA-256 of an already-built identity key. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
