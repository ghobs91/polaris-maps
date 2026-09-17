import type { LaneGuidance, ManeuverType, ValhallaManeuver } from '../models/route';

/**
 * Shared native → app maneuver mapping for the Valhalla and MapKit native
 * modules. Both emit the same snake_case shape, so lane/speed/street fields are
 * mapped identically here.
 */
export interface NativeManeuverFields {
  type: string;
  instruction: string;
  distance_meters: number;
  duration_seconds: number;
  begin_shape_index: number;
  end_shape_index: number;
  street_names?: string[];
  verbal_pre_transition: string;
  verbal_post_transition?: string;
  /** Posted speed limit in km/h. */
  speed_limit?: number;
  /** Valhalla lane records (bitmask form) when the engine provides them. */
  lanes?: Array<Record<string, unknown>>;
}

/**
 * Parse native lanes lazily. `parseLaneGuidance` lives in routingService, which
 * imports the native modules — requiring it at call time avoids a module-init
 * cycle while still reusing the single lane-parsing implementation.
 */
function laneGuidanceFor(
  lanes: Array<Record<string, unknown>> | undefined,
  type: ManeuverType,
): LaneGuidance | undefined {
  if (!lanes || lanes.length === 0) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const routing = require('../services/routing/routingService');
    return (routing as typeof import('../services/routing/routingService')).parseLaneGuidance(
      lanes,
      type,
    );
  } catch {
    return undefined;
  }
}

/** Convert a native maneuver payload into a `ValhallaManeuver`. */
export function mapNativeManeuver(m: NativeManeuverFields): ValhallaManeuver {
  const type = m.type as ManeuverType;
  return {
    type,
    instruction: m.instruction,
    distanceMeters: m.distance_meters,
    durationSeconds: m.duration_seconds,
    beginShapeIndex: m.begin_shape_index,
    endShapeIndex: m.end_shape_index,
    streetNames: m.street_names,
    verbalPreTransition: m.verbal_pre_transition,
    verbalPostTransition: m.verbal_post_transition,
    speedLimitMph:
      typeof m.speed_limit === 'number' ? Math.round(m.speed_limit * 0.621371) : undefined,
    laneGuidance: laneGuidanceFor(m.lanes, type),
  };
}
