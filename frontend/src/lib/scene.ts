/** Small helpers for the scene-support panel. */

const WEATHER_LABEL: [number[], string][] = [
  [[0], "Céu limpo"],
  [[1, 2], "Parcialmente nublado"],
  [[3], "Nublado"],
  [[45, 48], "Neblina"],
  [[51, 53, 55, 56, 57], "Garoa"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Chuva"],
  [[95, 96, 99], "Trovoada"],
]

export function weatherLabel(code: number): string {
  return WEATHER_LABEL.find(([codes]) => codes.includes(code))?.[1] ?? "Condição desconhecida"
}

/** Google Street View at a point; needs no key, opens in a new tab. */
export function streetViewUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude},${longitude}`
}
