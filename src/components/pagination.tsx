import Link from "next/link";

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <p>
        {total === 0 ? "No trades" : `${start}–${end} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="btn btn-sm">
            Previous
          </Link>
        ) : (
          <span className="btn btn-sm opacity-50">Previous</span>
        )}
        <span className="num">
          {page} / {pageCount}
        </span>
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className="btn btn-sm">
            Next
          </Link>
        ) : (
          <span className="btn btn-sm opacity-50">Next</span>
        )}
      </div>
    </div>
  );
}
