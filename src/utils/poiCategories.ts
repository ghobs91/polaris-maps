import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export interface PoiCategory {
  /** Ionicons icon name */
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Background color of the icon circle */
  color: string;
}

/** Subtype-level overrides (most specific) */
const SUBTYPE_MAP: Record<string, PoiCategory> = {
  // Food & Drink
  restaurant: { icon: 'restaurant', color: '#FF6B35' },
  food_court: { icon: 'restaurant', color: '#FF6B35' },
  fast_food: { icon: 'fast-food', color: '#FF6B35' },
  cafe: { icon: 'cafe', color: '#8B5E3C' },
  coffee_shop: { icon: 'cafe', color: '#8B5E3C' },
  bar: { icon: 'wine', color: '#9B4DCA' },
  pub: { icon: 'beer', color: '#9B4DCA' },
  nightclub: { icon: 'musical-notes', color: '#9B4DCA' },
  ice_cream: { icon: 'ice-cream', color: '#FF9BB5' },
  bakery: { icon: 'nutrition', color: '#E07B39' },

  // Finance
  bank: { icon: 'card', color: '#2D9CDB' },
  atm: { icon: 'card', color: '#2D9CDB' },

  // Health
  hospital: { icon: 'medkit', color: '#EB5757' },
  clinic: { icon: 'medkit', color: '#EB5757' },
  doctors: { icon: 'medkit', color: '#EB5757' },
  pharmacy: { icon: 'medical', color: '#27AE60' },
  dentist: { icon: 'medical', color: '#27AE60' },
  veterinary: { icon: 'paw', color: '#27AE60' },

  // Education
  school: { icon: 'school', color: '#2D9CDB' },
  university: { icon: 'school', color: '#2D9CDB' },
  college: { icon: 'school', color: '#2D9CDB' },
  kindergarten: { icon: 'school', color: '#56CCF2' },
  library: { icon: 'library', color: '#2D9CDB' },

  // Mobility
  parking: { icon: 'car', color: '#607D8B' },
  fuel: { icon: 'flame', color: '#F2994A' },
  charging_station: { icon: 'flash', color: '#27AE60' },
  bicycle_parking: { icon: 'bicycle', color: '#607D8B' },

  // Fitness
  gym: { icon: 'fitness', color: '#EB5757' },
  fitness_centre: { icon: 'fitness', color: '#EB5757' },
  sports_centre: { icon: 'trophy', color: '#EB5757' },
  swimming_pool: { icon: 'water', color: '#2D9CDB' },

  // Entertainment
  theatre: { icon: 'film', color: '#9B4DCA' },
  cinema: { icon: 'film', color: '#9B4DCA' },
  arts_centre: { icon: 'color-palette', color: '#9B4DCA' },
  place_of_worship: { icon: 'star', color: '#F2C94C' },

  // Shops
  supermarket: { icon: 'cart', color: '#27AE60' },
  convenience: { icon: 'storefront', color: '#27AE60' },
  clothes: { icon: 'shirt', color: '#EB5757' },
  shoes: { icon: 'footsteps', color: '#EB5757' },
  hairdresser: { icon: 'cut', color: '#9B4DCA' },
  beauty: { icon: 'sparkles', color: '#FF9BB5' },
  electronics: { icon: 'phone-portrait', color: '#607D8B' },
  books: { icon: 'book', color: '#2D9CDB' },
  florist: { icon: 'flower-outline', color: '#FF9BB5' },

  // Tourism
  museum: { icon: 'business', color: '#9B4DCA' },
  hotel: { icon: 'bed', color: '#2D9CDB' },
  hostel: { icon: 'bed', color: '#56CCF2' },
  motel: { icon: 'bed', color: '#56CCF2' },
  viewpoint: { icon: 'eye', color: '#56CCF2' },
  attraction: { icon: 'star', color: '#F2C94C' },
  monument: { icon: 'flag', color: '#F2C94C' },
  gallery: { icon: 'images', color: '#9B4DCA' },
  theme_park: { icon: 'happy', color: '#F2C94C' },

  // Leisure / Nature
  park: { icon: 'leaf', color: '#27AE60' },
  garden: { icon: 'leaf', color: '#27AE60' },
  playground: { icon: 'happy', color: '#F2C94C' },
  dog_park: { icon: 'paw', color: '#27AE60' },
  beach_resort: { icon: 'sunny', color: '#F2994A' },
};

/** Type-level fallbacks when subtype not found */
const TYPE_DEFAULTS: Record<string, PoiCategory> = {
  amenity: { icon: 'location', color: '#FF6B35' },
  shop: { icon: 'storefront', color: '#27AE60' },
  tourism: { icon: 'star', color: '#F2C94C' },
  leisure: { icon: 'leaf', color: '#27AE60' },
};

const FALLBACK: PoiCategory = { icon: 'location', color: '#888888' };

export function getPoiCategory(type: string, subtype: string): PoiCategory {
  return SUBTYPE_MAP[subtype] ?? TYPE_DEFAULTS[type] ?? FALLBACK;
}
