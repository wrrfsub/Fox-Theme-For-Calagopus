// Sorting and grouping of the servers list: the stored choice is read back from localStorage, and servers
// without a value (no live stats, no status yet) must never sort above the ones that have one.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Server } from '../frontend/src/elements/dashboard/ServerRow.tsx';
import {
  groupServers,
  nextSort,
  type OrderContext,
  parseGroup,
  parseSort,
  serializeSort,
  sortServers,
  type Usage,
} from '../frontend/src/elements/dashboard/serverOrder.ts';

const server = (uuid: string, name: string, location = 'Berlin', egg = 'Paper') =>
  ({
    uuid,
    uuidShort: uuid,
    name,
    locationUuid: `loc-${location}`,
    locationName: location,
    egg: { uuid: `egg-${egg}`, name: egg },
  }) as unknown as Server;

const running = (cpu: number): Usage => ({ state: 'running', cpuAbsolute: cpu, memoryBytes: cpu * 10, uptime: cpu });
const names = (list: Server[]) => list.map((entry) => entry.name);

describe('stored choices', () => {
  test('a stored sort round trips', () => {
    assert.deepEqual(parseSort(serializeSort({ key: 'cpu', dir: 'desc' })), { key: 'cpu', dir: 'desc' });
    assert.equal(serializeSort(null), null);
  });

  test('anything unknown falls back to the API order and no grouping', () => {
    for (const raw of [null, '', 'name', 'name:up', 'owner:asc', 'name:asc:x']) assert.equal(parseSort(raw), null);
    assert.equal(parseGroup('node'), 'none');
    assert.equal(parseGroup(null), 'none');
    assert.equal(parseGroup('game'), 'game');
  });
});

describe('header clicks', () => {
  test('cycle ascending, descending, off', () => {
    assert.deepEqual(nextSort(null, 'name'), { key: 'name', dir: 'asc' });
    assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
    assert.equal(nextSort({ key: 'name', dir: 'desc' }, 'name'), null);
  });

  test('another column starts ascending', () => {
    assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'ram'), { key: 'ram', dir: 'asc' });
  });
});

describe('sortServers', () => {
  const list = [server('a', 'srv 10'), server('b', 'Srv 9'), server('c', 'alpha'), server('d', 'beta')];
  const usage: Record<string, Usage> = {
    a: running(50),
    b: { ...running(90), state: 'offline' },
    d: running(5),
  };
  const ctx: OrderContext = { status: () => undefined, usage: (uuid) => usage[uuid] };

  test('no sort keeps the API order', () => {
    assert.deepEqual(names(sortServers(list, null, ctx)), ['srv 10', 'Srv 9', 'alpha', 'beta']);
  });

  test('names compare case insensitively and numbers naturally', () => {
    assert.deepEqual(names(sortServers(list, { key: 'name', dir: 'asc' }, ctx)), ['alpha', 'beta', 'Srv 9', 'srv 10']);
    assert.deepEqual(names(sortServers(list, { key: 'name', dir: 'desc' }, ctx)), ['srv 10', 'Srv 9', 'beta', 'alpha']);
  });

  test('servers without live stats, or not running, go last in both directions', () => {
    assert.deepEqual(names(sortServers(list, { key: 'cpu', dir: 'asc' }, ctx)), ['beta', 'srv 10', 'Srv 9', 'alpha']);
    assert.deepEqual(names(sortServers(list, { key: 'cpu', dir: 'desc' }, ctx)), ['srv 10', 'beta', 'Srv 9', 'alpha']);
  });

  test('status follows the filter order, unreported last', () => {
    const statuses: Record<string, 'running' | 'offline' | 'suspended' | 'other'> = {
      a: 'other',
      b: 'suspended',
      c: 'running',
    };
    const byStatus: OrderContext = { status: (uuid) => statuses[uuid], usage: () => undefined };
    assert.deepEqual(names(sortServers(list, { key: 'status', dir: 'asc' }, byStatus)), [
      'alpha',
      'Srv 9',
      'srv 10',
      'beta',
    ]);
    assert.deepEqual(names(sortServers(list, { key: 'status', dir: 'desc' }, byStatus)), [
      'srv 10',
      'Srv 9',
      'alpha',
      'beta',
    ]);
  });
});

describe('groupServers', () => {
  const ctx: OrderContext = { status: () => undefined, usage: () => undefined };
  const list = [
    server('a', 'one', 'Paris'),
    server('b', 'two', 'Berlin'),
    server('c', 'three', 'Paris'),
    server('d', 'four', 'Amsterdam'),
  ];

  test('no grouping is one group of everything', () => {
    const groups = groupServers(list, 'none', null, ctx);
    assert.equal(groups.length, 1);
    assert.deepEqual(names(groups[0].servers), ['one', 'two', 'three', 'four']);
  });

  test('groups go by name and keep the order inside', () => {
    const groups = groupServers(list, 'location', null, ctx);
    assert.deepEqual(
      groups.map((group) => [group.label, names(group.servers)]),
      [
        ['Amsterdam', ['four']],
        ['Berlin', ['two']],
        ['Paris', ['one', 'three']],
      ],
    );
  });

  test('sorting by the grouped field also orders the groups', () => {
    const groups = groupServers(list, 'location', { key: 'location', dir: 'desc' }, ctx);
    assert.deepEqual(
      groups.map((group) => group.label),
      ['Paris', 'Berlin', 'Amsterdam'],
    );
  });

  test('status groups follow the filter order, unreported servers count as other', () => {
    const statuses: Record<string, 'running' | 'offline'> = { a: 'offline', c: 'running' };
    const groups = groupServers(list, 'status', null, { status: (uuid) => statuses[uuid], usage: () => undefined });
    assert.deepEqual(
      groups.map((group) => [group.key, names(group.servers)]),
      [
        ['running', ['three']],
        ['offline', ['one']],
        ['other', ['two', 'four']],
      ],
    );
  });
});
