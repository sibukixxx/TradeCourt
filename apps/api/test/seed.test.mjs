import { describe, expect, it } from 'vitest'
import { marketDatasetInputSchema, scenarioInputSchema } from '@tradecourt/core'
import app from '../src/index'
import { createTestD1 } from './d1-sqlite'
import { DEFAULT_ANCHOR, RECENT_RANGE, buildSeedPlan, businessDaysBefore, generateDailyCandles } from '../../../scripts/seed-data.mjs'
import { runSeed } from '../../../scripts/seed-local.mjs'

const today = new Date('2026-11-13T09:00:00Z') // Friday

describe('seed data generator (SYNTHETIC)', () => {
  it('uses weekdays strictly before today', () => {
    const days = businessDaysBefore(today, 6)
    expect(days).toEqual(['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'])
  })

  it('is deterministic, valid OHLC and anchored to the reference level', () => {
    const a = generateDailyCandles({ anchor: DEFAULT_ANCHOR.price, today })
    const b = generateDailyCandles({ anchor: DEFAULT_ANCHOR.price, today })
    expect(a).toEqual(b)
    expect(a).toHaveLength(120)
    expect(a.at(-1)).toMatchObject({ date: '2026-11-12', close: 159.7 })
    expect(marketDatasetInputSchema.safeParse({ symbol: 'USDJPY', timeframe: '1d', sourceName: 'x', candles: a }).success).toBe(true)
    // Closes stay within the recent real ECB range (+1% margin) relative to the anchor.
    const closes = a.map((c) => c.close)
    expect(Math.min(...closes)).toBeGreaterThanOrEqual(RECENT_RANGE.low * 0.99 - 0.001)
    expect(Math.max(...closes)).toBeLessThanOrEqual(RECENT_RANGE.high * 1.01 + 0.001)
    // A custom anchor keeps the same relative band.
    const c = generateDailyCandles({ anchor: 150, today }).map((x) => x.close)
    expect(Math.max(...c)).toBeLessThanOrEqual(150 * (RECENT_RANGE.high / DEFAULT_ANCHOR.price) * 1.01 + 0.001)
  })

  it('builds valid, clearly labelled scenarios', () => {
    const plan = buildSeedPlan(generateDailyCandles({ anchor: 159.7, today }))
    expect(plan).toHaveLength(8)
    for (const s of plan) {
      expect(s.thesis).toMatch(/^\[SYNTHETIC SEED/)
      const parsed = scenarioInputSchema.safeParse({ symbol: 'USDJPY', timeframe: s.timeframe, side: s.side, entry: s.entry, stop: s.stop, target: s.target, thesis: s.thesis, invalidation: s.invalidation })
      expect(parsed.success, s.key).toBe(true)
    }
    expect(plan.map((s) => s.side)).toContain('SHORT')
  })
})

describe('runSeed against the local API (in-memory SQLite)', () => {
  const setup = () => {
    const env = { DB: createTestD1().d1, QUOTE_PROVIDER: 'synthetic' }
    const fetchImpl = (url, init) => app.request(url, init, env)
    return { env, fetchImpl }
  }
  const quiet = () => {}

  it('loads datasets, scenarios, placeholder reviews, outcomes and grades through the API', async () => {
    const { fetchImpl } = setup()
    const s = await runSeed({ fetchImpl, today, log: quiet })
    expect(s).toMatchObject({ scenarios: 8, reviews: 9 })
    expect(s.outcomes).toBe(5)
    expect(s.grades).toBeGreaterThanOrEqual(4)
    const journal = await (await fetchImpl('http://127.0.0.1:8787/api/journal')).json()
    expect(journal.summary).toMatchObject({ scenarios: 8, closed: 5, open: 3 })
    expect(journal.scorecard.awaitingGrade).toBe(2) // BEYOND_STOP scenario is left ungraded on purpose
    const reviews = (await (await fetchImpl(`http://127.0.0.1:8787/api/scenarios/${journal.entries.find((e) => e.reviewCounts.total === 2).scenario.id}`)).json()).reviews
    expect(reviews[0].content).toMatch(/SYNTHETIC DEMO TEXT – not an AI answer/)
    const analysis = (await (await fetchImpl('http://127.0.0.1:8787/api/analysis')).json()).analysis
    expect(analysis.window.closed).toBe(5)
    expect(analysis.byPlan.deviated.count).toBe(2)
    // Realistic R multiples: nothing beyond the planned range (-1.3R rule break .. 3R target).
    for (const e of journal.entries) {
      if (e.outcome) expect(Math.abs(e.outcome.rMultiple), e.scenario.thesis).toBeLessThanOrEqual(3)
      const risk = Math.abs(e.scenario.entry - e.scenario.stop)
      expect(risk).toBeGreaterThanOrEqual(0.3 - 1e-9)
      expect(risk).toBeLessThanOrEqual(2.5)
    }
  })

  it('refuses to add data to a non-empty database unless forced, and is idempotent on re-run', async () => {
    const { fetchImpl } = setup()
    await runSeed({ fetchImpl, today, log: quiet })
    expect(await runSeed({ fetchImpl, today, log: quiet })).toMatchObject({ skipped: true, existing: 8 })
    const again = await runSeed({ fetchImpl, today, force: true, log: quiet }) // same day: idempotency keys replay
    expect(again.outcomes).toBe(0)
    const list = await (await fetchImpl('http://127.0.0.1:8787/api/scenarios')).json()
    expect(list.scenarios).toHaveLength(8)
  })

  it('can anchor to the reference quote or an explicit price, and validates the anchor', async () => {
    const live = setup()
    await runSeed({ fetchImpl: live.fetchImpl, today, anchor: 'live', log: quiet })
    const ds = (await (await live.fetchImpl('http://127.0.0.1:8787/api/market/datasets')).json()).datasets[0]
    expect(ds.sourceNote).toMatch(/anchored to 150\.123 \(SYNTHETIC TEST QUOTE/)
    const manual = setup()
    await runSeed({ fetchImpl: manual.fetchImpl, today, anchor: '148.5', log: quiet })
    const detail = (await (await manual.fetchImpl(`http://127.0.0.1:8787/api/market/datasets/${(await (await manual.fetchImpl('http://127.0.0.1:8787/api/market/datasets')).json()).datasets[0].id}`)).json()).dataset
    expect(detail.candles.at(-1).close).toBe(148.5)
    await expect(runSeed({ fetchImpl: setup().fetchImpl, today, anchor: 'abc', log: quiet })).rejects.toThrow(/ANCHOR/)
    await expect(runSeed({ base: 'http://example.com', fetchImpl: setup().fetchImpl, log: quiet })).rejects.toThrow(/loopback/)
  })
})
