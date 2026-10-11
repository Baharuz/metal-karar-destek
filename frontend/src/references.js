import { get, query } from './api.js';
import { collection } from './format.js';

// Reference lists use the API's maximum page size and read every page. A failed
// page rejects the whole refresh so forms never silently show a partial list.
export async function loadAllPages(path, filters = {}) {
  const pageSize = 100;
  const first = await get(`${path}${query({ ...filters, page: 1, pageSize })}`);
  const pages = [collection(first)];
  const lastPage = Math.max(1, Number(first?.pagination?.totalPages) || 1);
  for (let start = 2; start <= lastPage; start += 4) {
    const numbers = Array.from({ length: Math.min(4, lastPage - start + 1) }, (_, index) => start + index);
    const results = await Promise.all(numbers.map(page => get(`${path}${query({ ...filters, page, pageSize })}`)));
    pages.push(...results.map(collection));
  }
  return pages.flat();
}
