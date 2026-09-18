import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const STORED_NAME_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const USER_ID_RE = /^[a-z0-9]+$/i;

export function uploadRoot(): string {
  // The directory is configured at runtime; the ignore comment stops the build
  // tracer from copying the whole project into the standalone output.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR || "./uploads");
}

/** Detect the real image type from magic bytes; the client-supplied MIME type is never trusted. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function uploadPath(userId: string, storedName: string): string {
  if (!USER_ID_RE.test(userId) || !STORED_NAME_RE.test(storedName)) {
    throw new Error("Invalid upload reference");
  }
  return path.join(/* turbopackIgnore: true */ uploadRoot(), userId, storedName);
}

export async function saveUpload(userId: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  const ext = IMAGE_EXTENSIONS[mimeType];
  if (!ext) throw new Error("Unsupported image type");
  const storedName = `${randomBytes(16).toString("hex")}${ext}`;
  const target = uploadPath(userId, storedName);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  return storedName;
}

export async function deleteUploads(userId: string, storedNames: string[]): Promise<void> {
  await Promise.all(
    storedNames.map(async (name) => {
      try {
        await unlink(uploadPath(userId, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("failed to delete upload", name, error);
        }
      }
    }),
  );
}

/** Removes everything a deleted account stored: its whole upload directory. */
export async function deleteUserUploads(userId: string): Promise<void> {
  if (!USER_ID_RE.test(userId)) throw new Error("Invalid upload reference");
  try {
    await rm(path.join(/* turbopackIgnore: true */ uploadRoot(), userId), { recursive: true, force: true });
  } catch (error) {
    console.error("failed to delete uploads for account", userId, error);
  }
}
