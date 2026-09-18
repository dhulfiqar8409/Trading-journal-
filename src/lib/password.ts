import "server-only";
import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummy: string | null = null;

/** A real hash to compare against when the user does not exist, so login timing does not reveal accounts. */
export function dummyHash(): string {
  dummy ??= bcrypt.hashSync("darkpools-dummy-password", COST);
  return dummy;
}
