import { describe, expect, it } from 'vitest'
import { candleTime } from './market'
import { candleCloseTime, evaluatePath, timeframeMs } from './path'
import { scenarioInputSchema } from './index'

// SYNTHETIC candles only. Daily bars, LONG entry 150 / stop 149 / target 152 => R:R 2.
const long = { side: 'LONG' as const, entry: 150, stop: 149, target: 152 }
const short = { side: 'SHORT' as const, entry: 150, stop: 151, target: 148 }
const bar = (date: string, open: number, high: number, low: number, close: number) => ({ date, open, high, low, close })
const asOf = candleCloseTime('2026-01-01', '1d', null) // 2026-01-02T00:00Z

describe('candle time with offsets', () => {
  it('applies the dataset offset only when the value has none', () => {
    expect(new Date(candleTime('2026-01-05', '+09:00')).toISOString()).toBe('2026-01-04T15:00:00.000Z')
    expect(new Date(candleTime('2026-01-05 09:00', '+09:00')).toISOString()).toBe('2026-01-05T00:00:00.000Z')
    expect(new Date(candleTime('2026-01-05T09:00Z', '+09:00')).toISOString()).toBe('2026-01-05T09:00:00.000Z')
    expect(candleTime('2026-02-30', '+09:00')).toBeNaN()
  })

  it('as-of instant is the candle close (open + timeframe)', () => {
    expect(candleCloseTime('2026-01-05', '1d', '+09:00') - candleTime('2026-01-05', '+09:00')).toBe(timeframeMs['1d'])
    expect(new Date(candleCloseTime('2026-01-05 08:00', '4h', null)).toISOString()).toBe('2026-01-05T12:00:00.000Z')
  })
})

describe('evaluatePath', () => {
  it('ignores the as-of candle and earlier ones (no look-ahead)', () => {
    const candles = [bar('2026-01-01', 150, 153, 148, 150)] // touches both, but it is the as-of bar
    expect(evaluatePath(long, candles, null, asOf)).toMatchObject({ outcome: 'NO_DATA', barsChecked: 0, referenceR: null })
  })

  it('excludes finer bars inside the as-of daily candle', () => {
    const hourly = [bar('2026-01-01 23:00', 150, 153, 150, 152.5), bar('2026-01-02 00:00', 150, 150.5, 148.5, 149)]
    expect(evaluatePath(long, hourly, null, asOf)).toMatchObject({ outcome: 'STOP_FIRST', decidedDate: '2026-01-02 00:00', barsChecked: 1 })
  })

  it('finds target first with MFE/MAE before the deciding bar', () => {
    const candles = [
      bar('2026-01-02', 150, 151, 149.5, 150.5),
      bar('2026-01-03', 150.5, 151.5, 149.2, 151),
      bar('2026-01-04', 151, 152.1, 150.8, 152),
    ]
    expect(evaluatePath(long, candles, null, asOf)).toEqual({
      outcome: 'TARGET_FIRST', barsChecked: 3, firstDate: '2026-01-02', decidedDate: '2026-01-04',
      referenceR: 2, gap: false, gapOpenR: null, mfeR: 1.5, maeR: -0.8, lastClose: 152,
    })
  })

  it('finds stop first', () => {
    const candles = [bar('2026-01-02', 150, 150.4, 148.9, 149.1)]
    expect(evaluatePath(long, candles, null, asOf)).toMatchObject({ outcome: 'STOP_FIRST', referenceR: -1, gap: false, mfeR: null })
  })

  it('reports AMBIGUOUS when one candle touches both levels', () => {
    const candles = [bar('2026-01-02', 150, 152.5, 148.5, 150)]
    expect(evaluatePath(long, candles, null, asOf)).toMatchObject({ outcome: 'AMBIGUOUS', referenceR: null, decidedDate: '2026-01-02' })
  })

  it('a gap through a level settles the order and reports the open R', () => {
    const gapDown = [bar('2026-01-02', 148.5, 152.5, 148, 152)] // opened below stop, later touched target
    expect(evaluatePath(long, gapDown, null, asOf)).toMatchObject({ outcome: 'STOP_FIRST', gap: true, referenceR: -1, gapOpenR: -1.5 })
    const gapUp = [bar('2026-01-02', 152.5, 153, 148.5, 149)]
    expect(evaluatePath(long, gapUp, null, asOf)).toMatchObject({ outcome: 'TARGET_FIRST', gap: true, referenceR: 2, gapOpenR: 2.5 })
  })

  it('reports OPEN with mark-to-market R when neither level is reached', () => {
    const candles = [bar('2026-01-02', 150, 151, 149.5, 150.6), bar('2026-01-03', 150.6, 151.2, 150.2, 150.9)]
    expect(evaluatePath(long, candles, null, asOf)).toMatchObject({ outcome: 'OPEN', barsChecked: 2, referenceR: 0.9, mfeR: 1.2, maeR: -0.5, lastClose: 150.9 })
  })

  it('mirrors levels for SHORT', () => {
    const candles = [bar('2026-01-02', 150, 150.8, 149, 149.5), bar('2026-01-03', 149.5, 149.6, 147.9, 148)]
    expect(evaluatePath(short, candles, null, asOf)).toMatchObject({ outcome: 'TARGET_FIRST', referenceR: 2, mfeR: 1, maeR: -0.8 })
  })

  it('uses the dataset offset when comparing with the as-of instant', () => {
    // 2026-01-02 in JST opens at 2026-01-01T15:00Z, i.e. before the UTC as-of close -> excluded.
    const candles = [bar('2026-01-02', 150, 150.2, 148.5, 149), bar('2026-01-03', 150, 152.5, 149.5, 152)]
    expect(evaluatePath(long, candles, '+09:00', asOf)).toMatchObject({ outcome: 'TARGET_FIRST', decidedDate: '2026-01-03', barsChecked: 1 })
    expect(evaluatePath(long, candles, null, asOf)).toMatchObject({ outcome: 'STOP_FIRST', decidedDate: '2026-01-02' })
  })
})

describe('scenario marketRef contract', () => {
  const base = { symbol: 'USDJPY', timeframe: '4h', side: 'LONG', entry: 150, stop: 149, target: 152, thesis: 'Synthetic thesis text', invalidation: 'Synthetic' }
  it('is optional and strict', () => {
    expect(scenarioInputSchema.safeParse(base).success).toBe(true)
    expect(scenarioInputSchema.safeParse({ ...base, marketRef: { datasetId: 'abc', asOfDate: '2026-01-05' } }).success).toBe(true)
    expect(scenarioInputSchema.safeParse({ ...base, marketRef: { datasetId: 'abc' } }).success).toBe(false)
    expect(scenarioInputSchema.safeParse({ ...base, marketRef: { datasetId: 'abc', asOfDate: '2026-01-05', price: 1 } }).success).toBe(false)
  })
})
