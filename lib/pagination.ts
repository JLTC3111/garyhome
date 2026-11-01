type PageResult<T> = { data: T[] | null; error: unknown };

// Use a stable, unique ordering in the caller. Advance by the number actually
// returned: a project's Data API cap can be smaller than the requested page.
export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 500,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new RangeError("Invalid page size.");
  const rows: T[] = [];
  for (;;) {
    const result = await page(rows.length, rows.length + pageSize - 1);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new TypeError("Invalid list response.");
    if (!result.data.length) return rows;
    rows.push(...result.data);
  }
}
