import type { RouteCoverageDetail } from './shared.js';
import { matchesRouteFilters, type ResourceFilters } from './resourceFilters.js';

export const routeCoverageColumns = [
  { key: 'namespace', label: 'Namespace' },
  { key: 'name', label: 'Name' },
  { key: 'hostnames', label: 'Hostnames' },
  { key: 'listenerHostnames', label: 'Listener hostnames' },
  { key: 'matches', label: 'Route matches' },
  { key: 'covered', label: 'Parent reference' },
  { key: 'parentRefs', label: 'Parents' },
  { key: 'missingParentRefs', label: 'Missing parents' },
] as const;

export type RouteSortColumn = typeof routeCoverageColumns[number]['key'];

function sortValue(route: RouteCoverageDetail, column: RouteSortColumn): string {
  if (column === 'covered') return route.covered ? 'Has parent ref' : 'No parent ref';
  if (column === 'missingParentRefs') return (route.missingParentRefs || []).map(parent => `${parent.namespace}/${parent.name}`).sort().join(', ').toLowerCase();
  const value = route[column];
  return (Array.isArray(value) ? [...value].map(value => value.toLowerCase()).sort().join(', ') : value || '').toLowerCase();
}

export interface RouteCoverageViewParams {
  rows: RouteCoverageDetail[];
  search?: string;
  hostname?: string;
  hostnameScope?: ResourceFilters['hostnameScope'];
  routeMatch?: string;
  filterCoverage?: 'ALL' | 'COVERED' | 'UNCOVERED';
  sortCol?: RouteSortColumn;
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
  let filtered = rows.filter(r => matchesRouteFilters(r, {
    search, hostname: p.hostname, hostnameScope: p.hostnameScope, routeMatch: p.routeMatch, parentRefs: filterCoverage,
  }));
  filtered = filtered.sort((a,b) => {
    const av = sortValue(a, sortCol);
    const bv = sortValue(b, sortCol);
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
