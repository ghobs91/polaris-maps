/**
 * Dynamic Type caps for dense, map-anchored overlays.
 *
 * Content screens (settings, details) scale text fully. Dense overlays that
 * are pinned to map features (POI labels, cluster counts, map chrome) get a
 * small cap so accessibility text sizes don't turn the map into an unreadable
 * pile or clip fixed-size badges.
 */
export const MAX_FONT_SCALE_DENSE = 1.2;
export const MAX_FONT_SCALE_CHROME = 1.4;
