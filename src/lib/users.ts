/**
 * Account rules shared by the setup page, the admin area and the seed:
 * username shape, the username derived for pre-existing accounts, temporary
 * passwords and the guard that keeps an admin from locking everyone out.
 * Pure: no database, no server-only imports.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
/** Lowercase letters, digits, dot, underscore and hyphen; checked after normalisation. */
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const USERNAME_HINT = "3-32 characters: letters, digits, dot, underscore or hyphen.";

export type UserRole = "ADMIN" | "USER";

/** Usernames are case-insensitive: they are stored and compared in lowercase. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** The reason a username is refused, or null when it is fine. */
export function usernameError(input: string): string | null {
  const value = normalizeUsername(input);
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) return `Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(value)) return "Only letters, digits, dot, underscore and hyphen are allowed.";
  return null;
}

export function isValidUsername(input: string): boolean {
  return usernameError(input) === null;
}

/**
 * The username an existing account receives when usernames are introduced:
 * the email's local part with disallowed characters dropped, or a name from
 * the account id when too little is left. Mirrors the migration.
 */
export function usernameFromEmail(email: string, accountId: string): string {
  const local = email.split("@")[0] ?? "";
  const candidate = local.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, USERNAME_MAX);
  if (candidate.length >= USERNAME_MIN) return candidate;
  return `user-${accountId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
}

/** Characters that are easy to read aloud and type on a phone: no 0/O, 1/l/I. */
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * A temporary password of `length` characters drawn uniformly from the alphabet
 * (rejection sampling, so no modulo bias). Shown once to the admin; the user
 * must replace it at first sign-in.
 */
export function generateTemporaryPassword(length = 14, random: (n: number) => Uint8Array = randomBytes): string {
  if (length < 10 || length > 64) throw new Error("Temporary passwords are 10 to 64 characters");
  const limit = Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length;
  let out = "";
  while (out.length < length) {
    for (const byte of random(length * 2)) {
      if (byte < limit) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export type AccountChange = "deactivate" | "demote" | "delete";

export interface AccountChangeInput {
  /** The admin performing the change. */
  actorId: string;
  target: { id: string; role: UserRole; isActive: boolean };
  /** Admins that are active right now, including the actor. */
  activeAdminCount: number;
}

const CHANGE_VERB: Record<AccountChange, string> = { deactivate: "deactivate", demote: "demote", delete: "delete" };

/**
 * Why an admin may not apply `change` to `target`, or null when allowed.
 * Admins never act on their own account and the last active admin stays.
 */
export function accountChangeError(change: AccountChange, input: AccountChangeInput): string | null {
  if (input.target.id === input.actorId) return `You cannot ${CHANGE_VERB[change]} your own account.`;
  const removesActiveAdmin = input.target.role === "ADMIN" && input.target.isActive;
  if (removesActiveAdmin && input.activeAdminCount <= 1) return "The last active admin cannot be removed.";
  return null;
}
