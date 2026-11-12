// Strict, local-only OHLC CSV import. Market data is neither live nor verified.
// CSV format: date,open,high,low,close. No quoted commas or locale-dependent numbers.
export type Candle = { date: string; open: number; high: number; low: number; close: number }

export function parseOhlcCsv(source: string): Candle[] {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) throw new Error('ヘッダーと少なくとも1行のOHLCデータが必要です')
  if (lines.length > 5001) throw new Error('一度に読み込める足は最大5,000本です')
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase())
  const required = ['date', 'open', 'high', 'low', 'close']
  const columns = required.map((field) => header.indexOf(field))
  if (columns.some((index) => index === -1)) throw new Error('CSVには date,open,high,low,close が必要です')
  const candles: Candle[] = []
  for (const [i, line] of lines.slice(1).entries()) {
    const cells = line.split(',').map((s) => s.trim())
    const [dateCol, openCol, highCol, lowCol, closeCol] = columns
    const date = cells[dateCol]
    const values = [openCol, highCol, lowCol, closeCol].map((index) => {
      const raw = cells[index]
      if (!raw || !/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(raw)) return NaN
      return Number(raw)
    })
    const [open, high, low, close] = values
    if (!date || values.some((n) => !Number.isFinite(n) || n <= 0) ||
        high < Math.max(open, low, close) || low > Math.min(open, high, close)) {
      throw new Error(`CSV ${i + 2}行目の値が不正です`)
    }
    candles.push({ date, open, high, low, close })
  }
  return candles
}

export function chartPoints(candles: Candle[], width = 640, height = 180): string {
  if (candles.length === 0) return ''
  const closes = candles.map((c) => c.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const last = Math.max(candles.length - 1, 1)
  return closes.map((value, i) => {
    const x = 8 + (i / last) * (width - 16)
    const y = 8 + (1 - (value - min) / range) * (height - 16)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}
