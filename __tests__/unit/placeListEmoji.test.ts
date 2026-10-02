import { DEFAULT_LIST_EMOJI, suggestEmojiForList } from '../../src/utils/placeListEmoji';

describe('suggestEmojiForList', () => {
  it('maps food themes', () => {
    expect(suggestEmojiForList('Boston Eats')).toBe('🍽️');
    expect(suggestEmojiForList('NYC Pizza')).toBe('🍕');
    expect(suggestEmojiForList('Taco Tuesday')).toBe('🌮');
  });

  it('prefers the more specific rule', () => {
    expect(suggestEmojiForList('Boston Coffeeshops')).toBe('☕');
    expect(suggestEmojiForList('Long Island - Eats')).toBe('🍽️');
  });

  it('handles travel, nature and favorites', () => {
    expect(suggestEmojiForList('Favorites')).toBe('⭐');
    expect(suggestEmojiForList('Beach Day')).toBe('🏖️');
    expect(suggestEmojiForList('Weekend Hikes')).toBe('🥾');
  });

  it('is case-insensitive', () => {
    expect(suggestEmojiForList('my COFFEE list')).toBe('☕');
  });

  it('falls back to a neutral emoji instead of the red pin', () => {
    expect(suggestEmojiForList('Miami')).toBe(DEFAULT_LIST_EMOJI);
    expect(DEFAULT_LIST_EMOJI).not.toBe('📍');
  });
});
