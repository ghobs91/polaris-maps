const fs = require('fs');
const jwt = fs
  .readFileSync('.env', 'utf8')
  .match(/EXPO_PUBLIC_APPLE_MAPKIT_TOKEN=(.+)/)[1]
  .trim();

fetch('https://maps-api.apple.com/v1/token', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + jwt },
})
  .then((r) => r.json())
  .then(async (t) => {
    const tok = t.accessToken;
    console.log('Got access token, expires in', t.expiresInSeconds, 's');
    const r2 = await fetch(
      'https://maps-api.apple.com/v1/search?q=Starbucks&searchLocation=37.3317,-122.0302&resultTypeFilter=Poi&lang=en-US',
      {
        headers: { Authorization: 'Bearer ' + tok },
      },
    );
    const d = await r2.json();
    if (d.results && d.results[0]) {
      const p = d.results[0];
      console.log('--- Search result fields ---');
      console.log(JSON.stringify(p, null, 2));

      if (p.id) {
        console.log('\n--- Place lookup for id:', p.id, '---');
        const r3 = await fetch(
          `https://maps-api.apple.com/v1/place?ids=${encodeURIComponent(p.id)}&lang=en-US`,
          {
            headers: { Authorization: 'Bearer ' + tok },
          },
        );
        const d3 = await r3.json();
        console.log(JSON.stringify(d3, null, 2));
      }
    } else {
      console.log(JSON.stringify(d, null, 2));
    }
  })
  .catch((e) => console.error(e));
