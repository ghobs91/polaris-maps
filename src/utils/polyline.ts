/** Decode a Valhalla precision-6 encoded polyline into [lng, lat] pairs. */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / factor, lat / factor]);
  }

  return coords;
}

/** Encode [lng, lat] pairs into a Valhalla precision-6 encoded polyline. */
export function encodePolyline(coords: [number, number][], precision = 6): string {
  const factor = Math.pow(10, precision);
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  const enc = (v: number): string => {
    let val = v < 0 ? ~(v << 1) : v << 1;
    let chunk = '';
    while (val >= 0x20) {
      chunk += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
      val >>= 5;
    }
    chunk += String.fromCharCode(val + 63);
    return chunk;
  };
  for (const [lng, lat] of coords) {
    const latE = Math.round(lat * factor);
    const lngE = Math.round(lng * factor);
    out += enc(latE - prevLat) + enc(lngE - prevLng);
    prevLat = latE;
    prevLng = lngE;
  }
  return out;
}
