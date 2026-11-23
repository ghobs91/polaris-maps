import {
  clearWebsitePhotosCache,
  countRealPhotos,
  dedupePhotoUrls,
  extractImgSrcsFromHtml,
  fetchWebsitePhotos,
  fetchWebsitePhotosResult,
  extractGalleryPhotosFromHtml,
  extractPagePhotos,
  extractPagePhotosAsync,
  isCrossHostRedirect,
  isHttpUrl,
  isLogoLikeUrl,
  isSiteRoot,
  normalizeWebsiteUrl,
  parseOpenGraphFromHtml,
  photoDedupeKey,
  photoPageCandidates,
  rankPhotoUrls,
  resolvePhotoUrl,
  siteHost,
} from '../../src/services/poi/websitePhotosService';

beforeEach(() => {
  clearWebsitePhotosCache();
  jest.restoreAllMocks();
});

describe('normalizeWebsiteUrl', () => {
  it('returns null for missing values', () => {
    expect(normalizeWebsiteUrl(null)).toBeNull();
    expect(normalizeWebsiteUrl(undefined)).toBeNull();
    expect(normalizeWebsiteUrl('   ')).toBeNull();
  });

  it('prepends https when no scheme is present', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com/');
  });

  it('keeps valid http(s) URLs', () => {
    expect(normalizeWebsiteUrl('https://example.com/menu')).toBe('https://example.com/menu');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeWebsiteUrl('ftp://example.com')).toBeNull();
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('photoPageCandidates', () => {
  it('keeps the tagged URL first, then www/apex siblings over https then http', () => {
    expect(photoPageCandidates('http://MongosCoffee.com/')).toEqual([
      'http://mongoscoffee.com/',
      'https://mongoscoffee.com/',
      'https://www.mongoscoffee.com/',
      'http://www.mongoscoffee.com/',
    ]);
  });

  it('adds the apex sibling when the tag already uses www', () => {
    expect(photoPageCandidates('https://www.example.com/menu')).toEqual([
      'https://www.example.com/menu',
      'https://example.com/menu',
      'http://example.com/menu',
    ]);
  });

  it('returns [] for unusable values', () => {
    expect(photoPageCandidates(null)).toEqual([]);
    expect(photoPageCandidates('ftp://a.com')).toEqual([]);
  });
});

describe('isHttpUrl / resolvePhotoUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('https://a.com/x.jpg')).toBe(true);
    expect(isHttpUrl('http://a.com/x.jpg')).toBe(true);
    expect(isHttpUrl('data:image/png;base64,xx')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });

  it('upgrades http image URLs to https', () => {
    expect(resolvePhotoUrl('http://cdn.a.com/x.jpg', 'https://a.com/')).toBe(
      'https://cdn.a.com/x.jpg',
    );
  });

  it('resolves relative URLs and rejects data/blob/svg', () => {
    expect(resolvePhotoUrl('/img/hero.jpg', 'https://a.com/page')).toBe(
      'https://a.com/img/hero.jpg',
    );
    expect(resolvePhotoUrl('data:image/png;base64,xx', 'https://a.com/')).toBeNull();
    expect(resolvePhotoUrl('https://a.com/icon.svg', 'https://a.com/')).toBeNull();
  });
});

describe('dedupePhotoUrls', () => {
  it('dedupes preserving order and caps at 10', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://a.com/${i}.jpg`);
    const result = dedupePhotoUrls([...urls, urls[0], null, undefined]);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe(urls[0]);
  });

  it('collapses resize/format query variants of the same photo', () => {
    expect(photoDedupeKey('https://a.com/x.png?format=300w')).toBe(
      photoDedupeKey('https://a.com/x.png?format=1500w'),
    );
    const result = dedupePhotoUrls([
      'https://a.com/x.png?format=300w',
      'https://a.com/x.png?format=1500w',
    ]);
    expect(result).toEqual(['https://a.com/x.png?format=300w']);
  });
});

describe('logo ranking', () => {
  it('detects logo-like URLs', () => {
    expect(isLogoLikeUrl('https://a.com/Moono-Wh-icon.png')).toBe(true);
    expect(isLogoLikeUrl('https://a.com/favicon.ico')).toBe(true);
    expect(isLogoLikeUrl('https://a.com/food-01.jpg')).toBe(false);
  });

  it('ranks real photos before logos', () => {
    const logo = 'https://a.com/logo.png';
    const food = 'https://a.com/food.jpg';
    expect(rankPhotoUrls([logo, food])).toEqual([food, logo]);
    expect(countRealPhotos([logo, food])).toBe(1);
  });
});

describe('extractImgSrcsFromHtml', () => {
  it('prefers data-image originals and skips tiny declared images', () => {
    const html = [
      '<img data-image="https://a.com/full.jpg" src="https://a.com/full.jpg?format=300w" width="2048" height="1365">',
      '<img src="https://a.com/icon.png" width="32" height="32">',
      '<img data-src="https://a.com/lazy.jpg">',
    ].join('\n');
    expect(extractImgSrcsFromHtml(html)).toEqual([
      'https://a.com/full.jpg',
      'https://a.com/lazy.jpg',
    ]);
  });
});

describe('extractGalleryPhotosFromHtml', () => {
  it('finds images in gallery containers', () => {
    const html =
      '<meta property="og:image" content="https://a.com/brand-image.jpg">' +
      '<section id="gallery">' +
      '<div><img src="/food-01.jpg" width="800" height="600"></div>' +
      '<div><img src="/food-02.jpg" width="800" height="600"></div>' +
      '</section>';

    expect(extractGalleryPhotosFromHtml(html, 'https://a.com/')).toEqual([
      'https://a.com/food-01.jpg',
      'https://a.com/food-02.jpg',
    ]);
  });

  it('excludes page metadata when a gallery has usable photos', () => {
    const html =
      '<meta property="og:image" content="https://a.com/brand-image.jpg">' +
      '<section class="photo-gallery">' +
      '<img src="/food-01.jpg" width="800" height="600">' +
      '<img src="/food-02.jpg" width="800" height="600">' +
      '</section>';

    expect(extractPagePhotos(html, 'https://a.com/')).toEqual([
      'https://a.com/food-01.jpg',
      'https://a.com/food-02.jpg',
    ]);
  });
});

describe('parseOpenGraphFromHtml', () => {
  it('extracts og:image with either attribute order', () => {
    const html = [
      '<meta property="og:image" content="https://a.com/og1.jpg">',
      '<meta content="https://a.com/og2.jpg" property="og:image">',
      '<meta name="twitter:image" content="https://a.com/tw.jpg">',
    ].join('\n');
    expect(parseOpenGraphFromHtml(html, 'https://a.com/')).toEqual([
      'https://a.com/og1.jpg',
      'https://a.com/og2.jpg',
      'https://a.com/tw.jpg',
    ]);
  });

  it('extracts image_src links and JSON-LD images', () => {
    const html = [
      '<link rel="image_src" href="/img/link.jpg">',
      '<script type="application/ld+json">{"image": "https://a.com/ld.jpg"}</script>',
    ].join('\n');
    expect(parseOpenGraphFromHtml(html, 'https://a.com/page')).toEqual([
      'https://a.com/img/link.jpg',
      'https://a.com/ld.jpg',
    ]);
  });

  it('returns [] when no images are present', () => {
    expect(parseOpenGraphFromHtml('<html><body>hi</body></html>', 'https://a.com/')).toEqual([]);
  });
});

describe('fetchWebsitePhotos', () => {
  it('fetches HTML and parses og:image', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<meta property="og:image" content="https://a.com/og.jpg">'),
    }) as unknown as typeof fetch;
    await expect(fetchWebsitePhotos('https://a.com/')).resolves.toEqual(['https://a.com/og.jpg']);
  });

  it('makes exactly ONE request per place, even when the page links a gallery', async () => {
    const home =
      '<img src="https://a.com/1.jpg" width="800" height="600">' +
      '<img src="https://a.com/2.jpg" width="800" height="600">' +
      '<a href="/gallery">Gallery</a>';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve(home),
    }) as unknown as typeof fetch;
    const result = await fetchWebsitePhotos('https://a.com/');
    expect(result).toEqual(['https://a.com/1.jpg', 'https://a.com/2.jpg']);
    // The subpage crawl is gone: opening a card used to fan out to up to
    // sixteen requests, each parsed on the JS thread.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('tries at most two host candidates before giving up', async () => {
    const fetched: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      fetched.push(url);
      return Promise.reject(new Error('unreachable'));
    }) as unknown as typeof fetch;

    await fetchWebsitePhotosResult('https://a.com/');
    expect(fetched).toHaveLength(2);
  });

  it('caps the strip at ten photos', async () => {
    const imgs = Array.from(
      { length: 25 },
      (_, i) => `<img src="https://a.com/${i}.jpg" width="800" height="600">`,
    ).join('');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve(imgs),
    }) as unknown as typeof fetch;
    const result = await fetchWebsitePhotos('https://a.com/');
    expect(result).toHaveLength(10);
  });

  it('returns [] on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch;
    await expect(fetchWebsitePhotos('https://a.com/')).resolves.toEqual([]);
  });

  it('returns [] for non-HTML responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve('{}'),
    }) as unknown as typeof fetch;
    await expect(fetchWebsitePhotos('https://a.com/')).resolves.toEqual([]);
  });

  it('tries the www sibling when the tagged host cannot be fetched', async () => {
    const fetched: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      fetched.push(url);
      if (url === 'https://www.a.com/') {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'text/html' },
          text: () => Promise.resolve('<meta property="og:image" content="https://a.com/og.jpg">'),
        });
      }
      return Promise.reject(new Error('unreachable'));
    }) as unknown as typeof fetch;

    const result = await fetchWebsitePhotosResult('https://a.com/');
    expect(result).toEqual({
      urls: ['https://a.com/og.jpg'],
      ok: true,
      finalUrl: 'https://www.a.com/',
    });
    expect(fetched[0]).toBe('https://a.com/');
    expect(fetched).toContain('https://www.a.com/');
  });

  it('sends an identifying User-Agent (some WAFs reject empty UAs)', async () => {
    const init = jest.fn();
    global.fetch = jest.fn().mockImplementation((_url: string, options: RequestInit) => {
      init(options);
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve('<img src="https://a.com/food.jpg" width="800" height="600">'),
      });
    }) as unknown as typeof fetch;

    await fetchWebsitePhotos('https://a.com/');
    const headers = init.mock.calls[0][0].headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('PolarisMaps/1.0');
  });

  it('does not cache a total fetch failure, so the next open retries', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch;
    await expect(fetchWebsitePhotosResult('https://a.com/')).resolves.toEqual({
      urls: [],
      ok: false,
      finalUrl: null,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<meta property="og:image" content="https://a.com/og.jpg">'),
    }) as unknown as typeof fetch;
    await expect(fetchWebsitePhotos('https://a.com/')).resolves.toEqual(['https://a.com/og.jpg']);
  });
});

describe('redirect handling', () => {
  it('resolves relative photos against the post-redirect URL', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        url: 'https://new.example/',
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve('<img src="/food-01.jpg" width="800" height="600">'),
      }),
    ) as unknown as typeof fetch;

    const result = await fetchWebsitePhotosResult('https://old.example/');
    expect(result.finalUrl).toBe('https://new.example/');
    expect(result.urls).toEqual(['https://new.example/food-01.jpg']);
  });

  it('adds the apex over http so a broken-https apex still reaches its redirect', () => {
    // The Smoked Barn case: https://smokedbarn.com/ fails TLS, but
    // http://smokedbarn.com/ 302s to the venue's current domain.
    expect(photoPageCandidates('https://smokedbarn.com/')).toContain('http://smokedbarn.com/');
  });

  it('classifies site hosts and roots', () => {
    expect(siteHost('https://WWW.Example.com/x')).toBe('example.com');
    expect(isCrossHostRedirect('https://a.com/', 'https://www.a.com/')).toBe(false);
    expect(isCrossHostRedirect('https://a.com/', 'https://b.com/')).toBe(true);
    expect(isSiteRoot('https://a.com')).toBe(true);
    expect(isSiteRoot('https://a.com/')).toBe(true);
    expect(isSiteRoot('https://a.com/menu')).toBe(false);
  });
});

/**
 * The sliced parser exists for one reason: parsing HTML used to run as a single
 * synchronous pass over the whole document on the JS thread, and a heavy venue
 * page blocked renders, gestures and timers for hundreds of milliseconds. These
 * tests pin the two properties that matter — same answer as the synchronous
 * parser, and no single unbroken stretch of work.
 */
describe('extractPagePhotosAsync', () => {
  /** A page large enough to span several parse slices. */
  const buildPage = (count: number): string =>
    Array.from(
      { length: count },
      (_, i) =>
        `<div class="gallery-item"><img data-image="https://a.com/photo-${i}.jpg" width="1200" height="800"></div>`,
    ).join('\n');

  it('returns the same photos as the synchronous parser across many slices', async () => {
    const html = buildPage(1200);
    expect(html.length).toBeGreaterThan(48 * 1024);
    const sync = extractPagePhotos(html, 'https://a.com/');
    const sliced = await extractPagePhotosAsync(html, 'https://a.com/', { sliceBytes: 4 * 1024 });
    expect(sliced).toEqual(sync);
  });

  it('yields to the event loop instead of blocking for the whole parse', async () => {
    const html = buildPage(4000);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    try {
      const photos = await extractPagePhotosAsync(html, 'https://a.com/', {
        sliceBytes: 8 * 1024,
        budgetMs: 1,
      });
      expect(photos.length).toBeGreaterThan(0);
      // A synchronous parse of this document takes far longer than one tick;
      // the sliced parser must let the interval run while it works.
      expect(ticks).toBeGreaterThan(0);
    } finally {
      clearInterval(timer);
    }
  });

  it('caps the parsed document so a pathological page cannot dominate the thread', async () => {
    const html = buildPage(20_000);
    expect(html.length).toBeGreaterThan(1_000_000);
    const photos = await extractPagePhotosAsync(html, 'https://a.com/');
    expect(photos).toHaveLength(10);
  });
});
