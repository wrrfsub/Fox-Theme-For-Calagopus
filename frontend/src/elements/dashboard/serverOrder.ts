// Sorting and grouping for the servers list. No runtime imports, so tests/serverOrder.test.ts can load it.
import type { RowStatus, Server } from './ServerRow.tsx';

export const SORT_KEYS = ['name', 'status', 'game', 'location', 'cpu', 'ram', 'uptime', 'id'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const GROUP_KEYS = ['none', 'location', 'game', 'status'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const SORT_STORAGE_KEY = 'nebula:server-sort';
export const GROUP_STORAGE_KEY = 'nebula:server-group';

/** The keys whose values only exist while the row's node streams its stats. */
export const LIVE_SORT_KEYS: readonly SortKey[] = ['cpu', 'ram', 'uptime'];

/** The status filter's order: the servers that are up first, the ones in some other state last. */
export const STATUS_ORDER: readonly RowStatus[] = ['running', 'offline', 'suspended', 'other'];

/** The part of core's live resource usage the list sorts by. */
export interface Usage {
  state: string;
  cpuAbsolute: number;
  memoryBytes: number;
  uptime: number;
}

export interface OrderContext {
  /** What the row's status column shows, once the row has reported it. */
  status: (uuid: string) => RowStatus | undefined;
  usage: (uuid: string) => Usage | undefined;
}

export interface ServerGroup {
  /** Location or egg uuid, or the status. */
  key: string;
  /** The location or egg name; for 'status' the status itself, to be translated. */
  label: string;
  servers: Server[];
}

/** Stored as `key:dir`; anything else (or nothing) means the API's order. */
export function parseSort(raw: string | null): Sort | null {
  const [key, dir, ...rest] = (raw ?? '').split(':');
  if (rest.length > 0 || !SORT_KEYS.includes(key as SortKey) || (dir !== 'asc' && dir !== 'desc')) return null;
  return { key: key as SortKey, dir };
}

export function serializeSort(sort: Sort | null): string | null {
  return sort ? `${sort.key}:${sort.dir}` : null;
}

export function parseGroup(raw: string | null): GroupKey {
  return GROUP_KEYS.includes(raw as GroupKey) ? (raw as GroupKey) : 'none';
}

/** A column header click: a new column sorts ascending, then descending, then back to the API's order. */
export function nextSort(current: Sort | null, key: SortKey): Sort | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortValue(server: Server, key: SortKey, ctx: OrderContext): string | number | null {
  switch (key) {
    case 'name':
      return server.name;
    case 'game':
      return server.egg.name;
    case 'location':
      return server.locationName;
    case 'id':
      return server.uuidShort;
    case 'status': {
      const status = ctx.status(server.uuid);
      return status ? STATUS_ORDER.indexOf(status) : null;
    }
  }
  // the rows only show live values while the server runs, so a stopped one has none to sort by
  const usage = ctx.usage(server.uuid);
  if (usage?.state !== 'running') return null;
  return key === 'cpu' ? usage.cpuAbsolute : key === 'ram' ? usage.memoryBytes : usage.uptime;
}

/** Missing values (no live stats, no status yet) go last in either direction. */
function compareValues(a: string | number | null, b: string | number | null, dir: SortDir): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
  return dir === 'asc' ? order : -order;
}

/** A sorted copy; equal servers keep the API's order. Without a sort the list comes back as it was. */
export function sortServers(servers: Server[], sort: Sort | null, ctx: OrderContext): Server[] {
  if (!sort) return servers;
  const values = new Map(servers.map((server) => [server.uuid, sortValue(server, sort.key, ctx)]));
  return [...servers].sort((a, b) => compareValues(values.get(a.uuid) ?? null, values.get(b.uuid) ?? null, sort.dir));
}

/**
 * Splits an already sorted list into groups, each keeping that order. Groups go by name (statuses in
 * STATUS_ORDER), following the sort's direction when the list is sorted by the same field.
 */
export function groupServers(servers: Server[], group: GroupKey, sort: Sort | null, ctx: OrderContext): ServerGroup[] {
  if (group === 'none') return [{ key: 'all', label: '', servers }];

  const groups = new Map<string, ServerGroup>();
  for (const server of servers) {
    const status = group === 'status' ? (ctx.status(server.uuid) ?? 'other') : '';
    const [key, label] =
      group === 'location'
        ? [server.locationUuid, server.locationName]
        : group === 'game'
          ? [server.egg.uuid, server.egg.name]
          : [status, status];
    const existing = groups.get(key);
    if (existing) existing.servers.push(server);
    else groups.set(key, { key, label, servers: [server] });
  }

  const dir = sort?.key === group ? sort.dir : 'asc';
  return [...groups.values()].sort((a, b) =>
    group === 'status'
      ? compareValues(STATUS_ORDER.indexOf(a.key as RowStatus), STATUS_ORDER.indexOf(b.key as RowStatus), dir)
      : compareValues(a.label, b.label, dir) || collator.compare(a.key, b.key),
  );
}
