import { z } from 'zod'

// Strict, local-only OHLC CSV contract. Imported data is user-supplied: it is neither live nor
// verified exchange data. Format: header containing date,open,high,low,close (any order, extra
// columns ignored). No quoted commas, thousands separators or locale-dependent decimals.

export const MAX_CANDLES = 5000
export const MAX_CSV_BYTES = 2 * 1024 * 1024

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/
const NUMBER_PATTERN = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/

/** Fixed UTC offset of the CSV's local timestamps, e.g. "+09:00" (JST). DST zones are not modelled. */
export const tzOffsetSchema = z.string().regex(/^[+-](?:0\d|1[0-4]):(?:00|30|45)$/, 'tzOffset must look like +09:00')
export type TzOffset = z.infer<typeof tzOffsetSchema>
export const commonTzOffsets: { value: TzOffset; label: { en: string; ja: string } }[] = [
  { value: '+00:00', label: { en: 'UTC (+00:00)', ja: 'UTC (+00:00)' } },
  { value: '+09:00', label: { en: 'Japan JST (+09:00)', ja: '日本時間 JST (+09:00)' } },
  { value: '+08:00', label: { en: '+08:00 (SGT/HKT)', ja: '+08:00 (SGT/HKT)' } },
  { value: '+03:00', label: { en: '+03:00 (common MT4/MT5 summer time)', ja: '+03:00 (MT4/MT5 夏時間に多い)' } },
  { value: '+02:00', label: { en: '+02:00 (common MT4/MT5 winter time)', ja: '+02:00 (MT4/MT5 冬時間に多い)' } },
  { value: '+01:00', label: { en: '+01:00 (CET)', ja: '+01:00 (CET)' } },
  { value: '-04:00', label: { en: '-04:00 (US Eastern, summer)', ja: '-04:00 (米国東部 夏時間)' } },
  { value: '-05:00', label: { en: '-05:00 (US Eastern, winter)', ja: '-05:00 (米国東部 冬時間)' } },
]

const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/

function validCalendarDay(ymd: string): boolean {
  const ms = Date.parse(`${ymd}T00:00:00Z`)
  // Date.parse rolls over impossible dates (2026-02-31). Reject them by round-tripping the day.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === ymd
}

/**
 * Absolute epoch milliseconds of a candle's timestamp (the bar's OPEN time).
 * An explicit offset in the value wins; otherwise `tzOffset` (default UTC) is applied.
 * Date-only values mean 00:00 of that day in the given offset.
 */
export function candleTime(date: string, tzOffset: string = '+00:00'): number {
  if (!DATE_PATTERN.test(date) || !validCalendarDay(date.slice(0, 10))) return NaN
  let iso = date.replace(' ', 'T')
  if (iso.length === 10) iso += 'T00:00:00'
  if (!EXPLICIT_OFFSET.test(iso)) iso += tzOffset
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : NaN
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
  /** Offset of timestamps written without one. Omitted = unknown (computed as UTC, shown as unverified). */
  tzOffset: tzOffsetSchema.optional(),
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
  /** null = not specified at import (treated as UTC for calculations). */
  tzOffset: string | null
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

export type CsvErrorCode = 'TOO_FEW_ROWS' | 'TOO_MANY_ROWS' | 'MISSING_COLUMNS' | 'COLUMN_COUNT' | 'INVALID_ROW' | 'NOT_ASCENDING'

/** CSV rejection with a stable code (UIs translate it) and the 1-based CSV line where relevant. */
export class CsvParseError extends Error {
  constructor(readonly code: CsvErrorCode, readonly line: number | null, message: string, readonly detail = '') {
    super(message)
    this.name = 'CsvParseError'
  }
}

export function parseOhlcCsv(source: string): Candle[] {
  const lines = source.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 3) throw new CsvParseError('TOO_FEW_ROWS', null, 'A header and at least 2 OHLC rows are required')
  if (lines.length > MAX_CANDLES + 1) throw new CsvParseError('TOO_MANY_ROWS', null, `At most ${MAX_CANDLES.toLocaleString('en-US')} candles can be imported at once`)
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase())
  const required = ['date', 'open', 'high', 'low', 'close'] as const
  const columns = required.map((field) => header.indexOf(field))
  if (columns.some((index) => index === -1)) throw new CsvParseError('MISSING_COLUMNS', 1, 'The CSV needs date,open,high,low,close columns')
  const [dateCol, openCol, highCol, lowCol, closeCol] = columns
  const candles: Candle[] = []
  for (const [i, line] of lines.slice(1).entries()) {
    const cells = line.split(',').map((s) => s.trim())
    if (cells.length !== header.length) throw new CsvParseError('COLUMN_COUNT', i + 2, `CSV line ${i + 2}: column count does not match the header`)
    const nums = [openCol, highCol, lowCol, closeCol].map((index) => {
      const raw = cells[index]
      return raw && NUMBER_PATTERN.test(raw) ? Number(raw) : NaN
    })
    const parsed = candleSchema.safeParse({
      date: cells[dateCol], open: nums[0], high: nums[1], low: nums[2], close: nums[3],
    })
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? 'invalid'
      throw new CsvParseError('INVALID_ROW', i + 2, `CSV line ${i + 2}: invalid values (${detail})`, detail)
    }
    candles.push(parsed.data)
  }
  const bad = strictlyAscending(candles)
  if (bad !== -1) throw new CsvParseError('NOT_ASCENDING', bad + 2, `CSV line ${bad + 2}: dates must be strictly ascending with no duplicates`)
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
