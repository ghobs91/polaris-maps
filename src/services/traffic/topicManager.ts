import { encode as geohashEncode, neighbors as geohashNeighbors } from '../../utils/geohash';
import { subscribe, unsubscribe } from './wakuBridge';

const DEBOUNCE_MS = 500;
const MAX_TRAFFIC_TOPICS = 25;
const MAX_POI_TOPICS = 9;
const MAX_INCIDENT_TOPICS = 25;

const activeTopics = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function getVisibleGeohash6Cells(
  centerLat: number,
  centerLng: number,
  gridRadius: number,
): string[] {
  const center = geohashEncode(centerLat, centerLng, 6);
  if (gridRadius <= 1) {
    return [center, ...geohashNeighbors(center)];
  }

  // For larger grids, use center + neighbors recursively
  const cells = new Set<string>([center]);
  let frontier = [center];
  for (let i = 0; i < gridRadius; i++) {
    const next: string[] = [];
    for (const cell of frontier) {
      for (const n of geohashNeighbors(cell)) {
        if (!cells.has(n)) {
          cells.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return Array.from(cells);
}

function buildTopics(cells: string[], dataType: string): string[] {
  return cells.map((cell) => `/polaris/1/${dataType}/${cell}/proto`);
}

async function syncSubscriptions(desiredTopics: Set<string>): Promise<void> {
  const toSubscribe = [...desiredTopics].filter((t) => !activeTopics.has(t));
  const toUnsubscribe = [...activeTopics].filter((t) => !desiredTopics.has(t));

  await Promise.all(
    toUnsubscribe.map((t) => {
      activeTopics.delete(t);
      return unsubscribe(t);
    }),
  );

  await Promise.all(
    toSubscribe.map((t) => {
      activeTopics.add(t);
      return subscribe(t);
    }),
  );
}

export function onViewportChange(centerLat: number, centerLng: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    const trafficCells = getVisibleGeohash6Cells(centerLat, centerLng, 2).slice(
      0,
      MAX_TRAFFIC_TOPICS,
    );
    const poiCells = getVisibleGeohash6Cells(centerLat, centerLng, 1).slice(0, MAX_POI_TOPICS);
    const incidentCells = getVisibleGeohash6Cells(centerLat, centerLng, 2).slice(
      0,
      MAX_INCIDENT_TOPICS,
    );

    const desired = new Set<string>([
      ...buildTopics(trafficCells, 'traffic'),
      ...buildTopics(poiCells, 'poi-attestation'),
      ...buildTopics(incidentCells, 'incident'),
    ]);

    await syncSubscriptions(desired);
  }, DEBOUNCE_MS);
}

export async function unsubscribeAll(): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer);
  await Promise.all([...activeTopics].map((t) => unsubscribe(t)));
  activeTopics.clear();
}

export function getActiveTopicCount(): number {
  return activeTopics.size;
}
