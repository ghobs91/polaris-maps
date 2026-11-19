import React, { useEffect, useMemo, useState } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useMapStore } from '../../stores/mapStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { TOMTOM_FLOW_TILES_BASE_URL } from '../../constants/config';
import {
  MAX_TRAFFIC_TILE_ZOOM,
  MIN_TRAFFIC_TILE_ZOOM,
} from '../../services/traffic/trafficTileMath';
import {
  ensureTrafficTileServer,
  getTrafficTileUrlTemplate,
} from '../../services/traffic/trafficTileService';

/**
 * Resolve the TomTom API key at call time rather than at module import.
 * This guards against the value being empty when the JS bundle evaluates
 * before Expo's env-var inlining completes (e.g. in development builds).
 */
function getTomtomApiKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tomtomApiKey } = require('../../constants/config');
  return typeof tomtomApiKey === 'string' ? tomtomApiKey : '';
}

interface TrafficOverlayProps {
  /** When true, forces the raster layer to opacity 0 (e.g. when traffic is
   *  shown on the route line instead of the whole map). */
  suppressRaster?: boolean;
}

export function TrafficOverlay({ suppressRaster = false }: TrafficOverlayProps) {
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);
  const tileSeedVersion = useTrafficStore((s) => s.trafficTileSeedVersion);
  const [localTemplate, setLocalTemplate] = useState<string | null>(null);

  // Resolve the local tile server URL template once the native module is up.
  //
  // The server is also started by `initTrafficP2P`, but that runs behind
  // `InteractionManager.runAfterInteractions` *and* an awaited remote-config
  // fetch, so the loopback listener came up ~2.5 s after the JS bundle while
  // the overlay was already on screen. Until it did, the raster source pointed
  // straight at the provider: MapLibre downloaded the first viewport of tiles
  // outside our disk cache (so the local server had to buy them all again), and
  // the layer then vanished when the source switched URLs. Starting it here —
  // it is a loopback listener, no network and no consent — closes that window
  // to a tick. `ensureTrafficTileServer` is idempotent.
  //
  // Quick polls and a bounded number of them: if the native module is genuinely
  // missing we stop polling and fall back to TomTom directly rather than
  // leaving a timer running for the life of the screen.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const template = getTrafficTileUrlTemplate();
    if (template) {
      setLocalTemplate(template);
      return;
    }
    void ensureTrafficTileServer().catch(() => {});
    const timer = setInterval(() => {
      attempts += 1;
      const t = getTrafficTileUrlTemplate();
      if (t) {
        clearInterval(timer);
        if (!cancelled) setLocalTemplate(t);
        return;
      }
      if (attempts >= 100) clearInterval(timer);
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const apiKey = getTomtomApiKey();

  const tileUrl = useMemo(() => {
    // Prefer the local P2P/cache-backed tile server when it's running;
    // the seed version cache-busts so MapLibre re-requests tiles after new
    // ones have been seeded into the disk cache.
    if (localTemplate) {
      return `${localTemplate}?v=${tileSeedVersion}`;
    }
    if (!apiKey) return '';
    const encodedKey = encodeURIComponent(apiKey);
    return `${TOMTOM_FLOW_TILES_BASE_URL}/{z}/{x}/{y}.png?key=${encodedKey}&tileSize=256&thickness=3`;
  }, [apiKey, localTemplate, tileSeedVersion]);

  // The TomTom key is only needed by the direct-provider fallback. Requiring it
  // unconditionally used to hide the layer entirely on a device with no key,
  // even when the local tile server was up with P2P/on-device tiles to serve.
  if (!localTemplate && !apiKey) {
    console.warn(
      '[TrafficOverlay] No TomTom API key configured and the local tile server is not running. ' +
        'Set EXPO_PUBLIC_TOMTOM_API_KEY in .env',
    );
    return null;
  }

  // Only mount the raster source when it will actually be visible.  A hidden
  // layer (opacity 0) still makes MapLibre fetch every tile, which spams
  // failed-request errors when the API key is invalid/exhausted (and wastes
  // bandwidth even when it isn't).
  const showRaster = trafficLayerVisible && !suppressRaster;

  // The local server only has tiles once seeding has landed at least one, and
  // MapLibre never re-reads `tileUrlTemplates` on an existing source (the
  // native source is built once), so the seed version is applied as a key
  // instead: changing it rebuilds the source and makes MapLibre actually
  // request the tiles that were just seeded — including retrying tiles that
  // were answered with a 404 before their PNG existed. Without this the layer
  // stayed blank until the map was panned or the layer was toggled.
  const sourceMounted = !localTemplate || tileSeedVersion > 0;

  // Tiles are seeded up to MAX_TRAFFIC_TILE_ZOOM; telling MapLibre to overzoom
  // from there keeps zoomed-in views filled from the deepest level we hold
  // instead of asking for z15+ tiles that were never seeded.
  const maxZoomLevel = localTemplate ? MAX_TRAFFIC_TILE_ZOOM : 18;

  // The lower bound has to match what we seed too. Seeding starts at
  // MIN_TRAFFIC_TILE_ZOOM, so a source that refuses to draw below zoom 6 left
  // the wide view empty while z4 tiles were downloaded for nothing.
  const minZoomLevel = localTemplate ? MIN_TRAFFIC_TILE_ZOOM : 6;

  if (__DEV__) {
    const keyPreview = apiKey.length >= 6 ? apiKey.slice(0, 6) + '...' : '(empty)';
    console.log(
      `[TrafficOverlay] visible=${trafficLayerVisible} suppress=${suppressRaster} ` +
        `mounted=${showRaster && sourceMounted} localServer=${localTemplate ? 'yes' : 'no'} ` +
        `seedVersion=${tileSeedVersion} zoom=${minZoomLevel}-${maxZoomLevel} key=${keyPreview}`,
    );
  }

  if (!showRaster || !sourceMounted) return null;

  return (
    <MapLibreGL.RasterSource
      key={`traffic-tiles-${tileSeedVersion}`}
      id="tomtom-traffic"
      tileUrlTemplates={[tileUrl]}
      tileSize={256}
      minZoomLevel={minZoomLevel}
      maxZoomLevel={maxZoomLevel}
    >
      <MapLibreGL.RasterLayer
        id="tomtom-traffic-layer"
        sourceID="tomtom-traffic"
        style={{ rasterOpacity: 0.7 }}
      />
    </MapLibreGL.RasterSource>
  );
}
