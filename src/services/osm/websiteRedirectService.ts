/**
 * Reconcile an out-of-date OSM `website` tag with the site's new home.
 *
 * Venues often keep an old domain that silently 301/302-redirects to the domain
 * they actually use now (e.g. `smokedbarn.com` → `smokedbarnofperu.com`). When
 * the place card has already resolved that redirect (by loading the site for its
 * photos), and the user is signed in to OSM with contributions enabled, we update
 * the tagged URL to the new one so OSM stops carrying a stale link.
 *
 * Safety rails — the edit is skipped unless *all* hold:
 *  1. the user is signed in (`accessToken`) and contributions are enabled;
 *  2. the tagged URL and the resolved URL are on different site hosts;
 *  3. both are site roots (`/`), so a deep-link / campaign redirect is ignored;
 *  4. the resolved target is reachable over https;
 *  5. the OSM node still carries the OLD url under `website`/`contact:website`
 *     (we never clobber a value someone else has since corrected);
 *  6. this node hasn't already been synced this session.
 */
import { findOsmPlaceMatch, type OsmPoi } from '../poi/osmFetcher';
import { isOsmNodePoi } from '../../utils/placeToOsmPoi';
import { isCrossHostRedirect, isSiteRoot, normalizeWebsiteUrl } from '../poi/websitePhotosService';
import { fetchOsmNode, submitOsmNodeEdit } from './osmEditService';

export type WebsiteRedirectSyncStatus = 'updated' | 'skipped' | 'error';

export interface WebsiteRedirectSyncParams {
  poi: Pick<OsmPoi, 'id' | 'lat' | 'lng' | 'name' | 'tags'>;
  /** The website value as tagged on the place (OSM `website`/`contact:website`/`url`). */
  taggedWebsite: string;
  /** URL the site finally resolved to (post-redirect). */
  finalUrl: string;
  /** OSM OAuth token with write scope, when the user is signed in. */
  accessToken: string | null;
  /** Whether the user has POI contributions enabled. */
  canEdit: boolean;
}

/** OSM website tags, in priority order. */
const WEBSITE_TAGS = ['website', 'contact:website'] as const;

/** Nodes already synced this session → the new URL, to avoid repeat edits. */
const syncedNodes = new Map<number, string>();
/** Nodes currently being edited, to collapse concurrent triggers. */
const inFlightNodes = new Set<number>();

/** Clear session state (exposed for tests). */
export function clearWebsiteRedirectSyncState(): void {
  syncedNodes.clear();
  inFlightNodes.clear();
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.replace(/\/+$/, '') : url;
}

/**
 * Update an OSM node's website tag to the resolved (redirected) URL.
 *
 * Best-effort: returns `skipped` for every "not applicable" case and never
 * throws, so a failed reconciliation can't disturb the place card.
 */
export async function syncOsmWebsiteFromRedirect(
  params: WebsiteRedirectSyncParams,
): Promise<WebsiteRedirectSyncStatus> {
  const { poi, taggedWebsite, finalUrl, accessToken, canEdit } = params;
  if (!canEdit || !accessToken) return 'skipped';

  const tagged = normalizeWebsiteUrl(taggedWebsite);
  const resolved = normalizeWebsiteUrl(finalUrl);
  if (!tagged || !resolved) return 'skipped';
  if (!isCrossHostRedirect(tagged, resolved)) return 'skipped';
  // Only a move of the whole site is trustworthy (not a path/campaign redirect).
  if (!isSiteRoot(tagged) || !isSiteRoot(resolved)) return 'skipped';

  const target = stripTrailingSlash(resolved);
  if (target === stripTrailingSlash(tagged)) return 'skipped';

  let nodeId: number | null = null;
  try {
    if (isOsmNodePoi(poi)) {
      nodeId = poi.id;
    } else {
      const match = await findOsmPlaceMatch(poi.lat, poi.lng, poi.name, poi.tags);
      if (match?.type === 'node') nodeId = match.id;
    }
  } catch {
    return 'skipped';
  }
  if (!nodeId) return 'skipped';
  if (syncedNodes.get(nodeId) === target || inFlightNodes.has(nodeId)) return 'skipped';

  inFlightNodes.add(nodeId);
  try {
    const node = await fetchOsmNode(nodeId);
    // Only edit when the node still carries the redirecting URL under a website
    // tag — never clobber a value someone else has since corrected.
    const tag = WEBSITE_TAGS.find((key) => normalizeWebsiteUrl(node.tags[key]) === tagged);
    if (!tag) return 'skipped';
    if (normalizeWebsiteUrl(node.tags[tag]) === target) {
      syncedNodes.set(nodeId, target);
      return 'skipped';
    }
    await submitOsmNodeEdit(
      accessToken,
      nodeId,
      { [tag]: target },
      `Updated website: ${tagged} now redirects to ${target}`,
    );
    syncedNodes.set(nodeId, target);
    return 'updated';
  } catch {
    return 'error';
  } finally {
    inFlightNodes.delete(nodeId);
  }
}
