/**
 * Turn a raw place category into a human-readable label for list rows.
 *
 * Saved places carry an OSM subtype (e.g. `fast_food`), an Apple MapKit
 * category (e.g. `MKPOICategoryCafe`), or nothing at all. Both need to render
 * as "Fast Food" / "Café" rather than the raw token.
 */

const MKPOI_LABELS: Record<string, string> = {
  MKPOICategoryRestaurant: 'Restaurant',
  MKPOICategoryCafe: 'Café',
  MKPOICategoryBakery: 'Bakery',
  MKPOICategoryNightlife: 'Nightlife',
  MKPOICategoryGasStation: 'Gas Station',
  MKPOICategoryEVCharger: 'EV Charger',
  MKPOICategoryFoodMarket: 'Food Market',
  MKPOICategoryParking: 'Parking',
  MKPOICategoryHospital: 'Hospital',
  MKPOICategoryPharmacy: 'Pharmacy',
  MKPOICategorySchool: 'School',
  MKPOICategoryUniversity: 'University',
  MKPOICategoryLibrary: 'Library',
  MKPOICategoryMuseum: 'Museum',
  MKPOICategoryTheater: 'Theatre',
  MKPOICategoryPark: 'Park',
  MKPOICategoryBeach: 'Beach',
  MKPOICategoryStore: 'Store',
  MKPOICategoryGrocery: 'Grocery',
  MKPOICategoryFitnessCenter: 'Fitness Center',
  MKPOICategoryHotel: 'Hotel',
  MKPOICategoryBank: 'Bank',
  MKPOICategoryATM: 'ATM',
  MKPOICategoryPostOffice: 'Post Office',
  MKPOICategoryLaundry: 'Laundry',
  MKPOICategoryMovieTheater: 'Cinema',
};

/** Tokens that need casing the naive Title Case rule gets wrong. */
const SPECIAL_LABELS: Record<string, string> = {
  ev_charging: 'EV Charger',
  ev: 'EV',
  bbq: 'BBQ',
  atm: 'ATM',
};

function humanizeMkCategory(raw: string): string {
  return raw
    .replace(/^MKPOICategory/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function titleCase(value: string): string {
  const whole = SPECIAL_LABELS[value.toLowerCase()];
  if (whole) return whole;
  return value
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const special = SPECIAL_LABELS[word.toLowerCase()];
      if (special) return special;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Returns a display label, or undefined when there is nothing useful to show. */
export function formatPlaceCategory(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const known = MKPOI_LABELS[trimmed];
  if (known) return known;
  const label = trimmed.startsWith('MKPOICategory')
    ? humanizeMkCategory(trimmed)
    : titleCase(trimmed);
  return label || undefined;
}
