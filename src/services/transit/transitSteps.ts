import type { OtpItinerary, OtpLeg } from '../../models/transit';

/** A single user-facing step in a transit itinerary. */
export interface TransitStep {
  index: number;
  kind: 'walk' | 'bike' | 'transit';
  mode: string;
  /** Primary line (e.g. "Bus 12 to Downtown"). */
  title: string;
  /** Secondary line (board stop, stop count, or distance). */
  detail?: string;
  startTime: number;
  endTime: number;
  duration: number;
  distanceMeters: number;
  routeColor?: string;
  routeRef?: string;
  headsign?: string;
}

function transitLegTitle(leg: OtpLeg): string {
  const ref = leg.route?.shortName ?? leg.route?.longName;
  const toward = leg.headsign ?? leg.to.name;
  if (ref) return `${ref} to ${toward}`;
  return `${leg.mode} to ${toward}`;
}

function legToStep(leg: OtpLeg, index: number): TransitStep {
  if (leg.mode === 'WALK' || leg.mode === 'BICYCLE') {
    const kind = leg.mode === 'BICYCLE' ? 'bike' : 'walk';
    return {
      index,
      kind,
      mode: leg.mode,
      title: `${kind === 'bike' ? 'Bike' : 'Walk'} to ${leg.to.name}`,
      detail: `${Math.round(leg.distance)} m`,
      startTime: leg.startTime,
      endTime: leg.endTime,
      duration: leg.duration,
      distanceMeters: leg.distance,
      routeColor: undefined,
    };
  }

  const stopCount = leg.intermediateStops?.length ?? 0;
  return {
    index,
    kind: 'transit',
    mode: leg.mode,
    title: transitLegTitle(leg),
    detail: `Board at ${leg.from.name}${stopCount > 0 ? ` · ${stopCount + 1} stops` : ''}`,
    startTime: leg.startTime,
    endTime: leg.endTime,
    duration: leg.duration,
    distanceMeters: leg.distance,
    routeColor: leg.route?.color,
    routeRef: leg.route?.shortName,
    headsign: leg.headsign,
  };
}

/**
 * Convert an itinerary into an ordered list of steps for the transit
 * step-through view. Returns an empty array for a missing itinerary.
 */
export function buildTransitSteps(itinerary: OtpItinerary | null | undefined): TransitStep[] {
  if (!itinerary) return [];
  return itinerary.legs.map((leg, index) => legToStep(leg, index));
}
