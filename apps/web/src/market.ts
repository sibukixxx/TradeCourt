import type { Candle } from '@tradecourt/core'

/** SVG polyline points for a close-price line chart. Pure; renders only the supplied candles. */
export function chartPoints(candles: Candle[], width = 640, height = 200, pad = 10): string {
  if (candles.length === 0) return ''
  const closes = candles.map((c) => c.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const last = Math.max(candles.length - 1, 1)
  return closes.map((value, i) => {
    const x = pad + (i / last) * (width - pad * 2)
    const y = pad + (1 - (value - min) / range) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}
