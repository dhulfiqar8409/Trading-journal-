/**
 * Attachment rules shared by the upload route, the share target and the
 * pages that explain them: file names safe for headers, the per-user storage
 * quota and how it is reported. Pure: no file system, no database.
 */

export const DEFAULT_ATTACHMENT_QUOTA_MB = 200;
/** Shared screenshots that were never attached to a trade are dropped after this long. */
export const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A display name that survives a Content-Disposition header: the last path
 * segment, ASCII letters, digits and a few punctuation marks only (anything
 * outside Latin-1 would make the response constructor throw), at most 200
 * characters, never empty.
 */
export function safeFilename(name: string | null | undefined, fallback = "screenshot"): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || fallback;
}

/** The per-user attachment quota in bytes: ATTACHMENT_QUOTA_MB when it is a positive number, else 200 MB. */
export function attachmentQuotaBytes(configured: string | undefined = process.env.ATTACHMENT_QUOTA_MB): number {
  const mb = Number(configured);
  const effective = configured !== undefined && configured.trim() !== "" && Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_ATTACHMENT_QUOTA_MB;
  return Math.round(effective * 1024 * 1024);
}

/** Megabytes to one decimal, without a trailing ".0": "200 MB", "199.5 MB", "2.3 MB". */
export function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export interface StorageVerdict {
  ok: boolean;
  usedBytes: number;
  quotaBytes: number;
  /** Why the file was refused; empty when it fits. */
  message: string;
}

/** Whether `incomingBytes` still fit under the quota next to what the account already stores. */
export function storageVerdict(usedBytes: number, incomingBytes: number, quotaBytes: number): StorageVerdict {
  if (usedBytes + incomingBytes <= quotaBytes) return { ok: true, usedBytes, quotaBytes, message: "" };
  return {
    ok: false,
    usedBytes,
    quotaBytes,
    message: `Storage limit reached: ${formatMegabytes(usedBytes)} of ${formatMegabytes(quotaBytes)} used. Delete some screenshots to add new ones.`,
  };
}
