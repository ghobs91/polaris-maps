import { fetchWebsitePhotos } from '../../src/services/poi/websitePhotosService';

// Live network verification against a real website. Disabled by default so the
// default `pnpm test` run is hermetic; opt in with `LIVE_VERIFY=1 pnpm test`.
const liveDescribe = process.env.LIVE_VERIFY === '1' ? describe : describe.skip;

liveDescribe('live verification (throwaway)', () => {
  it('pulls gallery photos from moononyc.com', async () => {
    const urls = await fetchWebsitePhotos('https://www.moononyc.com', 15000);
    console.log('PHOTOS:', JSON.stringify(urls, null, 2));
    // Gallery food/interior shots must surface; logo must not dominate.
    expect(urls.filter((u) => /WEB/i.test(u)).length).toBeGreaterThan(0);
    expect(urls.filter((u) => /icon|logo/i.test(u)).length).toBeLessThanOrEqual(1);
  }, 60000);
});
