import { z } from 'zod'
import { candleTime, type Candle, type MarketDatasetMeta } from './market'

// Deterministic "which level was touched first" check of a scenario against USER-IMPORTED candles.
// It is a reference computed from the user's own CSV, not verified market data and not a fill.
//
// Assumptions (shown in the UI):
// - The position is assumed open at `entry` at the CLOSE of the as-of candle.
// - Only candles whose OPEN time is at or after that close are used (no look-ahead).
// - A candle touching both stop and target cannot be ordered from OHLC alone -> AMBIGUOUS,
//   unless the candle opened beyond a level (gap), which settles the order at the open.
// - No spread, slippage, fees or swaps.

export const timeframeMs = { '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 } as const
export type Timeframe = keyof typeof timeframeMs

export const marketRefInputSchema = z.object({
  datasetId: z.string().min(1).max(64),
  /** The candle `date` (exactly as stored in the dataset) the hypothesis was formed at. */
  asOfDate: z.string().min(10).max(40),
}).strict()
export type MarketRefInput = z.infer<typeof marketRefInputSchema>

export type MarketRef = {
  datasetId: string
  asOfDate: string
  /** ISO UTC instant of the as-of candle's close; evaluation starts at or after this. */
  asOfAt: string
}

/** Close instant of a candle: its open time (in the dataset's offset) plus the timeframe. */
export function candleCloseTime(date: string, timeframe: Timeframe, tzOffset: string | null): number {
  return candleTime(date, tzOffset ?? '+00:00') + timeframeMs[timeframe]
}

export type PathOutcome = 'TARGET_FIRST' | 'STOP_FIRST' | 'AMBIGUOUS' | 'OPEN' | 'NO_DATA'

export type PathEvaluation = {
  outcome: PathOutcome
  /** Candles at/after the as-of close that were examined (through the deciding candle). */
  barsChecked: number
  firstDate: string | null
  /** Deciding candle (TARGET_FIRST / STOP_FIRST / AMBIGUOUS), or last examined candle when OPEN. */
  decidedDate: string | null
  /** +R:R for target, -1 for stop, mark-to-market R at last close when OPEN; null otherwise. */
  referenceR: number | null
  /** The deciding candle opened beyond the level (price gapped through it). */
  gap: boolean
  /** R at the gap candle's open (e.g. worse than -1 through a stop). */
  gapOpenR: number | null
  /** Max favourable / adverse excursion in R over candles BEFORE the deciding one. */
  mfeR: number | null
  maeR: number | null
  lastClose: number | null
}

type Levels = { side: 'LONG' | 'SHORT'; entry: number; stop: number; target: number }

const round = (n: number) => Number(n.toFixed(3))

export function evaluatePath(
  s: Levels,
  candles: Candle[],
  tzOffset: string | null,
  asOfAtMs: number,
): PathEvaluation {
  const risk = Math.abs(s.entry - s.stop)
  if (!(risk > 0)) throw new Error('Invalid stop distance')
  const long = s.side === 'LONG'
  const r = (price: number) => round((long ? price - s.entry : s.entry - price) / risk)
  const rewardR = round(Math.abs(s.target - s.entry) / risk)
  const later = candles.filter((c) => candleTime(c.date, tzOffset ?? '+00:00') >= asOfAtMs)

  const base: PathEvaluation = {
    outcome: 'NO_DATA', barsChecked: 0, firstDate: later[0]?.date ?? null, decidedDate: null,
    referenceR: null, gap: false, gapOpenR: null, mfeR: null, maeR: null, lastClose: null,
  }
  if (later.length === 0) return base

  let mfe = -Infinity
  let mae = Infinity
  for (const [i, c] of later.entries()) {
    const stopHit = long ? c.low <= s.stop : c.high >= s.stop
    const targetHit = long ? c.high >= s.target : c.low <= s.target
    const openedThroughStop = long ? c.open <= s.stop : c.open >= s.stop
    const openedThroughTarget = long ? c.open >= s.target : c.open <= s.target
    const excursion = () => ({
      mfeR: Number.isFinite(mfe) ? mfe : null,
      maeR: Number.isFinite(mae) ? mae : null,
    })
    const decided = (outcome: PathOutcome, referenceR: number | null, gap: boolean) => ({
      ...base, ...excursion(), outcome, referenceR, gap,
      gapOpenR: gap ? r(c.open) : null, barsChecked: i + 1, decidedDate: c.date, lastClose: c.close,
    })
    if (openedThroughStop) return decided('STOP_FIRST', -1, true)
    if (openedThroughTarget) return decided('TARGET_FIRST', rewardR, true)
    if (stopHit && targetHit) return decided('AMBIGUOUS', null, false)
    if (stopHit) return decided('STOP_FIRST', -1, false)
    if (targetHit) return decided('TARGET_FIRST', rewardR, false)
    mfe = Math.max(mfe, r(long ? c.high : c.low))
    mae = Math.min(mae, r(long ? c.low : c.high))
  }
  const last = later[later.length - 1]
  return {
    ...base, outcome: 'OPEN', barsChecked: later.length, decidedDate: last.date,
    referenceR: r(last.close), mfeR: mfe, maeR: mae, lastClose: last.close,
  }
}

/** GET /api/scenarios/:id/path-check response (reference only, never stored). */
export type PathCheckResponse = {
  evaluation: PathEvaluation
  dataset: MarketDatasetMeta
  /** Datasets of the same symbol that contain candles after the as-of close, newest import first. */
  candidates: MarketDatasetMeta[]
  chart: { candles: Candle[]; firstAfterIndex: number | null; decidedIndex: number | null }
  kind: 'reference'
}
