import type { TagDTO } from "@/lib/serialize";

export const TAG_KIND_LABELS: Record<TagDTO["kind"], string> = {
  STRATEGY: "Strategy",
  SETUP: "Setup",
  MISTAKE: "Mistake",
  CUSTOM: "Custom",
};

export function TagChip({ tag, small = false }: { tag: Pick<TagDTO, "name" | "color">; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 font-medium text-ink-2 ${
        small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"
      }`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
      {tag.name}
    </span>
  );
}
