import { z } from 'zod'

// Strict, local-only OHLC CSV contract. Imported data is user-supplied: it is neither live nor
// verified exchange data. Format: header containing date,open,high,low,close (any order, extra
// columns ignored). No quoted commas, thousands separators or locale-dependent decimals.

export const MAX_CANDLES = 5000
export const MAX_CSV_BYTES = 2 * 1024 * 1024

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/
const NUMBER_PATTERN = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/

/** Normalized epoch milliseconds for ordering. Values without an offset are compared as UTC. */
export function candleTime(date: string): number {
  if (!DATE_PATTERN.test(date)) return NaN
  let iso = date.replace(' ', 'T')
  if (iso.length > 10 && !/(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) iso += 'Z'
  const ms = Date.parse(iso)
  // Date.parse rolls over impossible dates (2026-02-31). Reject them by round-tripping the day.
  if (!Number.isFinite(ms)) return NaN
  if (iso.length === 10 || iso.endsWith('Z')) {
    if (new Date(ms).toISOString().slice(0, 10) !== iso.slice(0, 10)) return NaN
  }
  return ms
}

const price = z.number().finite().positive()

export const candleSchema = z.object({
  date: z.string().regex(DATE_PATTERN, 'date must be YYYY-MM-DD or ISO-8601 date-time'),
  open: price,
  high: price,
  low: price,
  close: price,
}).strict().superRefine((c, ctx) => {
  if (!Number.isFinite(candleTime(c.date))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid calendar date', path: ['date'] })
  }
  if (c.high < Math.max(c.open, c.low, c.close) || c.low > Math.min(c.open, c.high, c.close)) {
    ctx.addIssue({ code: 'custom', message: 'high/low inconsistent with open/close', path: ['high'] })
  }
})

export type Candle = z.infer<typeof candleSchema>

function strictlyAscending(candles: Candle[]): number {
  for (let i = 1; i < candles.length; i++) {
    if (!(candleTime(candles[i].date) > candleTime(candles[i - 1].date))) return i
  }
  return -1
}

export const marketDatasetInputSchema = z.object({
  symbol: z.literal('USDJPY'),
  timeframe: z.enum(['1h', '4h', '1d']),
  sourceName: z.string().trim().min(1).max(200),
  sourceNote: z.string().trim().max(500).default(''),
  candles: z.array(candleSchema).min(2).max(MAX_CANDLES),
}).strict().superRefine((d, ctx) => {
  const bad = strictlyAscending(d.candles)
  if (bad !== -1) {
    ctx.addIssue({ code: 'custom', message: 'Candles must be strictly ascending by date with no duplicates', path: ['candles', bad, 'date'] })
  }
})

export type MarketDatasetInput = z.input<typeof marketDatasetInputSchema>

export type MarketStats = {
  count: number
  firstDate: string
  lastDate: string
  firstClose: number
  lastClose: number
  high: number
  highDate: string
  low: number
  lowDate: string
  change: number
  changePct: number
}

export type MarketDatasetMeta = {
  id: string
  symbol: 'USDJPY'
  timeframe: '1h' | '4h' | '1d'
  sourceName: string
  sourceNote: string
  candleCount: number
  firstDate: string
  lastDate: string
  importedAt: string
  /** Always false: imported CSV is user-supplied, not a live or verified feed. */
  verified: false
}

export type MarketDataset = MarketDatasetMeta & {
  candles: Candle[]
  stats: MarketStats
}

export function parseOhlcCsv(source: string): Candle[] {
  const lines = source.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 3) throw new Error('ヘッダーと少なくとも2行のOHLCデータが必要です')
  if (lines.length > MAX_CANDLES + 1) throw new Error(`一度に読み込める足は最大${MAX_CANDLES.toLocaleString('en-US')}本です`)
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase())
  const required = ['date', 'open', 'high', 'low', 'close'] as const
  const columns = required.map((field) => header.indexOf(field))
  if (columns.some((index) => index === -1)) throw new Error('CSVには date,open,high,low,close の列が必要です')
  const [dateCol, openCol, highCol, lowCol, closeCol] = columns
  const candles: Candle[] = []
  for (const [i, line] of lines.slice(1).entries()) {
    const cells = line.split(',').map((s) => s.trim())
    if (cells.length !== header.length) throw new Error(`CSV ${i + 2}行目の列数がヘッダーと一致しません`)
    const nums = [openCol, highCol, lowCol, closeCol].map((index) => {
      const raw = cells[index]
      return raw && NUMBER_PATTERN.test(raw) ? Number(raw) : NaN
    })
    const parsed = candleSchema.safeParse({
      date: cells[dateCol], open: nums[0], high: nums[1], low: nums[2], close: nums[3],
    })
    if (!parsed.success) throw new Error(`CSV ${i + 2}行目の値が不正です（${parsed.error.issues[0]?.message ?? 'invalid'}）`)
    candles.push(parsed.data)
  }
  const bad = strictlyAscending(candles)
  if (bad !== -1) throw new Error(`CSV ${bad + 2}行目: 日時は昇順かつ重複なしである必要があります`)
  return candles
}

export function summarizeCandles(candles: Candle[]): MarketStats {
  if (candles.length === 0) throw new Error('No candles')
  const first = candles[0]
  const last = candles[candles.length - 1]
  let hi = first
  let lo = first
  for (const c of candles) {
    if (c.high > hi.high) hi = c
    if (c.low < lo.low) lo = c
  }
  const change = last.close - first.close
  return {
    count: candles.length,
    firstDate: first.date,
    lastDate: last.date,
    firstClose: first.close,
    lastClose: last.close,
    high: hi.high,
    highDate: hi.date,
    low: lo.low,
    lowDate: lo.date,
    change: Number(change.toFixed(6)),
    changePct: Number(((change / first.close) * 100).toFixed(3)),
  }
}
