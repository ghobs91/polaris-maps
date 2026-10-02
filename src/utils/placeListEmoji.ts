/**
 * Emoji icons for saved place lists.
 *
 * A list gets a themed emoji derived from its title (e.g. "Boston Eats" → 🍽️)
 * instead of every list sharing the same red pin. The suggestion is only a
 * default — the user can override it from the icon picker.
 */

interface EmojiRule {
  emoji: string;
  /** Lowercase substrings that trigger this emoji. First match wins. */
  keywords: string[];
}

/**
 * Ordered most-specific → most-generic. Order matters: e.g. "coffee shop"
 * should resolve to ☕ before the generic "shop" rule matches 🛍️.
 */
const EMOJI_RULES: EmojiRule[] = [
  { emoji: '⭐', keywords: ['favorite', 'favourite', 'starred', 'top picks', 'best of'] },
  { emoji: '💫', keywords: ['want to go', 'wanna go', 'wishlist', 'to visit', 'someday'] },
  { emoji: '🍕', keywords: ['pizza', 'pizzeria'] },
  { emoji: '🌮', keywords: ['taco', 'mexican', 'taqueria', 'burrito'] },
  { emoji: '🍣', keywords: ['sushi', 'japanese', 'ramen', 'izakaya'] },
  { emoji: '🍔', keywords: ['burger', 'hamburger'] },
  { emoji: '🍖', keywords: ['bbq', 'barbecue', 'barbeque', 'grill', 'steak'] },
  { emoji: '🥞', keywords: ['breakfast', 'brunch', 'pancake'] },
  {
    emoji: '🧁',
    keywords: ['dessert', 'ice cream', 'bakery', 'bakeries', 'sweets', 'donut', 'pastry'],
  },
  { emoji: '☕', keywords: ['coffee', 'cafe', 'café', 'espresso', 'roaster'] },
  { emoji: '🍸', keywords: ['cocktail', 'drinks', 'bar', 'bars', 'speakeasy'] },
  { emoji: '🍷', keywords: ['wine', 'winery', 'vineyard'] },
  { emoji: '🍺', keywords: ['beer', 'brewery', 'brewing', 'pub'] },
  { emoji: '🍽️', keywords: ['eat', 'food', 'restaurant', 'dining', 'dinner', 'lunch', 'cuisine'] },
  { emoji: '🛒', keywords: ['grocery', 'groceries', 'supermarket', 'market'] },
  { emoji: '🏖️', keywords: ['beach', 'island', 'coast', 'seaside'] },
  { emoji: '🏕️', keywords: ['camping', 'campground', 'camp '] },
  { emoji: '🥾', keywords: ['hike', 'hiking', 'trail', 'trek', 'outdoors', 'nature', 'walks'] },
  { emoji: '🌳', keywords: ['park', 'parks', 'garden', 'forest'] },
  { emoji: '⛷️', keywords: ['ski', 'snowboard', 'snow'] },
  { emoji: '🏊', keywords: ['swim', 'pool', 'swimming'] },
  { emoji: '🏋️', keywords: ['gym', 'fitness', 'workout', 'climbing'] },
  { emoji: '💆', keywords: ['spa', 'wellness', 'massage', 'salon', 'beauty'] },
  { emoji: '🪩', keywords: ['nightlife', 'night club', 'nightclub', 'club', 'clubs', 'party'] },
  { emoji: '🎵', keywords: ['music', 'concert', 'concerts', 'live music', 'festival'] },
  { emoji: '🎨', keywords: ['museum', 'museums', 'art', 'gallery', 'exhibit'] },
  { emoji: '🎬', keywords: ['cinema', 'movie', 'movies', 'theater', 'theatre'] },
  { emoji: '🏨', keywords: ['hotel', 'hotels', 'stay', 'stays', 'lodging', 'resort'] },
  { emoji: '✈️', keywords: ['travel', 'trip', 'vacation', 'airport', 'flight', 'road trip'] },
  { emoji: '🚗', keywords: ['drive', 'roadtrip', 'scenic'] },
  { emoji: '🏙️', keywords: ['city', 'cities', 'downtown', 'skyline'] },
  { emoji: '🛍️', keywords: ['shop', 'shopping', 'store', 'stores', 'mall', 'outlet', 'boutique'] },
  { emoji: '📚', keywords: ['book', 'books', 'bookstore', 'library', 'reading'] },
  { emoji: '🎓', keywords: ['school', 'college', 'university', 'campus'] },
  { emoji: '🧸', keywords: ['kid', 'kids', 'family', 'playground', 'child'] },
  { emoji: '🐾', keywords: ['pet', 'pets', 'dog', 'dogs', 'cat', 'vet'] },
  { emoji: '🏥', keywords: ['pharmacy', 'medical', 'doctor', 'hospital', 'clinic', 'health'] },
  { emoji: '⛽', keywords: ['gas', 'fuel', 'charging', 'ev ', 'petrol'] },
  { emoji: '🅿️', keywords: ['parking'] },
  { emoji: '💼', keywords: ['work', 'office', 'business'] },
  { emoji: '🏠', keywords: ['home', 'house', 'neighborhood', 'neighbourhood'] },
  { emoji: '💕', keywords: ['date', 'dates', 'romantic', 'anniversary'] },
];

/** Neutral fallback — deliberately not the red pin every list used to share. */
export const DEFAULT_LIST_EMOJI = '🗺️';

/** Suggest an emoji for a list title. Always returns a single emoji. */
export function suggestEmojiForList(name: string): string {
  const lower = name.toLowerCase();
  for (const rule of EMOJI_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) return rule.emoji;
  }
  return DEFAULT_LIST_EMOJI;
}

/**
 * Curated grid for the icon picker. Grouped by theme so the picker can show
 * meaningful sections rather than an undifferentiated wall of glyphs.
 */
export const LIST_EMOJI_GROUPS: ReadonlyArray<{ title: string; emojis: string[] }> = [
  {
    title: 'Popular',
    emojis: ['⭐', '❤️', '🔥', '💫', '📍', '🗺️', '✅', '🏆', '🎯', '✨'],
  },
  {
    title: 'Food & Drink',
    emojis: [
      '🍽️',
      '🍕',
      '🍔',
      '🌮',
      '🍣',
      '🍜',
      '🥗',
      '🍖',
      '🥞',
      '🧁',
      '☕',
      '🍸',
      '🍷',
      '🍺',
      '🥡',
    ],
  },
  {
    title: 'Travel & Outdoors',
    emojis: ['✈️', '🚗', '🏖️', '🏕️', '🥾', '🌳', '⛰️', '🏝️', '🗽', '🎡', '⛷️', '🏊', '🚴', '🛶'],
  },
  {
    title: 'Everyday',
    emojis: ['🛒', '🛍️', '🏋️', '💆', '📚', '🎓', '🧸', '🐾', '🏥', '💼', '🏠', '🅿️', '⛽', '🎁'],
  },
  {
    title: 'Fun & Culture',
    emojis: ['🎵', '🎨', '🎬', '🪩', '🎮', '⚽', '🏀', '🎳', '🍿', '🎭', '📸', '🌃', '💕', '🎉'],
  },
];
