import {
  clearCuisineOriginCache,
  cuisineCountryName,
  detectCuisineOrigins,
  extractVisibleText,
  fetchCuisineOrigins,
  findAboutPageUrls,
  flagEmoji,
  isFoodVenue,
} from '../../src/services/poi/cuisineOriginService';

const BASE = 'https://rolos.example.com/';

describe('isFoodVenue', () => {
  it('accepts food subtypes and rejects everything else', () => {
    expect(isFoodVenue('restaurant')).toBe(true);
    expect(isFoodVenue('Cafe')).toBe(true);
    expect(isFoodVenue('hotel')).toBe(false);
    expect(isFoodVenue('address')).toBe(false);
    expect(isFoodVenue(null)).toBe(false);
  });
});

describe('flagEmoji', () => {
  it('builds flags from ISO alpha-2 codes', () => {
    expect(flagEmoji('IL')).toBe('🇮🇱');
    expect(flagEmoji('lb')).toBe('🇱🇧');
    expect(flagEmoji('EG')).toBe('🇪🇬');
  });

  it('returns empty for malformed codes', () => {
    expect(flagEmoji('USA')).toBe('');
    expect(flagEmoji('')).toBe('');
  });
});

describe('cuisineCountryName', () => {
  it('maps a country code to its country name', () => {
    expect(cuisineCountryName('IL', 'Israeli')).toBe('Israel');
    expect(cuisineCountryName('it', 'Italian')).toBe('Italy');
  });

  it('falls back to the demonym label for unknown codes', () => {
    expect(cuisineCountryName('ZZ', 'Zetlandic')).toBe('Zetlandic');
  });

  it('carries the country name on a detected origin', () => {
    const origins = detectCuisineOrigins('Our Italian kitchen, run by a family from Naples.');

    expect(origins[0]).toMatchObject({ label: 'Italian', countryName: 'Italy' });
  });
});

describe('extractVisibleText', () => {
  it('keeps about copy and drops scripts, styles, nav, and footer', () => {
    const html = `
      <html><head><style>.x{color:red}</style></head>
      <body>
        <nav>Home Menu Order</nav>
        <main>
          <h1>Our Story</h1>
          <p>Our family came from Beirut &amp; opened this kitchen in 1998.</p>
          <script>window.lebanon = "not copy";</script>
        </main>
        <footer>Privacy &middot; Careers</footer>
      </body></html>`;
    const text = extractVisibleText(html);
    expect(text).toContain('Our family came from Beirut & opened this kitchen in 1998.');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('window.lebanon');
    expect(text).not.toContain('Privacy');
  });
});

describe('findAboutPageUrls', () => {
  it('prefers about-us and our-story links', () => {
    const html = `
      <a href="/menu">Menu</a>
      <a href="/our-story">Our Story</a>
      <a href="/about-us">About Us</a>
      <a href="/contact">Contact</a>`;
    expect(findAboutPageUrls(html, BASE)).toEqual([
      'https://rolos.example.com/our-story',
      'https://rolos.example.com/about-us',
    ]);
  });

  it('ignores off-origin and non-http links', () => {
    const html = `
      <a href="https://instagram.com/rolos">About us</a>
      <a href="mailto:hi@rolos.example.com">About us</a>
      <a href="/about">About</a>`;
    expect(findAboutPageUrls(html, BASE)).toEqual(['https://rolos.example.com/about']);
  });
});

describe('detectCuisineOrigins', () => {
  it('labels an Israeli reference', () => {
    const origins = detectCuisineOrigins(
      'Our chef grew up in Tel Aviv and our menu is a modern take on Israeli home cooking.',
    );
    expect(origins[0]).toMatchObject({ countryCode: 'IL', label: 'Israeli', flag: '🇮🇱' });
  });

  it('labels Lebanese and Egyptian references', () => {
    expect(detectCuisineOrigins('Family recipes from Lebanon, made fresh daily.')[0]).toMatchObject(
      {
        countryCode: 'LB',
        label: 'Lebanese',
      },
    );
    expect(detectCuisineOrigins('A taste of Egypt, from Cairo to Alexandria.')[0]).toMatchObject({
      countryCode: 'EG',
      label: 'Egyptian',
    });
  });

  it('returns nothing for a generic Mediterranean description', () => {
    expect(
      detectCuisineOrigins('A bright Mediterranean menu of grilled vegetables and fresh fish.'),
    ).toEqual([]);
  });

  it('ignores a city mention without corroborating cuisine signals', () => {
    expect(detectCuisineOrigins('Our dining room was designed in Tel Aviv style.')).toEqual([]);
  });

  it('does not treat "French fries" as French cuisine', () => {
    expect(detectCuisineOrigins('Try our burgers with French fries and a shake.')).toEqual([]);
  });

  it('ranks the strongest signal first and caps the result count', () => {
    const origins = detectCuisineOrigins(
      'Our Lebanese family recipes meet Italian technique, with a little French influence too.',
    );
    expect(origins).toHaveLength(2);
    expect(origins[0].score).toBeGreaterThanOrEqual(origins[1].score);
    expect(origins.map((o) => o.label)).toEqual(expect.arrayContaining(['Lebanese']));
  });
});

describe('fetchCuisineOrigins', () => {
  const htmlResponse = (body: string) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

  const homepageHtml = `
    <html><body>
      <a href="/our-story">Our Story</a>
      <p>Simple Mediterranean food.</p>
    </body></html>`;
  const storyHtml = `
    <html><body><h1>Our Story</h1>
      <p>Three generations of Egyptian home cooking, started in Cairo.</p>
    </body></html>`;

  afterEach(() => {
    clearCuisineOriginCache();
    jest.restoreAllMocks();
  });

  it('follows the about link and labels the discovered origin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(htmlResponse(homepageHtml))
      .mockResolvedValueOnce(htmlResponse(storyHtml));

    const origins = await fetchCuisineOrigins('https://rolos.example.com/');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(origins[0]).toMatchObject({ label: 'Egyptian' });
  });

  it('caches a resolved result', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(htmlResponse(homepageHtml))
      .mockResolvedValueOnce(htmlResponse(storyHtml));

    await fetchCuisineOrigins('https://rolos.example.com/');
    await fetchCuisineOrigins('https://rolos.example.com/');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns [] when the homepage cannot be fetched', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(fetchCuisineOrigins('https://rolos.example.com/')).resolves.toEqual([]);
  });
});
