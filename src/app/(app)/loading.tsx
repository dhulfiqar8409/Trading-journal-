/** Skeleton shown while a page's server data loads: same rhythm as the real page, no layout jump. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-8 w-48" />
      </div>
      <div className="card card-pad">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton mt-3 h-10 w-52" />
        <div className="skeleton mt-3 h-3 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card p-4">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton mt-3 h-7 w-24" />
            <div className="skeleton mt-3 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="card card-pad">
        <div className="skeleton h-3 w-28" />
        <div className="skeleton mt-3 h-56 w-full" />
      </div>
    </div>
  );
}
