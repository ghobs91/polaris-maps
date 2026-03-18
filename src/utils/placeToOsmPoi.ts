import type { OsmPoi } from '../services/poi/osmFetcher';
import type { Place } from '../models/poi';

/**
 * Category → OSM tag type/subtype mapping for rendering in POILayer.
 */
const CATEGORY_TO_OSM: Record<string, { type: string; subtype: string }> = {
  restaurant: { type: 'amenity', subtype: 'restaurant' },
  cafe: { type: 'amenity', subtype: 'cafe' },
  bar: { type: 'amenity', subtype: 'bar' },
  bakery: { type: 'shop', subtype: 'bakery' },
  fast_food: { type: 'amenity', subtype: 'fast_food' },
  grocery: { type: 'shop', subtype: 'greengrocer' },
  supermarket: { type: 'shop', subtype: 'supermarket' },
  convenience: { type: 'shop', subtype: 'convenience' },
  pharmacy: { type: 'amenity', subtype: 'pharmacy' },
  hospital: { type: 'amenity', subtype: 'hospital' },
  clinic: { type: 'amenity', subtype: 'clinic' },
  dentist: { type: 'amenity', subtype: 'dentist' },
  bank: { type: 'amenity', subtype: 'bank' },
  atm: { type: 'amenity', subtype: 'atm' },
  post_office: { type: 'amenity', subtype: 'post_office' },
  gas_station: { type: 'amenity', subtype: 'fuel' },
  ev_charging: { type: 'amenity', subtype: 'charging_station' },
  parking: { type: 'amenity', subtype: 'parking' },
  hotel: { type: 'tourism', subtype: 'hotel' },
  hostel: { type: 'tourism', subtype: 'hostel' },
  campground: { type: 'tourism', subtype: 'camp_site' },
  school: { type: 'amenity', subtype: 'school' },
  university: { type: 'amenity', subtype: 'university' },
  library: { type: 'amenity', subtype: 'library' },
  gym: { type: 'leisure', subtype: 'fitness_centre' },
  park: { type: 'leisure', subtype: 'park' },
  playground: { type: 'leisure', subtype: 'playground' },
  swimming_pool: { type: 'leisure', subtype: 'swimming_pool' },
  cinema: { type: 'amenity', subtype: 'cinema' },
  museum: { type: 'tourism', subtype: 'museum' },
  theater: { type: 'amenity', subtype: 'theatre' },
  clothing: { type: 'shop', subtype: 'clothes' },
  electronics: { type: 'shop', subtype: 'electronics' },
  hardware: { type: 'shop', subtype: 'hardware' },
  bookstore: { type: 'shop', subtype: 'books' },
  hair_salon: { type: 'shop', subtype: 'hairdresser' },
  laundry: { type: 'shop', subtype: 'laundry' },
  car_repair: { type: 'shop', subtype: 'car_repair' },
  car_wash: { type: 'amenity', subtype: 'car_wash' },
  police: { type: 'amenity', subtype: 'police' },
  fire_station: { type: 'amenity', subtype: 'fire_station' },
  government: { type: 'amenity', subtype: 'townhall' },
  place_of_worship: { type: 'amenity', subtype: 'place_of_worship' },
  cemetery: { type: 'amenity', subtype: 'grave_yard' },
  airport: { type: 'amenity', subtype: 'airport' },
  bus_station: { type: 'amenity', subtype: 'bus_station' },
  train_station: { type: 'amenity', subtype: 'train_station' },
  beach: { type: 'leisure', subtype: 'beach' },
  mountain: { type: 'tourism', subtype: 'viewpoint' },
  viewpoint: { type: 'tourism', subtype: 'viewpoint' },
  other: { type: 'amenity', subtype: 'place' },
};

/**
 * Convert a Polaris Place (from SQLite, e.g. Overture-sourced) to the
 * OsmPoi format used by the map's POILayer and POIInfoCard.
 *
 * Uses a large negative ID space to avoid collision with real OSM IDs.
 */
export function placeToOsmPoi(place: Place): OsmPoi {
  const mapping = CATEGORY_TO_OSM[place.category] ?? CATEGORY_TO_OSM.other;

  const tags: Record<string, string> = {
    name: place.name,
    [mapping.type]: mapping.subtype,
    'polaris:source': place.source,
    'polaris:uuid': place.uuid,
  };

  if (place.phone) tags['phone'] = place.phone;
  if (place.website) tags['website'] = place.website;
  if (place.hours) tags['opening_hours'] = place.hours;
  if (place.brandWikidata) tags['brand:wikidata'] = place.brandWikidata;
  if (place.addressStreet) tags['addr:street'] = place.addressStreet;
  if (place.addressCity) tags['addr:city'] = place.addressCity;
  if (place.addressState) tags['addr:state'] = place.addressState;
  if (place.addressPostcode) tags['addr:postcode'] = place.addressPostcode;

  // Use a hash of the UUID as a numeric ID (negative to avoid OSM collision)
  let hash = 0;
  for (let i = 0; i < place.uuid.length; i++) {
    hash = ((hash << 5) - hash + place.uuid.charCodeAt(i)) | 0;
  }

  return {
    id: -(Math.abs(hash) + 1),
    lat: place.lat,
    lng: place.lng,
    name: place.name,
    type: mapping.type,
    subtype: mapping.subtype,
    tags,
  };
}
