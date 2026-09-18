"use client";

import { useState } from "react";

export function CopyField({ value, label = "Share link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input readOnly value={value} className="input num flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} aria-label={label} />
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard may be unavailable; the field is selectable.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
