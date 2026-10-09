/**
 * TypeScript types for Overture Maps Foundation Places schema.
 * Based on schema v2.0.0 (2026-09-23 release), which removed the `categories`
 * property in favour of `basic_category` and `taxonomy`.
 * See: https://docs.overturemaps.org/schema/reference/places/place/
 */

/** A single Overture place GeoJSON feature. */
export interface OverturePlace {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: OverturePlaceProperties;
}

export interface OverturePlaceProperties {
  id: string;
  version?: number;
  names?: OvertureNames;
  /** Removed in schema v2.0.0 (2026-09). Kept for legacy region packs. */
  categories?: OvertureCategories;
  basic_category?: string;
  taxonomy?: OvertureTaxonomy;
  confidence?: number;
  websites?: string[];
  socials?: string[];
  emails?: string[];
  phones?: string[];
  brand?: OvertureBrand;
  addresses?: OvertureAddress[];
  operating_status?: 'open' | 'temporarily_closed' | 'permanently_closed';
  sources?: OvertureSource[];
}

export interface OvertureNames {
  primary?: string;
  common?: Record<string, string> | null;
  rules?: unknown[] | null;
}

export interface OvertureCategories {
  primary?: string;
  alternate?: string[];
}

export interface OvertureTaxonomy {
  hierarchy?: string[];
  primary?: string;
  /** Current field name (schema v2.0.0+). */
  alternates?: string[];
  /** Legacy singular spelling, retained for older region packs. */
  alternate?: string[];
}

export interface OvertureBrand {
  wikidata?: string | null;
  names?: OvertureNames;
}

export interface OvertureAddress {
  freeform?: string;
  locality?: string;
  postcode?: string;
  region?: string;
  country?: string;
}

export interface OvertureSource {
  property?: string;
  dataset?: string;
  record_id?: string;
  update_time?: string;
  confidence?: number;
}

/** Response from an Overture GeoJSON endpoint or imported file. */
export interface OverturePlaceCollection {
  type: 'FeatureCollection';
  features: OverturePlace[];
}
