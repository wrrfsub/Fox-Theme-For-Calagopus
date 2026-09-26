import {
  faArrowDownShortWide,
  faArrowDownWideShort,
  faList,
  faSort,
  faSortDown,
  faSortUp,
  faTableCellsLarge,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Pagination } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { z } from 'zod';
import getServers from '@/api/server/getServers.ts';
import ActionIcon from '@/elements/ActionIcon.tsx';
import Badge from '@/elements/Badge.tsx';
import { AdminCan } from '@/elements/Can.tsx';
import Card from '@/elements/Card.tsx';
import Group from '@/elements/Group.tsx';
import Checkbox from '@/elements/input/Checkbox.tsx';
import Select from '@/elements/input/Select.tsx';
import Switch from '@/elements/input/Switch.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import SegmentedControl from '@/elements/SegmentedControl.tsx';
import Spinner from '@/elements/Spinner.tsx';
import Text from '@/elements/Text.tsx';
import Title from '@/elements/Title.tsx';
import { queryKeys } from '@/lib/queryKeys.ts';
import type { serverPowerAction } from '@/lib/schemas/server/server.ts';
import BulkActionBar from '@/pages/dashboard/home/BulkActionBar.tsx';
import { useSearchablePaginatedTable } from '@/plugins/resource/useSearchablePaginatedTable.ts';
import { useBulkPowerActions } from '@/plugins/server/useBulkPowerActions.ts';
import { useServerListShowOthers } from '@/plugins/server/useServerListShowOthers.ts';
import { useStartOnGroupedServers } from '@/plugins/server/useStartOnGroupedServers.ts';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { useUserStore } from '@/stores/user.ts';
import ServerCard, { GRID_CLASS } from '../elements/dashboard/ServerCard.tsx';
import ServerRow, { COLUMN_CLASS, COLUMNS, ROW_GRID, type RowStatus } from '../elements/dashboard/ServerRow.tsx';
import {
  GROUP_KEYS,
  GROUP_STORAGE_KEY,
  type GroupKey,
  groupServers,
  LIVE_SORT_KEYS,
  nextSort,
  type OrderContext,
  parseGroup,
  parseSort,
  type ServerGroup,
  SORT_KEYS,
  SORT_STORAGE_KEY,
  type Sort,
  serializeSort,
  sortServers,
} from '../elements/dashboard/serverOrder.ts';
import { useNebulaTheme } from '../lib/apply.ts';
import { useExtTranslations } from '../translations.ts';

type View = 'list' | 'grid';
type Filter = 'all' | RowStatus;
const VIEW_KEY = 'nebula:server-view';
const FILTERS: Filter[] = ['all', 'running', 'offline', 'suspended'];

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remembers a toolbar choice for this browser; `null` forgets it. */
function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // the choice just won't survive a reload
  }
}

export default function ServerList() {
  const { t, tItem } = useTranslations();
  const { t: tExt } = useExtTranslations();
  const theme = useNebulaTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [startOnGrouped] = useStartOnGroupedServers();
  const [showOthers, setShowOthers] = useServerListShowOthers();
  const [view, setView] = useState<View>(() => (stored(VIEW_KEY) === 'grid' ? 'grid' : 'list'));
  const [sort, setSort] = useState<Sort | null>(() => parseSort(stored(SORT_STORAGE_KEY)));
  const [group, setGroup] = useState<GroupKey>(() => parseGroup(stored(GROUP_STORAGE_KEY)));
  const [filter, setFilter] = useState<Filter>('all');
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const { handleBulkPowerAction, bulkActionLoading } = useBulkPowerActions();

  // Each row subscribes to its node through core's useServerStats, which fills this store. The list reads
  // the same store, and only while it sorts by a live value, so it does not re-render on every stats tick.
  const liveSort = sort !== null && LIVE_SORT_KEYS.includes(sort.key);
  const usage = useUserStore((state) => (liveSort ? state.serverResourceUsage : null));

  const {
    data: servers,
    loading,
    search,
    setSearch,
    setPage,
  } = useSearchablePaginatedTable({
    queryKey: queryKeys.user.servers.all(),
    fetcher: (page, query) => getServers(page, query, showOthers),
    deps: [showOthers],
  });

  const onStatus = useCallback(
    (uuid: string, status: RowStatus) =>
      setStatuses((prev) => (prev[uuid] === status ? prev : { ...prev, [uuid]: status })),
    [],
  );

  const changeView = (next: View) => {
    setView(next);
    store(VIEW_KEY, next);
  };
  const changeSort = (next: Sort | null) => {
    setSort(next);
    store(SORT_STORAGE_KEY, serializeSort(next));
  };
  const changeGroup = (next: GroupKey) => {
    setGroup(next);
    store(GROUP_STORAGE_KEY, next);
  };

  // core keeps the grouped list on '/' when the user starts there, so the tabs follow that setting
  const allPath = startOnGrouped ? '/all' : '/';
  const groupedPath = startOnGrouped ? '/' : '/grouped';

  const rows = servers?.data ?? [];
  const matches = (uuid: string) => filter === 'all' || statuses[uuid] === filter;
  // the servers API has no sort parameter, so sorting and grouping order the page that is loaded
  const order: OrderContext = { status: (uuid) => statuses[uuid], usage: (uuid) => usage?.[uuid] };
  const visible = sortServers(
    rows.filter((server) => matches(server.uuid)),
    sort,
    order,
  );
  const groups = groupServers(visible, group, sort, order);
  const pages = Math.ceil((servers?.total ?? 0) / (servers?.perPage || 1));

  // Only what is on screen can be selected. A server hidden by the filter, the search or a page change is
  // dropped for good (it does not come back ticked), and the bar never counts it, even for the one render
  // before the effect prunes the state.
  const visibleIds = visible.map((server) => server.uuid);
  const visibleKey = visibleIds.join(',');
  const chosen = selected.filter((uuid) => visibleIds.includes(uuid));
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  useEffect(() => {
    const keep = new Set(visibleKey.split(','));
    setSelected((prev) => (prev.every((uuid) => keep.has(uuid)) ? prev : prev.filter((uuid) => keep.has(uuid))));
  }, [visibleKey]);

  const onSelect = (uuid: string) => (checked: boolean) =>
    setSelected((prev) =>
      checked ? (prev.includes(uuid) ? prev : [...prev, uuid]) : prev.filter((other) => other !== uuid),
    );

  const onBulkAction = async (action: z.infer<typeof serverPowerAction>) => {
    await handleBulkPowerAction(chosen, action);
    setSelected([]);
  };

  // a group's heading ticks or clears just that group's servers
  const groupHeading = (entry: ServerGroup, className: string) => {
    const ids = entry.servers.map((server) => server.uuid);
    const picked = ids.filter((uuid) => chosen.includes(uuid)).length;
    const name = group === 'status' ? tExt(`servers.filter.${entry.key as RowStatus}`, {}) : entry.label;
    return (
      <div key={`group:${entry.key}`} className={`flex min-w-0 items-center gap-3 ${className}`}>
        <Checkbox
          checked={picked === ids.length}
          indeterminate={picked > 0 && picked < ids.length}
          onChange={() =>
            setSelected((prev) => [
              ...prev.filter((uuid) => !ids.includes(uuid)),
              ...(picked === ids.length ? [] : ids),
            ])
          }
          aria-label={tExt('serverSort.selectGroup', { name })}
        />
        <Text component='h3' fw={600} size='sm' truncate>
          {name}
        </Text>
        <Badge variant='light' color='gray' size='sm' className='shrink-0'>
          {ids.length}
        </Badge>
      </div>
    );
  };
  const grouped = group !== 'none';

  const cards = theme.tableStyle === 'cards';
  // the header's transparent border lines its columns up with the rows' when each row is a bordered card;
  // the table role is only there so the column headers can carry aria-sort
  const listHeader = (
    <div role='table' aria-label={tExt('servers.title', {})}>
      <div
        role='row'
        className={`${ROW_GRID} ${cards ? 'py-2 border border-transparent' : 'py-3 border-b border-(--mantine-color-default-border)'} text-xs font-semibold tracking-wider uppercase text-(--mantine-color-dimmed)`}
      >
        <div role='columnheader'>
          <Checkbox
            checked={allChosen}
            indeterminate={chosen.length > 0 && !allChosen}
            onChange={() => setSelected(allChosen ? [] : visibleIds)}
            aria-label={tExt('servers.selectAll', {})}
          />
        </div>
        {COLUMNS.map((column) => {
          const dir = sort?.key === column ? sort.dir : null;
          return (
            <div
              key={column}
              role='columnheader'
              aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
              className={`min-w-0 ${COLUMN_CLASS[column]} ${column === 'game' ? 'max-md:invisible' : ''}`}
            >
              <button
                type='button'
                onClick={() => changeSort(nextSort(sort, column))}
                className='inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm font-semibold tracking-wider uppercase hover:text-(--mantine-color-text) focus-visible:outline-2 focus-visible:outline-(--mantine-color-blue-filled)'
              >
                <span className='truncate'>{tExt(`servers.column.${column}`, {})}</span>
                <FontAwesomeIcon
                  icon={dir === 'asc' ? faSortUp : dir === 'desc' ? faSortDown : faSort}
                  className={dir ? 'text-(--mantine-color-text)' : 'opacity-40'}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
  // every row and heading stays a sibling, so a row that changes group moves instead of remounting
  const listRows = groups.flatMap((entry) => [
    ...(grouped
      ? [
          groupHeading(
            entry,
            cards
              ? 'px-4 pt-3 border-x border-transparent'
              : 'px-4 py-2 border-b border-(--mantine-color-default-border) bg-(--mantine-color-default-hover)',
          ),
        ]
      : []),
    ...entry.servers.map((server) => (
      <ServerRow
        key={server.uuid}
        server={server}
        art={theme.eggs[server.egg.uuid]?.banner || theme.homeBanner}
        icon={theme.eggs[server.egg.uuid]?.icon}
        card={cards}
        selected={chosen.includes(server.uuid)}
        onSelect={onSelect(server.uuid)}
        onStatus={onStatus}
      />
    )),
  ]);

  return (
    <>
      <Group justify='space-between' align='flex-start' mb='md' wrap='nowrap' className='max-sm:flex-wrap!'>
        <div className='min-w-0'>
          <Title order={2}>{tExt('servers.title', {})}</Title>
          <Text size='sm' c='dimmed'>
            {tExt('servers.subtitle', {})}
          </Text>
        </div>
        <SegmentedControl
          value={pathname === groupedPath ? 'grouped' : 'all'}
          onChange={(value) => navigate(value === 'grouped' ? groupedPath : allPath)}
          data={[
            { value: 'all', label: t('pages.account.home.tabs.allServers.title', {}) },
            { value: 'grouped', label: t('pages.account.home.tabs.groupedServers.title', {}) },
          ]}
        />
      </Group>

      <Group mb='md' gap='sm'>
        <TextInput
          placeholder={t('common.input.search', {})}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='w-full md:w-62.5'
        />
        <Select
          data={FILTERS.map((value) => ({ value, label: tExt(`servers.filter.${value}`, {}) }))}
          value={filter}
          onChange={(value) => setFilter((value as Filter) ?? 'all')}
          w={150}
        />
        <Select
          data={GROUP_KEYS.map((value) => ({ value, label: tExt(`serverSort.group.${value}`, {}) }))}
          value={group}
          onChange={(value) => changeGroup(parseGroup(value))}
          aria-label={tExt('serverSort.groupBy', {})}
          w={170}
        />
        {/* the list's headers sort once every column shows; until then (and in the grid) this does */}
        <div className={`flex items-center gap-1 ${view === 'list' ? 'lg:hidden' : ''}`}>
          <Select
            data={[
              { value: 'none', label: tExt('serverSort.sort.none', {}) },
              ...SORT_KEYS.map((value) => ({ value, label: tExt(`serverSort.sort.${value}`, {}) })),
            ]}
            value={sort?.key ?? 'none'}
            onChange={(value) => {
              const key = SORT_KEYS.find((option) => option === value);
              changeSort(key ? { key, dir: sort?.dir ?? 'asc' } : null);
            }}
            aria-label={tExt('serverSort.sortBy', {})}
            w={160}
          />
          <ActionIcon
            variant='default'
            size='input-sm'
            disabled={!sort}
            onClick={() => sort && changeSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            aria-label={tExt(sort?.dir === 'desc' ? 'serverSort.descending' : 'serverSort.ascending', {})}
          >
            <FontAwesomeIcon icon={sort?.dir === 'desc' ? faArrowDownWideShort : faArrowDownShortWide} />
          </ActionIcon>
        </div>
        <SegmentedControl
          value={view}
          onChange={(value) => changeView(value as View)}
          data={[
            { value: 'list', label: <FontAwesomeIcon icon={faList} aria-label={tExt('servers.view.list', {})} /> },
            {
              value: 'grid',
              label: <FontAwesomeIcon icon={faTableCellsLarge} aria-label={tExt('servers.view.grid', {})} />,
            },
          ]}
        />
        <div className='flex-1' />
        <AdminCan action='servers.read'>
          <Switch
            label={t('pages.account.home.tabs.allServers.page.input.showOtherUsersServers', {})}
            checked={showOthers}
            onChange={(e) => {
              setPage(1);
              setShowOthers(e.currentTarget.checked);
            }}
          />
        </AdminCan>
      </Group>

      {loading ? (
        <Spinner.Centered />
      ) : rows.length === 0 ? (
        <Text c='dimmed'>{t('pages.account.home.noServers', {})}</Text>
      ) : view === 'grid' ? (
        // headings span the whole row whatever the card style's column count, and the cards stay siblings
        <div className={GRID_CLASS[theme.serverCardStyle]}>
          {groups.flatMap((entry) => [
            ...(grouped ? [groupHeading(entry, 'col-span-full px-1 not-first:mt-2')] : []),
            ...entry.servers.map((server) => (
              <ServerCard
                key={server.uuid}
                server={server}
                art={theme.eggs[server.egg.uuid]?.banner || theme.homeBanner}
                variant={theme.serverCardStyle}
                icon={theme.eggs[server.egg.uuid]?.icon}
                selected={chosen.includes(server.uuid)}
                onSelect={onSelect(server.uuid)}
                onStatus={onStatus}
              />
            )),
          ])}
        </div>
      ) : cards ? (
        // the 'cards' table style: every row is a card of its own under a plain header, like core's tables
        <div className='flex flex-col gap-1.5'>
          {listHeader}
          {listRows}
        </div>
      ) : (
        <Card p={0} className='overflow-hidden'>
          {listHeader}
          {listRows}
        </Card>
      )}

      {rows.length > 0 && (
        <Group justify='space-between' mt='md'>
          <Text size='sm' c='dimmed'>
            {tExt('servers.showing', { count: tItem('server', visible.length) })}
          </Text>
          {pages > 1 && <Pagination total={pages} value={servers?.page ?? 1} onChange={setPage} boundaries={1} />}
        </Group>
      )}

      <BulkActionBar
        selectedCount={chosen.length}
        onClear={() => setSelected([])}
        onAction={onBulkAction}
        loading={bulkActionLoading}
      />
    </>
  );
}
