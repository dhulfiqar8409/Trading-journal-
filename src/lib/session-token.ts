import { SignJWT, jwtVerify } from "jose";

/**
 * In production the cookie carries the __Host- prefix: browsers then only
 * accept it over HTTPS, for the whole site and without a Domain attribute,
 * so a sibling subdomain cannot plant or overwrite it. Development keeps the
 * plain name because the prefix cannot be set over plain HTTP.
 */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-darkpools_session" : "darkpools_session";
export const SESSION_DAYS = 30;

/** Attributes every Set-Cookie for the session uses, clearing included (a __Host- cookie needs them to be accepted at all). */
export function sessionCookieAttributes() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}
/** Where a session with a temporary password is sent before anything else. */
export const PASSWORD_CHANGE_PATH = "/change-password";

/** What a session token carries; the version ties it to the account's current password and status. */
export interface SessionClaims {
  userId: string;
  sessionVersion: number;
  /** The account was created or reset with a temporary password that has to be replaced first. */
  mustChangePassword: boolean;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ sv: claims.sessionVersion, ...(claims.mustChangePassword ? { pw: true } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

/** Verifies the signature and shape only; callers compare the version with the account. */
export async function verifySessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sv !== "number") return null;
    return { userId: payload.sub, sessionVersion: payload.sv, mustChangePassword: payload.pw === true };
  } catch {
    return null;
  }
}
