import { useMemo } from 'react';
import { getMapOverlayInsets, type MapOverlayInsets } from '../utils/mapOverlayLayout';
import { useIsLargeDisplay } from './useIsLargeDisplay';

/** Horizontal insets that keep map overlays clear of the large-display panel. */
export function useMapOverlayInsets(): MapOverlayInsets {
  const isLarge = useIsLargeDisplay();
  return useMemo(() => getMapOverlayInsets(isLarge), [isLarge]);
}
