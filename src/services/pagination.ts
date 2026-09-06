export type PaginationOptions = {
  page?: number;
  pageSize?: number;
};

export const DEFAULT_PAGE_SIZE = 50;
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;

export function normalizePagination(options: PaginationOptions = {}) {
  const page = Math.max(0, Math.floor(Number(options.page ?? 0)) || 0);
  const rawPageSize = Math.floor(Number(options.pageSize ?? DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, rawPageSize));
  const from = page * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}
