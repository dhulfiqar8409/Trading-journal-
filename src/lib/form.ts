import type { ZodError } from "zod";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ActionState = ActionResult | null;

/** FormData to a plain object; repeated keys (checkbox groups) become arrays. */
export function formToObject(formData: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

export function zodErrorToResult(error: ZodError): ActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = error.issues[0];
  const where = first?.path.length ? `${String(first.path[0])}: ` : "";
  return { ok: false, error: `${where}${first?.message ?? "Invalid input"}`, fieldErrors };
}

export function failure(error: string, fieldErrors?: Record<string, string>): ActionResult {
  return { ok: false, error, fieldErrors };
}

export function success(message?: string): ActionResult {
  return { ok: true, message };
}

/** Only allow same-site relative redirect targets. */
export function safeRedirectPath(next: string | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
