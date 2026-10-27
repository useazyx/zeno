const EARTH_RADIUS_M = 6_371_008.8

const radians = (degrees: number) => degrees * Math.PI / 180

/// Great-circle distance in metres. Good enough for "which hydrant is nearest"
/// inside one city, where a hose is laid along the ground, not the street graph.
export function haversineMeters(
  a: { latitude: number, longitude: number },
  b: { latitude: number, longitude: number },
): number {
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}
