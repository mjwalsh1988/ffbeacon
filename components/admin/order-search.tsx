import Link from "next/link";

/**
 * A GET form, so a search is a URL and works with no JavaScript. Display names are
 * not searched: they are derived at render and stored nowhere.
 */
export function OrderSearch({ query }: { query: string }) {
  return (
    <form action="/admin/orders" method="get" role="search" className="max-w-xl">
      <label htmlFor="order-search" className="block text-sm font-semibold text-ink">
        Find an order
      </label>
      <p id="order-search-hint" className="mt-0.5 text-xs text-ink-muted">
        Order number, or part of an email address
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <input
          id="order-search"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={120}
          aria-describedby="order-search-hint"
          className="min-h-11 min-w-0 flex-1 rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Search
        </button>
        {query && (
          <Link
            href="/admin/orders"
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-ink-muted underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}
