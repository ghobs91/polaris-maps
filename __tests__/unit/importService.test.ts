import {
  parseCSV,
  parseJSON,
  parseGeoJSON,
  parseKML,
  parseGPX,
  detectFormat,
  parseImport,
} from '../../src/services/places/importService';

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

describe('parseCSV', () => {
  it('parses a Google Takeout CSV with header', () => {
    const csv = `Title,Note,URL,Comment
Sunsets At Senix,Great food,"https://www.google.com/maps/place/?q=place_id:ChIJxyz/@40.7901,-72.8621,",
Meli Modern Greek,,"https://www.google.com/maps/place/?q=place_id:abc/@40.7654,-73.1234,",`;

    const list = parseCSV(csv, 'Long Island - Eats');
    expect(list.name).toBe('Long Island - Eats');
    expect(list.places).toHaveLength(2);
    expect(list.places[0].name).toBe('Sunsets At Senix');
    expect(list.places[0].note).toBe('Great food');
    expect(list.places[0].lat).toBeCloseTo(40.7901, 4);
    expect(list.places[0].lng).toBeCloseTo(-72.8621, 4);
    expect(list.places[1].name).toBe('Meli Modern Greek');
  });

  it('parses CSV with lat/lng columns', () => {
    const csv = `Name,Address,Latitude,Longitude
Pizza Place,123 Main St,40.7128,-74.006`;

    const list = parseCSV(csv);
    expect(list.places).toHaveLength(1);
    expect(list.places[0].lat).toBeCloseTo(40.7128, 4);
    expect(list.places[0].lng).toBeCloseTo(-74.006, 3);
  });

  it('handles empty CSV', () => {
    expect(() => parseCSV('')).toThrow('Empty CSV file');
  });

  it('handles quoted fields with commas', () => {
    const csv = `Title,Note,URL
"Joe's Pizza, Brooklyn","Best slice",https://maps.google.com/@40.73,-73.99`;

    const list = parseCSV(csv);
    expect(list.places[0].name).toBe("Joe's Pizza, Brooklyn");
    expect(list.places[0].note).toBe('Best slice');
  });
});

// ---------------------------------------------------------------------------
// GeoJSON parser
// ---------------------------------------------------------------------------

describe('parseGeoJSON', () => {
  it('parses a standard GeoJSON FeatureCollection', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      name: 'My Places',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-73.9857, 40.7484] },
          properties: { name: 'Empire State Building', category: 'landmark' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-74.0445, 40.6892] },
          properties: { name: 'Statue of Liberty', address: 'Liberty Island' },
        },
      ],
    });

    const list = parseGeoJSON(geojson);
    expect(list.name).toBe('My Places');
    expect(list.places).toHaveLength(2);
    expect(list.places[0].name).toBe('Empire State Building');
    expect(list.places[0].lat).toBeCloseTo(40.7484, 4);
    expect(list.places[0].lng).toBeCloseTo(-73.9857, 4);
    expect(list.places[0].category).toBe('landmark');
    expect(list.places[1].address).toBe('Liberty Island');
  });

  it('ignores non-Point features', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-73, 40],
              [-74, 41],
            ],
          },
          properties: { name: 'A route' },
        },
      ],
    });

    const list = parseGeoJSON(geojson);
    expect(list.places).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JSON parser (Google Takeout)
// ---------------------------------------------------------------------------

describe('parseJSON', () => {
  it('parses Google Takeout array format', () => {
    const json = JSON.stringify([
      {
        properties: {
          name: 'Central Park',
          'Google Maps URL': 'https://www.google.com/maps/place/?q=/@40.7829,-73.9654,',
          address: 'New York, NY',
        },
        geometry: { location: { lat: 40.7829, lng: -73.9654 } },
      },
    ]);

    const list = parseJSON(json, 'NYC Favorites');
    expect(list.name).toBe('NYC Favorites');
    expect(list.places).toHaveLength(1);
    expect(list.places[0].name).toBe('Central Park');
    expect(list.places[0].lat).toBeCloseTo(40.7829, 4);
  });

  it('delegates to parseGeoJSON for FeatureCollection', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-73.9857, 40.7484] },
          properties: { name: 'Test' },
        },
      ],
    });

    const list = parseJSON(geojson);
    expect(list.places).toHaveLength(1);
    expect(list.places[0].name).toBe('Test');
  });
});

// ---------------------------------------------------------------------------
// KML parser
// ---------------------------------------------------------------------------

describe('parseKML', () => {
  it('parses KML with Placemarks', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Long Island Eats</name>
    <Placemark>
      <name>Sunsets At Senix</name>
      <description><![CDATA[Great waterfront dining]]></description>
      <Point>
        <coordinates>-72.8621,40.7901,0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Meli Modern Greek</name>
      <Point>
        <coordinates>-73.1234,40.7654,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;

    const list = parseKML(kml);
    expect(list.name).toBe('Long Island Eats');
    expect(list.places).toHaveLength(2);
    expect(list.places[0].name).toBe('Sunsets At Senix');
    expect(list.places[0].note).toBe('Great waterfront dining');
    expect(list.places[0].lat).toBeCloseTo(40.7901, 4);
    expect(list.places[0].lng).toBeCloseTo(-72.8621, 4);
  });

  it('handles KML with no Placemarks', () => {
    const kml = `<?xml version="1.0"?><kml><Document><name>Empty</name></Document></kml>`;
    const list = parseKML(kml);
    expect(list.places).toHaveLength(0);
    expect(list.name).toBe('Empty');
  });
});

// ---------------------------------------------------------------------------
// GPX parser
// ---------------------------------------------------------------------------

describe('parseGPX', () => {
  it('parses GPX waypoints', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <metadata><name>My Waypoints</name></metadata>
  <wpt lat="40.7128" lon="-74.006">
    <name>NYC</name>
    <desc>New York City</desc>
  </wpt>
  <wpt lat="34.0522" lon="-118.2437">
    <name>LA</name>
    <link href="https://example.com">
      <text>Link</text>
    </link>
  </wpt>
</gpx>`;

    const list = parseGPX(gpx);
    expect(list.name).toBe('My Waypoints');
    expect(list.places).toHaveLength(2);
    expect(list.places[0].name).toBe('NYC');
    expect(list.places[0].note).toBe('New York City');
    expect(list.places[0].lat).toBeCloseTo(40.7128, 4);
    expect(list.places[1].name).toBe('LA');
    expect(list.places[1].website).toBe('https://example.com');
  });
});

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('detects CSV by extension', () => {
    expect(detectFormat('anything', 'places.csv')).toBe('csv');
  });

  it('detects KML by extension', () => {
    expect(detectFormat('anything', 'map.kml')).toBe('kml');
  });

  it('detects GPX by extension', () => {
    expect(detectFormat('anything', 'track.gpx')).toBe('gpx');
  });

  it('detects GeoJSON by content', () => {
    const content = '{"type":"FeatureCollection","features":[]}';
    expect(detectFormat(content, 'data.json')).toBe('geojson');
  });

  it('detects KML by content', () => {
    expect(detectFormat('<?xml version="1.0"?><kml>')).toBe('kml');
  });

  it('detects GPX by content', () => {
    expect(detectFormat('<gpx version="1.1">')).toBe('gpx');
  });

  it('defaults to CSV for unknown content', () => {
    expect(detectFormat('name,lat,lng\nfoo,1,2')).toBe('csv');
  });
});

// ---------------------------------------------------------------------------
// parseImport (auto-detect + parse)
// ---------------------------------------------------------------------------

describe('parseImport', () => {
  it('auto-detects and parses a KML file', () => {
    const kml = `<?xml version="1.0"?>
<kml><Document><name>Test</name>
<Placemark><name>P1</name><Point><coordinates>-73,40,0</coordinates></Point></Placemark>
</Document></kml>`;

    const list = parseImport(kml, undefined, 'export.kml');
    expect(list.places).toHaveLength(1);
    expect(list.places[0].name).toBe('P1');
  });
});
