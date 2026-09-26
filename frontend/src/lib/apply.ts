import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { getUserSetting } from '@/lib/userSettings.ts';
import { useUserSettingsStore } from '@/stores/userSettings.ts';
import { normalizeChoices, resolveUserTheme, THEME_CHOICE_KEY, type ThemeChoice } from './library.ts';
import { buildCss, DEFAULT_THEME, type NebulaTheme, normalizeTheme } from './theme.ts';

const STYLE_ID = 'nebula-theme';
const CACHE_KEY = 'nebula:theme';
const CHOICES_CACHE_KEY = 'nebula:theme-choices';
const PREVIEW_MSG = 'nebula:preview';
export const READY_MSG = 'nebula:ready';

let saved: NebulaTheme = DEFAULT_THEME;
let current: NebulaTheme = DEFAULT_THEME;
let previewing = false;
const listeners = new Set<() => void>();
/** The presets users may pick, from the public theme route. */
let choices: ThemeChoice[] = [];
/** Set when core unloads the user's settings (sign out); the replica core hydrates at startup counts until then. */
let signedOut = false;
/** Pages that always show the site theme: auth pages, the editor, its preview frame. */
let siteHolds = 0;
let shownKey = '';
/**
 * A first visit has no cached theme: the page stays hidden (`data-nebula-pending`, app.css) until loadTheme()
 * settles, and at most this long, so a slow or failing request never leaves it blank.
 */
const PENDING_MS = 1500;
let pendingTimer: number | undefined;

export const savedTheme = () => saved;

/** The theme on screen right now, a draft included while the editor previews one. */
export const currentTheme = () => current;

export const subscribeTheme = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** So pages like Home re-render when the editor previews a draft. */
export const useNebulaTheme = () => useSyncExternalStore(subscribeTheme, currentTheme);

/** The presets the account page offers; re-renders with the theme. */
export const useThemeChoices = () => useSyncExternalStore(subscribeTheme, () => choices);

// one schema instance, core caches parsed settings per schema
const CHOICE_SCHEMA = z.string();

/** What decides between the site theme and the user's pick; a repaint is only needed when it changes. */
function userKey() {
  if (signedOut || siteHolds > 0) return '';
  return getUserSetting(THEME_CHOICE_KEY, CHOICE_SCHEMA, '');
}

/** The site theme, or the preset the user picked while it is still offered. */
function repaint() {
  shownKey = userKey();
  if (previewing || pendingTimer !== undefined) return;
  applyTheme(resolveUserTheme(saved, choices, shownKey) ?? saved);
}

/** Ends the first visit guard with whatever is known by then; applyTheme() shows the page. */
function reveal() {
  if (pendingTimer === undefined) return;
  window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
  repaint();
}

/** Shows the site theme instead of the user's pick until the returned release runs. */
export function holdSiteTheme(): () => void {
  siteHolds++;
  repaint();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    siteHolds--;
    repaint();
  };
}

/** Follows the user's pick live (the account page, other tabs through core's replica) and sign in and out. */
export function watchUserTheme() {
  useUserSettingsStore.subscribe((state, prev) => {
    if (state.userUuid) signedOut = false;
    else if (prev.userUuid) signedOut = true;
    if (userKey() !== shownKey) repaint();
  });
}

const FAVICON_CLASS = 'nebula-favicon';
const PANEL_ICONS = 'link[rel~="icon"],link[rel="apple-touch-icon"]';
let favicon = '';

/**
 * `favicon`: core's own icon links (`.app-icon`, whose href its App sets from `settings.app.icon`) are parked under
 * another rel rather than edited, so core can keep updating them and clearing the option restores them as they are.
 */
function applyFavicon(href: string) {
  if (href === favicon) return;
  favicon = href;
  for (const link of document.head.querySelectorAll(`link.${FAVICON_CLASS}`)) link.remove();

  if (!href) {
    for (const link of document.head.querySelectorAll<HTMLLinkElement>('link[data-nebula-rel]')) {
      link.rel = link.dataset.nebulaRel ?? 'icon';
      delete link.dataset.nebulaRel;
    }
    return;
  }
  for (const link of document.head.querySelectorAll<HTMLLinkElement>(PANEL_ICONS)) {
    link.dataset.nebulaRel = link.rel;
    link.rel = 'nebula-parked-icon';
  }
  for (const rel of ['icon', 'apple-touch-icon']) {
    const link = document.createElement('link');
    link.className = FAVICON_CLASS;
    link.rel = rel;
    link.href = href;
    document.head.appendChild(link);
  }
}

function applyTheme(theme: NebulaTheme) {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildCss(theme);
  // the layout names for static CSS to key off (the menu styles' rail tweaks); buildCss scopes its own rules
  document.documentElement.dataset.nebulaLayout = theme.sidebarLayout;
  document.documentElement.dataset.nebulaDock = theme.dockPosition;
  applyFavicon(theme.favicon);
  current = theme;
  delete document.documentElement.dataset.nebulaPending;
  for (const listener of listeners) listener();
}

export function rememberTheme(theme: NebulaTheme) {
  saved = theme;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
  } catch {
    // private mode or full storage, the next load waits for the fetch again
  }
  repaint();
}

function rememberChoices(list: ThemeChoice[]) {
  choices = list;
  try {
    localStorage.setItem(CHOICES_CACHE_KEY, JSON.stringify(list));
  } catch {
    // as above
  }
  // the preview frame paints drafts only, but its account page still lists the choices
  if (previewing) for (const listener of listeners) listener();
}

/** Paints the last known theme (or the user's pick) right away so a custom look doesn't flash in after the fetch. */
export function applyCachedTheme() {
  let cachedTheme: string | null = null;
  try {
    cachedTheme = localStorage.getItem(CACHE_KEY);
    saved = normalizeTheme(JSON.parse(cachedTheme ?? 'null'));
  } catch {
    saved = DEFAULT_THEME;
  }
  try {
    // cached as normalizeChoices() returned it, which only keeps what it can read back
    const cached = JSON.parse(localStorage.getItem(CHOICES_CACHE_KEY) ?? '[]') as ThemeChoice[];
    choices = Array.isArray(cached)
      ? cached.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      : [];
  } catch {
    choices = [];
  }
  // painting the default would only swap to the real look a moment later
  if (cachedTheme === null) {
    document.documentElement.dataset.nebulaPending = '';
    pendingTimer = window.setTimeout(reveal, PENDING_MS);
  }
  repaint();
}

/** Fetches the site theme and the presets users may pick; resolves to the site theme, never a user's pick. */
export async function loadTheme(): Promise<NebulaTheme | null> {
  try {
    const res = await fetch('/mint/theme', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { theme?: unknown; choices?: unknown };
    const theme = normalizeTheme(data.theme);
    rememberChoices(normalizeChoices(data.choices));
    rememberTheme(theme);
    return theme;
  } catch {
    return null;
  } finally {
    reveal();
  }
}

export type PreviewScheme = 'light' | 'dark';

// Mantine's localStorage colour scheme manager keeps the admin's choice under this key
const SCHEME_KEY = 'mantine-color-scheme-value';
const SCHEME_ATTR = 'data-mantine-color-scheme';
let previewScheme: PreviewScheme | null = null;

/** The editor renders the panel in an iframe and streams drafts into it, with the scheme to show them in. */
export function sendPreview(frame: HTMLIFrameElement | null, theme: NebulaTheme, scheme: PreviewScheme) {
  frame?.contentWindow?.postMessage({ type: PREVIEW_MSG, theme, scheme }, window.location.origin);
}

/**
 * Keeps the preview frame in the scheme the editor asked for. The attribute repaints the CSS; the storage
 * event is Mantine's own cross-tab sync, which moves its React state too (terminal colours, logos).
 */
function holdScheme() {
  const root = document.documentElement;
  if (!previewScheme || root.getAttribute(SCHEME_ATTR) === previewScheme) return;
  root.setAttribute(SCHEME_ATTR, previewScheme);
  window.dispatchEvent(
    new StorageEvent('storage', { key: SCHEME_KEY, newValue: previewScheme, storageArea: localStorage }),
  );
}

export function listenForPreview() {
  if (window.parent === window) return;
  // the editor's preview shows the site theme until its draft arrives, never the admin's own pick
  holdSiteTheme();

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const msg = event.data as { type?: string; theme?: unknown; scheme?: unknown } | null;
    if (msg?.type !== PREVIEW_MSG) return;

    previewing = true;
    applyTheme(normalizeTheme(msg.theme));
    if (msg.scheme === 'light' || msg.scheme === 'dark') {
      previewScheme = msg.scheme;
      holdScheme();
    }
  });

  // the frame shares localStorage with the editor: Mantine persists every scheme change, and a preview's
  // scheme must never become the admin's own
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    if (previewScheme && key === SCHEME_KEY) return;
    setItem.call(this, key, value);
  };
  // Mantine sets the attribute again when it mounts, when the OS scheme flips on 'auto' and from other tabs
  new MutationObserver(holdScheme).observe(document.documentElement, { attributeFilter: [SCHEME_ATTR] });

  // the panel initialises extensions after its settings request, so the editor waits for this before sending
  window.parent.postMessage({ type: READY_MSG }, window.location.origin);
}
