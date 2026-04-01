export type PlaceStatus = 'open' | 'closed_temporarily' | 'closed_permanently';
export type PlaceSource = 'overture' | 'community';

export type PlaceCategory =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'bakery'
  | 'fast_food'
  | 'grocery'
  | 'supermarket'
  | 'convenience'
  | 'pharmacy'
  | 'hospital'
  | 'clinic'
  | 'dentist'
  | 'bank'
  | 'atm'
  | 'post_office'
  | 'gas_station'
  | 'ev_charging'
  | 'parking'
  | 'hotel'
  | 'hostel'
  | 'campground'
  | 'school'
  | 'university'
  | 'library'
  | 'gym'
  | 'park'
  | 'playground'
  | 'swimming_pool'
  | 'cinema'
  | 'museum'
  | 'theater'
  | 'clothing'
  | 'electronics'
  | 'hardware'
  | 'bookstore'
  | 'hair_salon'
  | 'laundry'
  | 'car_repair'
  | 'car_wash'
  | 'deli'
  | 'police'
  | 'fire_station'
  | 'government'
  | 'place_of_worship'
  | 'cemetery'
  | 'airport'
  | 'bus_station'
  | 'train_station'
  | 'beach'
  | 'mountain'
  | 'viewpoint'
  | 'other';

export interface Place {
  uuid: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  geohash8: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressPostcode?: string;
  addressCountry?: string;
  phone?: string;
  website?: string;
  socials?: string[]; // Social media URLs (Overture socials[])
  emails?: string[]; // Email addresses (Overture emails[])
  hours?: string; // JSON-encoded
  brandWikidata?: string;
  brandName?: string; // Brand display name (Overture brand.names.primary)
  avgRating?: number;
  reviewCount?: number;
  status: PlaceStatus;
  source: PlaceSource;
  authorPubkey: string;
  signature: string;
  createdAt: number;
  updatedAt: number;
}

export const PLACE_CATEGORIES: PlaceCategory[] = [
  'restaurant',
  'cafe',
  'bar',
  'bakery',
  'fast_food',
  'grocery',
  'supermarket',
  'convenience',
  'pharmacy',
  'hospital',
  'clinic',
  'dentist',
  'bank',
  'atm',
  'post_office',
  'gas_station',
  'ev_charging',
  'parking',
  'hotel',
  'hostel',
  'campground',
  'school',
  'university',
  'library',
  'gym',
  'park',
  'playground',
  'swimming_pool',
  'cinema',
  'museum',
  'theater',
  'clothing',
  'electronics',
  'hardware',
  'bookstore',
  'hair_salon',
  'laundry',
  'car_repair',
  'car_wash',
  'deli',
  'police',
  'fire_station',
  'government',
  'place_of_worship',
  'cemetery',
  'airport',
  'bus_station',
  'train_station',
  'beach',
  'mountain',
  'viewpoint',
  'other',
];
