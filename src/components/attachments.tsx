"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function AttachmentUploader({ tradeId }: { tradeId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`/api/trades/${tradeId}/attachments`, { method: "POST", body });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `Upload failed (${res.status})`);
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className={`btn w-fit cursor-pointer ${busy ? "opacity-60" : ""}`}>
        {busy ? "Uploading…" : "Add screenshot"}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(e) => upload(e.target.files)}
        />
      </label>
      <p className="text-xs text-muted">PNG, JPEG, GIF or WebP up to 10 MB each.</p>
      {error ? (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      ) : null}
    </div>
  );
}
