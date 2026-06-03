/**
 * Open Charge Map API integration for EV charging station data.
 * https://openchargemap.org/site/develop/api
 */

const API_BASE = 'https://api.openchargemap.io/v3/poi';
const API_KEY = process.env.OPEN_CHARGE_MAP_API_KEY ?? '';

export interface ChargingConnection {
  type: string;
  powerKW: number | null;
  isFastCharge: boolean;
}

export interface ChargingStation {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  operator: string | null;
  network: string | null;
  connections: ChargingConnection[];
  pricing: string | null;
  accessType: 'public' | 'private' | 'members_only' | 'unknown';
  isOpen24Hours: boolean;
  lastUpdated: string | null;
  statusUrl: string | null;
}

interface OCMConnection {
  ConnectionTypeID: number | null;
  LevelID: number | null;
  PowerKW: number | null;
  Quantity: number | null;
}

interface OCMAddress {
  Title: string | null;
  AddressLine1: string | null;
  AddressLine2: string | null;
  Town: string | null;
  StateOrProvince: string | null;
  Postcode: string | null;
  Country: { Title: string } | null;
  Latitude: number;
  Longitude: number;
}

interface OCMOperator {
  Title: string | null;
}

interface OCMStatusType {
  Title: string | null;
  IsOperational: boolean | null;
}

interface OCMPoi {
  ID: number;
  AddressInfo: OCMAddress;
  OperatorInfo: OCMOperator | null;
  Connections: OCMConnection[] | null;
  StatusType: OCMStatusType | null;
  DateLastStatusUpdate: string | null;
  GeneralComments: string | null;
}

/** Map Open Charge Map connection type IDs to human-readable names */
const CONNECTION_TYPES: Record<number, string> = {
  1: 'NEMA 5-15 (Standard)',
  2: 'NEMA 5-20',
  3: 'NEMA 14-50',
  4: 'NEMA 6-50',
  5: 'NEMA 14-30',
  6: 'NEMA 10-50',
  7: 'NEMA 10-30',
  8: 'J1772 (Level 2)',
  9: 'CCS/SAE Combo',
  10: 'CHAdeMO',
  11: 'Tesla (NACS)',
  12: 'Tesla Supercharger',
  13: 'Tesla Destination',
  14: 'Type 2 (Mennekes)',
  15: 'Type 2 Tethered',
  16: 'Blue Commando (IEC 60309)',
  17: 'Schuko (Domestic)',
  18: 'Type 1 (J1772)',
  19: 'Type 1 Tethered',
  20: 'CCS2',
  25: 'Wireless',
};

/** Map Open Charge Map level IDs to power ranges */
const LEVEL_POWER: Record<number, { min: number; max: number; isFast: boolean }> = {
  1: { min: 1, max: 3.7, isFast: false }, // Level 1
  2: { min: 3.7, max: 22, isFast: false }, // Level 2
  3: { min: 22, max: 350, isFast: true }, // DC Fast
};

/**
 * Fetch EV charging stations near a location from Open Charge Map.
 * @param lat Latitude
 * @param lng Longitude
 * @param radiusKm Search radius in kilometers (default: 5)
 * @param maxResults Maximum number of results (default: 20)
 */
export async function fetchChargingStations(
  lat: number,
  lng: number,
  radiusKm: number = 5,
  maxResults: number = 20,
): Promise<ChargingStation[]> {
  const params = new URLSearchParams({
    output: 'json',
    latitude: String(lat),
    longitude: String(lng),
    distance: String(radiusKm),
    distanceunit: 'KM',
    maxresults: String(maxResults),
    compact: 'true',
    verbose: 'false',
  });

  if (API_KEY) {
    params.set('key', API_KEY);
  }

  const response = await fetch(`${API_BASE}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Open Charge Map API error: ${response.status}`);
  }

  const data: OCMPoi[] = await response.json();
  return data.map(parseOCMStation);
}

/**
 * Fetch a specific charging station by ID.
 */
export async function fetchChargingStationById(id: number): Promise<ChargingStation | null> {
  const params = new URLSearchParams({
    output: 'json',
    chargepointids: String(id),
    compact: 'true',
    verbose: 'false',
  });

  if (API_KEY) {
    params.set('key', API_KEY);
  }

  const response = await fetch(`${API_BASE}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  const data: OCMPoi[] = await response.json();
  if (data.length === 0) return null;

  return parseOCMStation(data[0]);
}

function parseOCMStation(poi: OCMPoi): ChargingStation {
  const addr = poi.AddressInfo;
  const addressParts = [
    addr.AddressLine1,
    addr.AddressLine2,
    addr.Town,
    addr.StateOrProvince,
    addr.Postcode,
  ].filter(Boolean);

  const connections: ChargingConnection[] = (poi.Connections ?? []).map((conn) => {
    const typeName = CONNECTION_TYPES[conn.ConnectionTypeID ?? 0] ?? 'Unknown';
    const levelInfo = LEVEL_POWER[conn.LevelID ?? 0] ?? { min: 0, max: 0, isFast: false };
    const powerKW = conn.PowerKW ?? levelInfo.max;

    return {
      type: typeName,
      powerKW,
      isFastCharge: levelInfo.isFast,
    };
  });

  // Determine access type from general comments or default to public
  const comments = (poi.GeneralComments ?? '').toLowerCase();
  let accessType: ChargingStation['accessType'] = 'public';
  if (comments.includes('private') || comments.includes('restricted')) {
    accessType = 'private';
  } else if (comments.includes('member') || comments.includes('membership')) {
    accessType = 'members_only';
  }

  // Extract pricing from comments if available
  let pricing: string | null = null;
  const pricingMatch = comments.match(/(?:price|cost|fee|rate)[s:]?\s*([^.,]+)/i);
  if (pricingMatch) {
    pricing = pricingMatch[1].trim();
  }

  return {
    id: poi.ID,
    name: addr.Title ?? 'EV Charging Station',
    address: addressParts.join(', '),
    lat: addr.Latitude,
    lng: addr.Longitude,
    operator: poi.OperatorInfo?.Title ?? null,
    network: null, // OCM doesn't provide network info directly
    connections,
    pricing,
    accessType,
    isOpen24Hours: true, // Default assumption; OCM doesn't provide hours
    lastUpdated: poi.DateLastStatusUpdate ?? null,
    statusUrl: `https://openchargemap.org/site/chargelocator/details?chargepointid=${poi.ID}`,
  };
}
