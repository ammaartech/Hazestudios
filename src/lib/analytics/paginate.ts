/**
 * Paged reads for analytics, where a truncated answer is a wrong answer.
 *
 * PostgREST caps a single response at 1000 rows and returns no error when it
 * hits that ceiling, so an unbounded `.select()` over a wide date range reports
 * the first thousand rows as if they were the whole window. For a total, an
 * average or a conversion rate, that is not a slow answer — it is a confidently
 * wrong one.
 */

/** PostgREST's per-response row ceiling. */
export const PAGE_SIZE = 1000;

/** The shape every PostgREST query resolves to, narrowed to what paging needs. */
interface PageResponse {
  data: unknown;
  error: { message: string } | null;
}

/**
 * Drain a query a page at a time until a short page proves the end.
 *
 * `page` is handed an inclusive `[start, end]` row range and must return a query
 * that is already ordered by something unique. Ordering by a non-unique column
 * alone lets rows shift between pages as the cursor advances, which silently
 * duplicates or drops them.
 */
export async function fetchAllPages<T>(
  page: (start: number, end: number) => PromiseLike<PageResponse>
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}
