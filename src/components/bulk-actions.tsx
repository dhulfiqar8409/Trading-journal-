"use client";

import { useEffect, useState } from "react";
import { deleteTradesAction } from "@/actions/trades";

const BOXES = 'input[type="checkbox"][name="ids"][form="bulk-delete"]';

/**
 * Bulk delete for the trades list. The row and card checkboxes belong to
 * this form through their form attribute, so no form has to wrap the list
 * (the close sheet has a form of its own). "Select all on this page" ticks
 * what is visible; when the filter spans more pages the whole filter can be
 * chosen instead, and the confirmation always states the count.
 */
export function BulkActions({ visible, total, filters, returnTo }: { visible: number; total: number; filters: Record<string, string>; returnTo: string }) {
  const [selected, setSelected] = useState(0);
  const [wholeFilter, setWholeFilter] = useState(false);

  useEffect(() => {
    // Each trade has a checkbox in the table row and one in the card (only one is shown), so count trades, not boxes.
    const update = () => {
      const n = new Set(
        Array.from(document.querySelectorAll<HTMLInputElement>(BOXES))
          .filter((b) => b.checked)
          .map((b) => b.value),
      ).size;
      setSelected(n);
      if (n < visible) setWholeFilter(false);
    };
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, [visible]);

  const toggleAll = (checked: boolean) => {
    document.querySelectorAll<HTMLInputElement>(BOXES).forEach((b) => {
      b.checked = checked;
    });
    setSelected(checked ? visible : 0);
    if (!checked) setWholeFilter(false);
  };

  const allVisible = visible > 0 && selected === visible;
  const count = wholeFilter ? total : selected;
  return (
    <form
      id="bulk-delete"
      action={deleteTradesAction}
      onSubmit={(e) => {
        if (count === 0 || !window.confirm(`Delete ${count} ${count === 1 ? "trade" : "trades"}? Their screenshots and rule events go too. This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
      className="flex flex-wrap items-center gap-3 text-sm"
      aria-label="Bulk actions"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      {wholeFilter ? <input type="hidden" name="scope" value="filter" /> : null}
      {Object.entries(filters).map(([key, value]) => (
        <input key={key} type="hidden" name={`f_${key}`} value={value} />
      ))}
      <label className="flex items-center gap-2 text-ink-2">
        <input type="checkbox" checked={allVisible} onChange={(e) => toggleAll(e.target.checked)} aria-label="Select all on this page" />
        Select all on this page
      </label>
      {allVisible && total > visible && !wholeFilter ? (
        <button type="button" className="text-accent underline" onClick={() => setWholeFilter(true)}>
          Select all {total} matching this filter
        </button>
      ) : null}
      <span className="num text-muted" aria-live="polite">
        {count} selected
      </span>
      <button type="submit" className="btn btn-sm btn-danger" disabled={count === 0}>
        Delete selected
      </button>
    </form>
  );
}
