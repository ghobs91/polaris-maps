import { fetchBartLines, clearBartCache } from '../../src/services/transit/bartFetcher';

describe('bartFetcher', () => {
  const mockFetch = jest.fn();
  (global as any).fetch = mockFetch;

  beforeEach(() => {
    mockFetch.mockReset();
    clearBartCache();
  });

  const routeXml = `
    <?xml version="1.0"?>
    <root>
      <routes>
        <route>
          <name>Antioch to SFO</name>
          <abbr>YELLOW</abbr>
          <number>1</number>
          <color>YELLOW</color>
          <hexcolor>#FFE800</hexcolor>
        </route>
        <route>
          <name>Combined Yellow/Blue</name>
          <abbr></abbr>
          <number>99</number>
          <color>BROWN</color>
          <hexcolor>#62361b</hexcolor>
        </route>
      </routes>
    </root>
  `;

  const routeInfoXml = `
    <?xml version="1.0"?>
    <root>
      <routes>
        <route>
          <name>Antioch to SFO</name>
          <abbr>YELLOW</abbr>
          <number>1</number>
          <color>YELLOW</color>
          <hexcolor>#FFE800</hexcolor>
          <config>
            <station>
              <name>Antioch</name>
              <abbr>ANTC</abbr>
              <gtfs_latitude>38.0182</gtfs_latitude>
              <gtfs_longitude>-121.7790</gtfs_longitude>
            </station>
            <station>
              <name>Pittsburg Center</name>
              <abbr>PITT</abbr>
              <gtfs_latitude>38.0190</gtfs_latitude>
              <gtfs_longitude>-121.8870</gtfs_longitude>
            </station>
            <station>
              <name>SFIA</name>
              <abbr>SFIA</abbr>
              <gtfs_latitude>37.6165</gtfs_latitude>
              <gtfs_longitude>-122.3920</gtfs_longitude>
            </station>
          </config>
        </route>
      </routes>
    </root>
  `;

  it('fetches routes and returns TransitRouteLine[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => routeXml,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => routeInfoXml,
    });

    const result = await fetchBartLines();
    expect(result.length).toBe(1); // Combined route filtered out
    expect(result[0].name).toBe('Antioch to SFO');
    expect(result[0].mode).toBe('SUBWAY');
    expect(result[0].stops.length).toBe(3);
    expect(result[0].geometry[0].length).toBe(3);
  });

  it('caches result', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => routeXml });
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => routeInfoXml });

    const first = await fetchBartLines();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const second = await fetchBartLines();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await fetchBartLines();
    expect(result).toEqual([]);
  });
});
