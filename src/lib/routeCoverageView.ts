import type { RouteCoverageDetail } from './shared.js';

export interface RouteCoverageViewParams {
  rows: RouteCoverageDetail[];
  search?: string;
  filterCoverage?: 'ALL' | 'COVERED' | 'UNCOVERED';
  sortCol?: 'namespace' | 'name';
  sortDir?: 'asc' | 'desc';
  page?: number; // 1-based
  pageSize?: number | 'All';
}

export interface RouteCoverageViewResult {
  total: number;
  totalPages: number;
  page: number;
  pageSize: number | 'All';
  visible: RouteCoverageDetail[];
}

export function computeRouteCoverageView(p: RouteCoverageViewParams): RouteCoverageViewResult {
  const {
    rows,
    search = '',
    filterCoverage = 'ALL',
    sortCol = 'namespace',
    sortDir = 'asc',
    page = 1,
    pageSize = 20
  } = p;
  const s = search.trim().toLowerCase();
  let filtered = rows.filter(r => {
    if (filterCoverage === 'COVERED' && !r.covered) return false;
    if (filterCoverage === 'UNCOVERED' && r.covered) return false;
    if (s) {
      if (!r.name.toLowerCase().includes(s) && !r.namespace.toLowerCase().includes(s)) return false;
    }
    return true;
  });
  filtered = filtered.sort((a,b) => {
    const av = a[sortCol].toLowerCase();
    const bv = b[sortCol].toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    if (sortCol !== 'namespace') {
      const nsa = a.namespace.toLowerCase();
      const nsb = b.namespace.toLowerCase();
      if (nsa !== nsb) return nsa < nsb ? -1 : 1;
    }
    const na = a.name.toLowerCase();
    const nb = b.name.toLowerCase();
    if (na !== nb) return na < nb ? -1 : 1;
    return 0;
  });
  const total = filtered.length;
  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1,page), totalPages);
  const visible = pageSize === 'All' ? filtered : filtered.slice((safePage-1)*pageSize, (safePage-1)*pageSize + pageSize);
  return { total, totalPages, page: safePage, pageSize, visible };
}
