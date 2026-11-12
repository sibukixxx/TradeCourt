// Pure chart geometry helpers. They only plot values supplied by the user's own CSV.
export const CHART_W = 640
export const CHART_H = 200
const PAD = 10

export function yScale(min: number, max: number, height = CHART_H) {
  const range = max - min || 1
  return (value: number) => PAD + (1 - (value - min) / range) * (height - PAD * 2)
}

export function xScale(count: number, width = CHART_W) {
  const last = Math.max(count - 1, 1)
  return (i: number) => PAD + (i / last) * (width - PAD * 2)
}

/** SVG polyline points for a close-price line. */
export function linePoints(values: number[], min: number, max: number): string {
  const x = xScale(values.length)
  const y = yScale(min, max)
  return values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
}
