import { describe, expect, it } from 'vitest'
import { computeLevelFacts, draftLevels, targetForR } from './levels'
import { scenarioInputSchema } from './index'

// SYNTHETIC candles only (the same 4 candles the browser E2E imports).
const four = [
  { date: '2026-01-05', open: 150.0, high: 150.8, low: 149.7, close: 150.5 },
  { date: '2026-01-06', open: 150.5, high: 151.2, low: 150.1, close: 151.0 },
  { date: '2026-01-07', open: 151.0, high: 151.1, low: 149.5, close: 149.9 },
  { date: '2026-01-08', open: 149.9, high: 150.6, low: 149.8, close: 150.4 },
]
// 20 identical synthetic candles: true range 1.0 each -> ATR 1.0, SMA20 100.5.
const flat = Array.from({ length: 20 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, open: 100.5, high: 101, low: 100, close: 100.5 }))

describe('computeLevelFacts', () => {
  it('uses only candles up to the as-of candle', () => {
    expect(computeLevelFacts(four, 1)).toEqual({ asOfDate: '2026-01-06', close: 151, lookback: 2, swingLow: 149.7, swingHigh: 151.2, atr: null, sma20: null })
    expect(computeLevelFacts(four, 9)).toBeNull()
  })
  it('computes ATR(14) and SMA20 once enough candles exist', () => {
    expect(computeLevelFacts(flat, 19)).toMatchObject({ atr: 1, sma20: 100.5, lookback: 20 })
    expect(computeLevelFacts(flat, 13)?.atr).toBeNull()
  })
})

describe('targetForR', () => {
  it('projects the target on the profit side', () => {
    expect(targetForR('LONG', 150, 149, 2)).toBe(152)
    expect(targetForR('SHORT', 150, 151, 1.5)).toBe(148.5)
  })
})

describe('draftLevels (direction is always the user\'s choice)', () => {
  it('SWING LONG: stop just below the recent low, 2R target, swing high as alternative', () => {
    const d = draftLevels(four, 3, 'LONG', 'SWING', 2, '1d')!
    expect(d).toMatchObject({ entry: 150.4, stop: 149.48, target: 152.24, rewardR: 2, swingTarget: { price: 151.2, rewardR: 0.87 } })
    expect(d.thesisDraft).toContain('【自動下書き・要編集】1d足 2026-01-08 の終値 150.4')
    expect(d.thesisDraft).toContain('LONGを選択')
    expect(d.invalidationDraft).toBe('149.48 を下回ったら仮説は無効')
  })

  it('SWING SHORT mirrors around the recent high', () => {
    const d = draftLevels(four, 3, 'SHORT', 'SWING', 2)!
    expect(d).toMatchObject({ entry: 150.4, stop: 151.22, target: 148.76, swingTarget: { price: 149.5, rewardR: 1.1 } })
    expect(d.invalidationDraft).toBe('151.22 を上回ったら仮説は無効')
  })

  it('ATR method uses 1.5 x ATR and needs enough candles', () => {
    expect(draftLevels(flat, 19, 'LONG', 'ATR', 3)).toMatchObject({ entry: 100.5, stop: 99, target: 105 })
    expect(draftLevels(four, 3, 'LONG', 'ATR')).toBeNull()
  })

  it('omits the swing target when it is not on the profit side', () => {
    // The as-of close equals the swing high, so there is no higher swing to target.
    const d = draftLevels([{ date: '2026-03-02', open: 150, high: 150, low: 149, close: 150 }], 0, 'LONG', 'SWING')!
    expect(d.swingTarget).toBeNull()
  })

  it('produces drafts that satisfy the scenario contract', () => {
    for (const side of ['LONG', 'SHORT'] as const) {
      const d = draftLevels(four, 3, side, 'SWING', 2)!
      const parsed = scenarioInputSchema.safeParse({
        symbol: 'USDJPY', timeframe: '1d', side, entry: d.entry, stop: d.stop, target: d.target,
        thesis: d.thesisDraft, invalidation: d.invalidationDraft,
      })
      expect(parsed.success).toBe(true)
    }
  })
})
