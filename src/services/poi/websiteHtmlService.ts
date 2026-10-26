/**
 * Shared venue-website HTML fetch.
 *
 * Several detectors need the same page: `websiteActionsService` reads the
 * order/reserve/menu links and `cuisineOriginService` looks for the about/story
 * link. Without sharing, opening one place card issues the homepage twice.
 *
 * This module de-duplicates concurrent requests for the same URL (single
 * flight), so both detectors await one network GET. Response bodies are not
 * retained after the request settles — each service already owns its own
 * result cache, and holding raw HTML would be needlessly heavy on device.
 */

export interface WebsitePage {
  html: string;
  /** Post-redirect URL, so relative links resolve against the final host. */
  url: string;
}

const MAX_HTML_CHARS = 500_000;

/**
 * Identifying User-Agent for scrapes. React Native supplies a default
 * (`<App>/<ver> CFNetwork/…`), but several venue WAFs (notably Squarespace)
 * reject requests with no UA outright, so send one explicitly — matching the
 * other network services in the repo.
 */
const USER_AGENT = 'PolarisMaps/1.0';

const inFlight = new Map<string, Promise<WebsitePage | null>>();

async function requestHtml(pageUrl: string, timeoutMs: number): Promise<WebsitePage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !/html/i.test(contentType)) return null;
    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    return { html, url: (res as { url?: string }).url || pageUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a page once per in-flight URL. The first caller's timeout wins while a
 * request is shared; returns null on any network, HTTP, or content-type error.
 */
export function fetchWebsiteHtml(pageUrl: string, timeoutMs = 8000): Promise<WebsitePage | null> {
  const existing = inFlight.get(pageUrl);
  if (existing) return existing;

  const request = requestHtml(pageUrl, timeoutMs).finally(() => {
    inFlight.delete(pageUrl);
  });
  inFlight.set(pageUrl, request);
  return request;
}

/** Drop in-flight requests (tests only). */
export function clearWebsiteHtmlInFlight(): void {
  inFlight.clear();
}
