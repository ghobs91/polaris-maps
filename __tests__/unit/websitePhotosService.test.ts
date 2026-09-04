import {
  clearWebsitePhotosCache,
  countRealPhotos,
  dedupePhotoUrls,
  discoverPhotoPageUrls,
  extractImgSrcsFromHtml,
  extractPhotosFromWebViewMessage,
  fetchWebsitePhotos,
  extractGalleryPhotosFromHtml,
  extractPagePhotos,
  isHttpUrl,
  isLogoLikeUrl,
  normalizeWebsiteUrl,
  parseOpenGraphFromHtml,
  photoDedupeKey,
  rankPhotoUrls,
  resolvePhotoUrl,
  resolveWebViewPhotoUrls,
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

describe('discoverPhotoPageUrls', () => {
  it('finds gallery links by path or link text, same-origin only', () => {
    const html = [
      '<a href="/gallery">Gallery</a>',
      '<a href="https://a.com/menu">Our Menu</a>',
      '<a href="https://other.com/photos">Photos</a>',
      '<a href="/contact">Contact</a>',
      '<a href="/">Home</a>',
    ].join('\n');
    expect(discoverPhotoPageUrls(html, 'https://a.com/')).toEqual([
      'https://a.com/gallery',
      'https://a.com/menu',
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

  it('crawls the gallery subpage when the homepage yields only a logo', async () => {
    const pages: Record<string, string> = {
      'https://a.com/':
        '<img src="https://a.com/logo.png" width="800" height="600">' +
        '<a href="/gallery">Gallery</a>',
      'https://a.com/gallery':
        '<img src="https://a.com/food-01.jpg" width="2048" height="1365">' +
        '<img src="https://a.com/food-02.jpg" width="2048" height="1365">' +
        '<img src="https://a.com/food-03.jpg" width="2048" height="1365">',
    };
    global.fetch = jest.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve(pages[url] ?? ''),
      }),
    ) as unknown as typeof fetch;
    const result = await fetchWebsitePhotos('https://a.com/');
    expect(result.slice(0, 3)).toEqual([
      'https://a.com/food-01.jpg',
      'https://a.com/food-02.jpg',
      'https://a.com/food-03.jpg',
    ]);
    expect(result[result.length - 1]).toBe('https://a.com/logo.png');
  });

  it('crawls a linked gallery even when the homepage already has enough photos', async () => {
    const home =
      '<img src="https://a.com/1.jpg" width="800" height="600">' +
      '<img src="https://a.com/2.jpg" width="800" height="600">' +
      '<img src="https://a.com/3.jpg" width="800" height="600">' +
      '<a href="/gallery">Gallery</a>';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve(home),
    }) as unknown as typeof fetch;
    const result = await fetchWebsitePhotos('https://a.com/');
    expect(result).toHaveLength(3);
    expect(global.fetch).toHaveBeenCalledTimes(2);
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
});

describe('WebView message helpers', () => {
  it('parses website-photos messages and ignores others', () => {
    expect(
      extractPhotosFromWebViewMessage(JSON.stringify({ type: 'height', height: 5 })),
    ).toBeNull();
    expect(
      extractPhotosFromWebViewMessage(
        JSON.stringify({ type: 'website-photos', urls: ['a', 1, 'a'] }),
      ),
    ).toEqual(['a']);
    expect(extractPhotosFromWebViewMessage('not json')).toBeNull();
  });

  it('resolves relative WebView URLs against the page', () => {
    expect(resolveWebViewPhotoUrls(['/x.jpg', 'data:y'], 'https://a.com/p')).toEqual([
      'https://a.com/x.jpg',
    ]);
  });
});
