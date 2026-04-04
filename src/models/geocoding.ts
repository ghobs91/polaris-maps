export type GeocodingEntryType = 'address' | 'place' | 'street' | 'city' | 'station';

export interface GeocodingEntry {
  id: number;
  text: string;
  type: GeocodingEntryType;
  housenumber: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  lat: number;
  lng: number;
  /** OTP stop ID for transit station results (e.g. "LI:42"). */
  otpStopId?: string;
}
