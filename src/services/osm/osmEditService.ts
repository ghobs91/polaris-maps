/**
 * OSM API v0.6 editing service.
 *
 * Workflow: create changeset → update element → close changeset.
 * All requests require a valid OAuth 2.0 Bearer token with `write_api` scope.
 */

const OSM_API = 'https://api.openstreetmap.org';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OsmNodeData {
  id: number;
  lat: number;
  lon: number;
  version: number;
  tags: Record<string, string>;
}

export interface ChangesetResult {
  changesetId: number;
  newVersion: number;
}

// ---------------------------------------------------------------------------
// Fetch the current node from OSM (to get latest version + tags)
// ---------------------------------------------------------------------------

/** Fetch the full current state of an OSM node by ID. */
export async function fetchOsmNode(nodeId: number): Promise<OsmNodeData> {
  const resp = await fetch(`${OSM_API}/api/0.6/node/${nodeId}.json`, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch OSM node ${nodeId} (${resp.status})`);
  }
  const json = (await resp.json()) as {
    elements: Array<{
      type: string;
      id: number;
      lat: number;
      lon: number;
      version: number;
      tags?: Record<string, string>;
    }>;
  };

  const el = json.elements[0];
  if (!el || el.type !== 'node') {
    throw new Error(`OSM response did not contain node ${nodeId}`);
  }
  return {
    id: el.id,
    lat: el.lat,
    lon: el.lon,
    version: el.version,
    tags: el.tags ?? {},
  };
}

// ---------------------------------------------------------------------------
// Changeset lifecycle
// ---------------------------------------------------------------------------

/** Create a new changeset and return its numeric ID. */
export async function createChangeset(accessToken: string, comment: string): Promise<number> {
  const xml = [
    '<osm>',
    '  <changeset>',
    `    <tag k="created_by" v="Polaris Maps"/>`,
    `    <tag k="comment" v="${escapeXml(comment)}"/>`,
    '  </changeset>',
    '</osm>',
  ].join('\n');

  const resp = await fetch(`${OSM_API}/api/0.6/changeset/create`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/xml',
    },
    body: xml,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create changeset (${resp.status}): ${text}`);
  }

  const id = parseInt(await resp.text(), 10);
  if (isNaN(id)) throw new Error('Invalid changeset ID from OSM');
  return id;
}

/** Close an existing changeset. */
export async function closeChangeset(accessToken: string, changesetId: number): Promise<void> {
  const resp = await fetch(`${OSM_API}/api/0.6/changeset/${changesetId}/close`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to close changeset ${changesetId} (${resp.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Element update
// ---------------------------------------------------------------------------

/**
 * Update a node's tags on OSM.
 *
 * The full element with all tags (changed and unchanged) must be sent.
 * The version must match the server's current version (optimistic locking).
 */
export async function updateOsmNode(
  accessToken: string,
  changesetId: number,
  node: OsmNodeData,
): Promise<number> {
  const tagXml = Object.entries(node.tags)
    .map(([k, v]) => `    <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
    .join('\n');

  const xml = [
    '<osm>',
    `  <node changeset="${changesetId}" id="${node.id}" lat="${node.lat}" lon="${node.lon}" version="${node.version}" visible="true">`,
    tagXml,
    '  </node>',
    '</osm>',
  ].join('\n');

  const resp = await fetch(`${OSM_API}/api/0.6/node/${node.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/xml',
    },
    body: xml,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to update node ${node.id} (${resp.status}): ${text}`);
  }

  const newVersion = parseInt(await resp.text(), 10);
  if (isNaN(newVersion)) throw new Error('Invalid version in OSM response');
  return newVersion;
}

// ---------------------------------------------------------------------------
// High-level: submit tag edits for a single node
// ---------------------------------------------------------------------------

/**
 * Submit updated tags for an OSM node.
 *
 * 1. Fetch the latest node data (version + existing tags)
 * 2. Merge updatedTags into the existing tags
 * 3. Create changeset → update node → close changeset
 *
 * Returns changeset ID and new version number.
 */
export async function submitOsmNodeEdit(
  accessToken: string,
  nodeId: number,
  updatedTags: Record<string, string>,
  comment: string,
): Promise<ChangesetResult> {
  // 1. Get latest state (ensures correct version for optimistic locking)
  const current = await fetchOsmNode(nodeId);

  // 2. Merge tags — new values overwrite, empty strings remove the key
  const merged = { ...current.tags };
  for (const [k, v] of Object.entries(updatedTags)) {
    if (v === '') {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }

  // 3. Create changeset
  const changesetId = await createChangeset(accessToken, comment);

  try {
    // 4. Update the node
    const newVersion = await updateOsmNode(accessToken, changesetId, {
      ...current,
      tags: merged,
    });

    // 5. Close changeset
    await closeChangeset(accessToken, changesetId);

    return { changesetId, newVersion };
  } catch (e) {
    // Best-effort close on failure
    try {
      await closeChangeset(accessToken, changesetId);
    } catch {
      /* ignore close errors */
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
