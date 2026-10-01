import { useCallback, useEffect, useRef, useState } from 'react';
import { findOamCoverage } from '../services/map/oamCoverage';
import { findLatestSentinelScene, type SentinelScene } from '../services/map/sentinelStac';
import {
  BASE_SATELLITE_ATTRIBUTIONS,
  buildViewportSatelliteStyle,
  viewportImageryAttributions,
  viewportRegionalSourceIds,
} from '../services/map/satelliteRuntimeStyle';
import type { BBox } from '../services/map/tileRouter';

interface UseSatelliteViewportStyleArgs {
  /** True while the satellite map type is showing (and not offline/nav). */
  enabled: boolean;
  /** BCP-47 label locale. */
  language?: string;
}

interface SatelliteViewportStyleHandle {
  /**
   * Viewport-scoped satellite style, or `null` while disabled (caller keeps
   * the static style).
   */
  style: string | null;
  /** Attributions of the imagery visible at the last settle. */
  attributions: string[];
  /** Freshest Sentinel-2 scene over the last settle, for the attribution panel. */
  latestScene: SentinelScene | null;
  /** Recompute for a viewport; call on camera settle. */
  update: (bbox: BBox, zoom: number) => void;
}

function sameBBox(a: BBox | null, b: BBox | null): boolean {
  if (!a || !b) return a === b;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/**
 * Builds a viewport-scoped satellite style on camera settle using the tile
 * router, refreshing OpenAerialMap coverage and the latest Sentinel-2 scene in
 * the background.
 *
 * The style is rebuilt only when the set of serving regional providers changes
 * (or OAM coverage resolves differently), so ordinary panning within one
 * provider does not churn `MapView`'s `mapStyle` prop.
 */
export function useSatelliteViewportStyle({
  enabled,
  language,
}: UseSatelliteViewportStyleArgs): SatelliteViewportStyleHandle {
  const [style, setStyle] = useState<string | null>(null);
  const [attributions, setAttributions] = useState<string[]>(BASE_SATELLITE_ATTRIBUTIONS);
  const [latestScene, setLatestScene] = useState<SentinelScene | null>(null);
  const regionalKeyRef = useRef('');
  const coverageRef = useRef<BBox | null>(null);
  const coverageInFlightRef = useRef(false);
  const sceneKeyRef = useRef('');
  const sceneInFlightRef = useRef(false);
  const enabledRef = useRef(enabled);
  const languageRef = useRef(language);
  enabledRef.current = enabled;
  languageRef.current = language;

  // Drop the scoped style when satellite mode ends (or nav/offline takes over).
  useEffect(() => {
    if (enabled) return;
    regionalKeyRef.current = '';
    coverageRef.current = null;
    sceneKeyRef.current = '';
    setStyle(null);
    setAttributions(BASE_SATELLITE_ATTRIBUTIONS);
    setLatestScene(null);
  }, [enabled]);

  const rebuild = useCallback((bbox: BBox, zoom: number) => {
    const coverage = coverageRef.current;
    setStyle(buildViewportSatelliteStyle(bbox, zoom, { coverage, language: languageRef.current }));
    setAttributions(viewportImageryAttributions(bbox, zoom, { coverage }));
  }, []);

  const update = useCallback(
    (bbox: BBox, zoom: number) => {
      if (!enabledRef.current) return;

      const regionalKey = viewportRegionalSourceIds(bbox, zoom).join('|');
      if (regionalKey !== regionalKeyRef.current) {
        regionalKeyRef.current = regionalKey;
        rebuild(bbox, zoom);
      }

      if (!coverageInFlightRef.current) {
        coverageInFlightRef.current = true;
        void findOamCoverage(bbox)
          .then((coverage) => {
            if (!enabledRef.current || sameBBox(coverage, coverageRef.current)) return;
            coverageRef.current = coverage;
            rebuild(bbox, zoom);
          })
          .finally(() => {
            coverageInFlightRef.current = false;
          });
      }

      if (!sceneInFlightRef.current) {
        sceneInFlightRef.current = true;
        void findLatestSentinelScene(bbox)
          .then((scene) => {
            if (!enabledRef.current) return;
            const key = scene?.datetime ?? '';
            if (key === sceneKeyRef.current) return;
            sceneKeyRef.current = key;
            setLatestScene(scene);
          })
          .finally(() => {
            sceneInFlightRef.current = false;
          });
      }
    },
    [rebuild],
  );

  return { style, attributions, latestScene, update };
}
