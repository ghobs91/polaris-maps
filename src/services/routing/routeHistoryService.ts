import { getDatabase } from '../database/init';
import type { RouteHistory, RouteMode } from '../../models/routeHistory';

export async function saveRoute(route: Omit<RouteHistory, 'createdAt'>): Promise<void> {
  const db = await getDatabase();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT INTO route_history (id, origin_lat, origin_lng, origin_name, destination_lat, destination_lng, destination_name, mode, distance_meters, duration_seconds, route_geometry, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      route.id,
      route.originLat,
      route.originLng,
      route.originName,
      route.destinationLat,
      route.destinationLng,
      route.destinationName,
      route.mode,
      route.distanceMeters,
      route.durationSeconds,
      route.routeGeometry,
      now,
    ],
  );
}

export async function listRoutes(limit: number = 20): Promise<RouteHistory[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RouteHistoryRow>(
    'SELECT * FROM route_history ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
  return rows.map(rowToRouteHistory);
}

export async function getRoute(id: string): Promise<RouteHistory | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<RouteHistoryRow>('SELECT * FROM route_history WHERE id = ?', [
    id,
  ]);
  return row ? rowToRouteHistory(row) : null;
}

export async function deleteRoute(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM route_history WHERE id = ?', [id]);
}

export async function clearHistory(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM route_history');
}

interface RouteHistoryRow {
  id: string;
  origin_lat: number;
  origin_lng: number;
  origin_name: string | null;
  destination_lat: number;
  destination_lng: number;
  destination_name: string | null;
  mode: string;
  distance_meters: number;
  duration_seconds: number;
  route_geometry: string;
  created_at: number;
}

function rowToRouteHistory(row: RouteHistoryRow): RouteHistory {
  return {
    id: row.id,
    originLat: row.origin_lat,
    originLng: row.origin_lng,
    originName: row.origin_name,
    destinationLat: row.destination_lat,
    destinationLng: row.destination_lng,
    destinationName: row.destination_name,
    mode: row.mode as RouteMode,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    routeGeometry: row.route_geometry,
    createdAt: row.created_at,
  };
}
