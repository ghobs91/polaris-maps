/**
 * Website action links via on-device headless browsing.
 *
 * Mirrors `websitePhotosService`: fetch the venue homepage HTML (no JS
 * execution) and detect links for online ordering, table reservations, and
 * menus so they can be surfaced as one-tap actions on the place card.
 *
 * Detection order, strongest signal first:
 *  1. JSON-LD (`hasMenu`, `potentialAction` Order/Reserve actions)
 *  2. Known ordering/reservation provider hostnames
 *  3. URL path / anchor-text keywords
 *
 * Only http(s) URLs are ever returned; results are cached in-memory.
 */

export type WebsiteActionKind = 'order' | 'reserve' | 'menu';

export interface WebsiteAction {
  kind: WebsiteActionKind;
  url: string;
  /** Provider/brand name when the URL matches a known platform. */
  provider?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

interface CacheEntry {
  actions: WebsiteAction[];
  expiresAt: number;
}

const actionCache = new Map<string, CacheEntry>();

export function clearWebsiteActionsCache(): void {
  actionCache.clear();
}

function getCached(url: string): WebsiteAction[] | null {
  const entry = actionCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    actionCache.delete(url);
    return null;
  }
  return entry.actions;
}

function setCached(url: string, actions: WebsiteAction[]): void {
  if (actionCache.size >= MAX_CACHE_ENTRIES) {
    const first = actionCache.keys().next().value;
    if (first !== undefined) actionCache.delete(first);
  }
  actionCache.set(url, { actions, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Known third-party platforms, mapping hostname fragment → action + label. */
const PROVIDER_MATCHERS: Array<{ match: RegExp; kind: WebsiteActionKind; provider: string }> = [
  { match: /(^|\.)doordash\.com$/, kind: 'order', provider: 'DoorDash' },
  { match: /(^|\.)ubereats\.com$/, kind: 'order', provider: 'Uber Eats' },
  { match: /(^|\.)grubhub\.com$/, kind: 'order', provider: 'Grubhub' },
  { match: /(^|\.)seamless\.com$/, kind: 'order', provider: 'Seamless' },
  { match: /(^|\.)chownow\.com$/, kind: 'order', provider: 'ChowNow' },
  { match: /(^|\.)toasttab\.com$/, kind: 'order', provider: 'Toast' },
  { match: /(^|\.)order\.online$/, kind: 'order', provider: 'Order Online' },
  { match: /(^|\.)eatstreet\.com$/, kind: 'order', provider: 'EatStreet' },
  { match: /(^|\.)slice\.com$/, kind: 'order', provider: 'Slice' },
  { match: /(^|\.)postmates\.com$/, kind: 'order', provider: 'Postmates' },
  { match: /(^|\.)deliveroo\./, kind: 'order', provider: 'Deliveroo' },
  { match: /(^|\.)just-eat\./, kind: 'order', provider: 'Just Eat' },
  { match: /(^|\.)opentable\.com$/, kind: 'reserve', provider: 'OpenTable' },
  { match: /(^|\.)resy\.com$/, kind: 'reserve', provider: 'Resy' },
  { match: /(^|\.)exploretock\.com$/, kind: 'reserve', provider: 'Tock' },
  { match: /(^|\.)tock\.com$/, kind: 'reserve', provider: 'Tock' },
  { match: /(^|\.)sevenrooms\.com$/, kind: 'reserve', provider: 'SevenRooms' },
  { match: /(^|\.)resdiary\.com$/, kind: 'reserve', provider: 'ResDiary' },
];

const ORDER_KEYWORDS =
  /\border(?:ing)?\b|order\s*online|pick\s*-?\s*up|take\s*-?\s*out|takeaway|delivery/i;
const RESERVE_KEYWORDS = /reserv|book\s*(?:a|your)?\s*table|book\s*now|booking|request\s*table/i;
const MENU_KEYWORDS = /\bmenu\b|food\s*menu|dining\s*menu|our\s*menu|speisekarte|\bcarte\b/i;

function kindFromKeywords(pathAndText: string): WebsiteActionKind | null {
  if (ORDER_KEYWORDS.test(pathAndText)) return 'order';
  if (RESERVE_KEYWORDS.test(pathAndText)) return 'reserve';
  if (MENU_KEYWORDS.test(pathAndText)) return 'menu';
  return null;
}

function providerFor(url: URL): { kind: WebsiteActionKind; provider: string } | null {
  for (const entry of PROVIDER_MATCHERS) {
    if (entry.match.test(url.hostname)) return { kind: entry.kind, provider: entry.provider };
  }
  return null;
}

/** Resolve a raw href to an absolute http(s) URL, or null when unusable. */
export function resolveActionUrl(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:')
  ) {
    return null;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Strip tags/entities from an anchor's inner HTML so keywords can match. */
function anchorText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract candidate action links from `<a>` tags. */
export function extractActionLinksFromHtml(html: string, baseUrl: string): WebsiteAction[] {
  const out: WebsiteAction[] = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const resolved = resolveActionUrl(m[1] ?? '', baseUrl);
    if (!resolved) continue;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(resolved);
    } catch {
      continue;
    }
    const text = anchorText(m[2] ?? '');
    const provider = providerFor(parsedUrl);
    if (provider) {
      out.push({ kind: provider.kind, url: resolved, provider: provider.provider });
      continue;
    }
    const kind = kindFromKeywords(`${parsedUrl.pathname} ${text}`);
    if (kind) out.push({ kind, url: resolved });
  }
  return out;
}

interface JsonLdNode {
  '@type'?: string | string[];
  hasMenu?: unknown;
  menu?: unknown;
  potentialAction?: unknown;
}

function jsonLdUrl(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as { url?: unknown; '@id'?: unknown; urlTemplate?: unknown };
    if (typeof obj.url === 'string') return obj.url;
    if (typeof obj['@id'] === 'string') return obj['@id'];
    if (typeof obj.urlTemplate === 'string') return obj.urlTemplate;
  }
  return null;
}

function actionTypeKind(type: string): WebsiteActionKind | null {
  if (/OrderAction/i.test(type)) return 'order';
  if (/ReserveAction|ReservationAction/i.test(type)) return 'reserve';
  if (/ViewAction|MenuAction/i.test(type)) return 'menu';
  return null;
}

/** Extract `hasMenu` / `potentialAction` hints from JSON-LD blocks. */
export function extractJsonLdActions(html: string, baseUrl: string): WebsiteAction[] {
  const out: WebsiteAction[] = [];
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    let data: unknown;
    try {
      data = JSON.parse((m[1] ?? '').trim());
    } catch {
      continue;
    }
    const nodes: JsonLdNode[] = Array.isArray(data)
      ? (data as JsonLdNode[])
      : typeof data === 'object' && data !== null
        ? [data as JsonLdNode]
        : [];
    for (const node of nodes) {
      const menuRaw = node.hasMenu ?? node.menu;
      const menuUrl = jsonLdUrl(menuRaw);
      const resolvedMenu = menuUrl ? resolveActionUrl(menuUrl, baseUrl) : null;
      if (resolvedMenu) out.push({ kind: 'menu', url: resolvedMenu });

      const potential = node.potentialAction;
      const actions = Array.isArray(potential) ? potential : potential ? [potential] : [];
      for (const action of actions) {
        if (!action || typeof action !== 'object') continue;
        const a = action as { '@type'?: unknown; target?: unknown };
        const type = typeof a['@type'] === 'string' ? a['@type'] : '';
        const kind = actionTypeKind(type);
        const targetUrl = jsonLdUrl(a.target);
        const resolved = targetUrl ? resolveActionUrl(targetUrl, baseUrl) : null;
        if (kind && resolved) out.push({ kind, url: resolved });
      }
    }
  }
  return out;
}

/**
 * Parse order / reserve / menu actions from raw HTML, keeping the first
 * (strongest) candidate per kind. Pure function — unit-testable.
 */
export function parseWebsiteActionsFromHtml(html: string, baseUrl: string): WebsiteAction[] {
  const jsonLd = extractJsonLdActions(html, baseUrl);
  const links = extractActionLinksFromHtml(html, baseUrl);
  const byKind = new Map<WebsiteActionKind, WebsiteAction>();
  for (const action of [...jsonLd, ...links]) {
    if (!byKind.has(action.kind)) byKind.set(action.kind, action);
  }
  return [...byKind.values()];
}

/**
 * Fetch and detect order / reserve / menu actions for a venue website.
 * Returns [] on any failure. Results are cached in-memory.
 */
export async function fetchWebsiteActions(
  pageUrl: string,
  timeoutMs = 8000,
): Promise<WebsiteAction[]> {
  const cached = getCached(pageUrl);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) return [];
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !/html/i.test(contentType)) return [];
    const html = (await res.text()).slice(0, 500_000);
    const actions = parseWebsiteActionsFromHtml(html, pageUrl);
    setCached(pageUrl, actions);
    return actions;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
