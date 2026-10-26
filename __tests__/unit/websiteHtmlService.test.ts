import {
  clearWebsiteActionsCache,
  fetchWebsiteActions,
} from '../../src/services/poi/websiteActionsService';
import {
  clearCuisineOriginCache,
  fetchCuisineOrigins,
} from '../../src/services/poi/cuisineOriginService';
import {
  clearWebsiteHtmlInFlight,
  fetchWebsiteHtml,
} from '../../src/services/poi/websiteHtmlService';

const BASE = 'https://rolos.example.com/';

const htmlResponse = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

const homepageHtml = `
  <html><body>
    <a href="/menu">Menu</a>
    <a href="/our-story">Our Story</a>
    <p>Simple Mediterranean food.</p>
  </body></html>`;

const storyHtml = `
  <html><body><h1>Our Story</h1>
    <p>Three generations of Egyptian home cooking, started in Cairo.</p>
  </body></html>`;

afterEach(() => {
  clearWebsiteHtmlInFlight();
  clearWebsiteActionsCache();
  clearCuisineOriginCache();
  jest.restoreAllMocks();
});

describe('fetchWebsiteHtml single-flight', () => {
  it('shares one request between concurrent callers', async () => {
    let resolveFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockReturnValue(pending);

    const first = fetchWebsiteHtml(BASE);
    const second = fetchWebsiteHtml(BASE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    resolveFetch(htmlResponse('hello'));
    await expect(first).resolves.toMatchObject({ html: 'hello' });
    await expect(second).resolves.toMatchObject({ html: 'hello' });
  });

  it('requests again once the previous request has settled', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(htmlResponse('hello'));

    await fetchWebsiteHtml(BASE);
    await fetchWebsiteHtml(BASE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('shared homepage fetch', () => {
  it('lets action detection and cuisine analysis share one homepage GET', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      return url.endsWith('/our-story') ? htmlResponse(storyHtml) : htmlResponse(homepageHtml);
    });

    const [actions, origins] = await Promise.all([
      fetchWebsiteActions(BASE),
      fetchCuisineOrigins(BASE),
    ]);

    // One homepage GET shared by both, plus the about-page GET.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(actions.map((action) => action.kind)).toContain('menu');
    expect(origins[0]).toMatchObject({ label: 'Egyptian' });
  });
});
