import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { REQUIRED_MIGRATION } from '../src/schema'
import { createTestD1, migrationFiles } from './d1-sqlite'

// All data here is SYNTHETIC test data. No external AI, broker or Cloudflare call is made.
let env: { DB: D1Database }
const base = 'http://127.0.0.1:8787'

async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const method = init.method ?? (init.body === undefined && init.raw === undefined ? 'GET' : 'POST')
  const res = await app.request(base + path, {
    method,
    headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  }, env)
  return { status: res.status, data: await res.json() as any }
}

const scenario = {
  symbol: 'USDJPY', timeframe: '4h', side: 'LONG',
  entry: 150.2, stop: 149.6, target: 151.4,
  thesis: 'Synthetic test thesis: hypothetical pullback',
  invalidation: 'Synthetic close below 149.6',
}
async function createScenario(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const r = await call('/api/scenarios', { body: { ...scenario, ...extra }, headers })
  return r
}

beforeEach(() => { env = { DB: createTestD1().d1 } })

describe('health and setup', () => {
  it('reports ok after migrations and setup_required without them', async () => {
    expect((await call('/api/health')).data).toMatchObject({ status: 'ok', liveMarketData: false, orderExecution: false })
    env = { DB: createTestD1({ migrate: false }).d1 }
    expect((await call('/api/health')).status).toBe(503)
  })

  it('entry module exports only the Worker handler (workerd rejects other named exports)', async () => {
    expect(Object.keys(await import('../src/index'))).toEqual(['default'])
  })

  it('requires the latest migration file (keeps REQUIRED_MIGRATION in sync)', () => {
    expect(REQUIRED_MIGRATION).toBe(migrationFiles().at(-1))
  })

  it('reports pending migrations instead of failing later with "no such column"', async () => {
    const { d1, raw } = createTestD1()
    raw.prepare('DELETE FROM d1_migrations WHERE name = ?').run(REQUIRED_MIGRATION)
    env = { DB: d1 }
    const { status, data } = await call('/api/health')
    expect(status).toBe(503)
    expect(data).toMatchObject({ status: 'setup_required', requiredMigration: REQUIRED_MIGRATION })
    expect(data.error).toMatch(/make migrate/)
  })
})

describe('scenarios', () => {
  it('creates, lists and reads a scenario with computed R:R', async () => {
    const { status, data } = await createScenario()
    expect(status).toBe(201)
    expect(data.scenario.riskReward).toBe(2)
    const list = await call('/api/scenarios')
    expect(list.data.scenarios.map((s: any) => s.id)).toEqual([data.scenario.id])
    const detail = await call(`/api/scenarios/${data.scenario.id}`)
    expect(detail.data).toMatchObject({ reviews: [], outcome: null, scenario: { thesis: scenario.thesis } })
  })

  it.each([
    ['inverted stop', { stop: 151 }],
    ['inverted target', { target: 149 }],
    ['missing thesis', { thesis: undefined }],
    ['unsupported symbol', { symbol: 'EURUSD' }],
    ['extra field', { apiKey: 'nope' }],
    ['string price', { entry: '150.2' }],
  ])('rejects %s with 400 and issues', async (_label, extra) => {
    const { status, data } = await createScenario(extra)
    expect(status).toBe(400)
    expect(data.error).toBe('Invalid scenario')
    expect(data.issues.length).toBeGreaterThan(0)
  })

  it('rejects malformed JSON, non-JSON content type and cross-origin writes', async () => {
    expect((await call('/api/scenarios', { raw: '{bad' })).data.error).toBe('Malformed JSON body')
    expect((await call('/api/scenarios', { raw: 'a=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status).toBe(415)
    expect((await createScenario({}, { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await createScenario({}, { Origin: 'http://127.0.0.1:5173' })).status).toBe(201)
  })

  it('rejects non-loopback Host headers', async () => {
    const res = await app.request('http://attacker.example/api/scenarios', { headers: { Host: 'attacker.example' } }, env)
    expect(res.status).toBe(403)
  })

  it('returns JSON 404 for missing scenario and unknown route', async () => {
    expect((await call('/api/scenarios/not-a-real-id')).status).toBe(404)
    expect((await call('/api/nope')).data).toEqual({ error: 'Not found' })
  })

  it('deduplicates double submission with the same Idempotency-Key', async () => {
    const headers = { 'Idempotency-Key': 'scenario-key-0001' }
    const first = await createScenario({}, headers)
    const second = await createScenario({}, headers)
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.data.replayed).toBe(true)
    expect(second.data.scenario.id).toBe(first.data.scenario.id)
    expect((await call('/api/scenarios')).data.scenarios).toHaveLength(1)
    expect((await createScenario({}, { 'Idempotency-Key': 'bad key!' })).status).toBe(400)
  })

  it('rejects oversized bodies', async () => {
    const { status } = await createScenario({ thesis: 'x'.repeat(70 * 1024) })
    expect(status).toBe(413)
  })
})

describe('manual AI reviews', () => {
  it('stores provider, role, respondedAt and returns them in detail (newest first)', async () => {
    const id = (await createScenario()).data.scenario.id
    const a = await call(`/api/scenarios/${id}/reviews`, { body: { provider: 'chatgpt', role: 'BEAR', content: 'Synthetic bear answer.', respondedAt: '2026-11-01T09:00:00+09:00' } })
    expect(a.status).toBe(201)
    expect(a.data.review).toMatchObject({ provider: 'chatgpt', role: 'BEAR', respondedAt: '2026-11-01T00:00:00.000Z', source: 'manual_paste' })
    const b = await call(`/api/scenarios/${id}/reviews`, { body: { provider: 'claude', role: 'BULL', content: '<script>alert(1)</script> synthetic' } })
    expect(b.data.review.respondedAt).toBe(b.data.review.createdAt)
    const detail = await call(`/api/scenarios/${id}`)
    expect(detail.data.reviews.map((r: any) => r.provider).sort()).toEqual(['chatgpt', 'claude'])
    // Stored verbatim as text; rendering safety is the UI's job (React text nodes, no innerHTML).
    expect(detail.data.reviews.find((r: any) => r.provider === 'claude').content).toContain('<script>')
  })

  it('validates review input and scenario existence', async () => {
    const id = (await createScenario()).data.scenario.id
    expect((await call(`/api/scenarios/${id}/reviews`, { body: { provider: 'chatgpt', role: 'BEAR', content: 'short' } })).status).toBe(400)
    expect((await call(`/api/scenarios/${id}/reviews`, { body: { provider: 'chatgpt', role: 'NEUTRAL', content: 'long enough text' } })).status).toBe(400)
    expect((await call(`/api/scenarios/${id}/reviews`, { body: { provider: 'chatgpt', role: 'BEAR', content: 'long enough text', respondedAt: '2999-01-01T00:00:00Z' } })).status).toBe(400)
    expect((await call('/api/scenarios/missing/reviews', { body: { provider: 'chatgpt', role: 'BEAR', content: 'long enough text' } })).status).toBe(404)
  })

  it('deduplicates review double submission', async () => {
    const id = (await createScenario()).data.scenario.id
    const body = { provider: 'gemini', role: 'BULL', content: 'Synthetic bull answer' }
    const headers = { 'Idempotency-Key': 'review-key-0001' }
    await call(`/api/scenarios/${id}/reviews`, { body, headers })
    const again = await call(`/api/scenarios/${id}/reviews`, { body, headers })
    expect(again.status).toBe(200)
    expect((await call(`/api/scenarios/${id}`)).data.reviews).toHaveLength(1)
    const other = (await createScenario()).data.scenario.id
    expect((await call(`/api/scenarios/${other}/reviews`, { body, headers })).status).toBe(409)
  })
})

describe('paper outcome and journal', () => {
  it('records one immutable paper outcome with R multiple and rejects duplicates', async () => {
    const id = (await createScenario()).data.scenario.id
    const first = await call(`/api/scenarios/${id}/paper-outcome`, { body: { exitPrice: 150.8, exitReason: 'MANUAL', followedPlan: false, note: 'Synthetic early exit' } })
    expect(first.status).toBe(201)
    expect(first.data.outcome).toMatchObject({ rMultiple: 1, exitReason: 'MANUAL', followedPlan: false, kind: 'paper' })
    const dup = await call(`/api/scenarios/${id}/paper-outcome`, { body: { exitPrice: 149.6 } })
    expect(dup.status).toBe(409)
    expect((await call(`/api/scenarios/${id}`)).data.outcome.exitPrice).toBe(150.8)
  })

  it('validates paper outcome input', async () => {
    const id = (await createScenario()).data.scenario.id
    expect((await call(`/api/scenarios/${id}/paper-outcome`, { body: { exitPrice: 0 } })).status).toBe(400)
    expect((await call(`/api/scenarios/${id}/paper-outcome`, { body: { exitPrice: 150, exitReason: 'BROKER_FILL' } })).status).toBe(400)
    expect((await call(`/api/scenarios/${id}/paper-outcome`, { body: {} })).status).toBe(400)
    expect((await call('/api/scenarios/missing/paper-outcome', { body: { exitPrice: 150 } })).status).toBe(404)
  })

  it('returns journal entries with review counts and paper summary', async () => {
    const a = (await createScenario()).data.scenario.id
    const b = (await createScenario({ side: 'SHORT', stop: 151, target: 149 })).data.scenario.id
    await call(`/api/scenarios/${a}/reviews`, { body: { provider: 'grok', role: 'BEAR', content: 'Synthetic bear text' } })
    await call(`/api/scenarios/${a}/reviews`, { body: { provider: 'claude', role: 'BULL', content: 'Synthetic bull text' } })
    await call(`/api/scenarios/${a}/paper-outcome`, { body: { exitPrice: 151.4, exitReason: 'TARGET' } })
    const { data } = await call('/api/journal')
    expect(data.kind).toBe('paper')
    expect(data.entries).toHaveLength(2)
    const ea = data.entries.find((e: any) => e.scenario.id === a)
    expect(ea.reviewCounts).toEqual({ total: 2, bull: 1, bear: 1, graded: 0, providers: ['claude', 'grok'] })
    expect(ea.outcome).toMatchObject({ rMultiple: 2, exitReason: 'TARGET', followedPlan: true })
    expect(data.entries.find((e: any) => e.scenario.id === b).outcome).toBeNull()
    expect(data.summary).toMatchObject({ scenarios: 2, closed: 1, open: 1, wins: 1, totalR: 2, averageR: 2 })
  })
})

describe('market datasets', () => {
  const candles = [
    { date: '2026-01-05', open: 150, high: 150.8, low: 149.7, close: 150.5 },
    { date: '2026-01-06', open: 150.5, high: 151.2, low: 150.1, close: 151 },
  ]
  const dataset = { symbol: 'USDJPY', timeframe: '1d', sourceName: 'synthetic-test.csv', candles }

  it('stores a validated CSV snapshot and serves it with stats, flagged unverified', async () => {
    const created = await call('/api/market/datasets', { body: dataset })
    expect(created.status).toBe(201)
    expect(created.data.dataset).toMatchObject({ verified: false, candleCount: 2, stats: { high: 151.2, low: 149.7, changePct: 0.332 } })
    const list = await call('/api/market/datasets')
    expect(list.data.datasets[0]).not.toHaveProperty('candles')
    const detail = await call(`/api/market/datasets/${created.data.dataset.id}`)
    expect(detail.data.dataset.candles).toEqual(candles)
    expect((await call('/api/market/datasets/missing')).status).toBe(404)
  })

  it('rejects inconsistent or unsorted candles server-side', async () => {
    expect((await call('/api/market/datasets', { body: { ...dataset, candles: [...candles].reverse() } })).status).toBe(400)
    expect((await call('/api/market/datasets', { body: { ...dataset, candles: [{ ...candles[0], low: 151 }, candles[1]] } })).status).toBe(400)
    expect((await call('/api/market/datasets', { body: { ...dataset, symbol: 'BTCUSD' } })).status).toBe(400)
  })
})

describe('post-hoc review grading (答え合わせ)', () => {
  async function setup() {
    const id = (await createScenario()).data.scenario.id
    const bull = (await call(`/api/scenarios/${id}/reviews`, { body: { provider: 'claude', role: 'BULL', content: 'Synthetic bull argument' } })).data.review
    const bear = (await call(`/api/scenarios/${id}/reviews`, { body: { provider: 'chatgpt', role: 'BEAR', content: 'Synthetic bear argument' } })).data.review
    return { id, bull, bear }
  }
  const grade = (id: string, reviewId: string, body: unknown) =>
    call(`/api/scenarios/${id}/reviews/${reviewId}/grade`, { method: 'PUT', body })

  it('new reviews start ungraded', async () => {
    const { id } = await setup()
    const detail = await call(`/api/scenarios/${id}`)
    expect(detail.data.reviews.every((r: any) => r.grade === null)).toBe(true)
  })

  it('refuses grading before a paper outcome exists (409)', async () => {
    const { id, bull } = await setup()
    const res = await grade(id, bull.id, { verdict: 'HIT' })
    expect(res.status).toBe(409)
    expect((await call(`/api/scenarios/${id}`)).data.reviews.find((r: any) => r.id === bull.id).grade).toBeNull()
  })

  it('grades, persists, allows re-grading and reports a scorecard', async () => {
    const { id, bull, bear } = await setup()
    await call(`/api/scenarios/${id}/paper-outcome`, { body: { exitPrice: 149.6, exitReason: 'STOP' } }) // -1R loss
    const g1 = await grade(id, bear.id, { verdict: 'HIT', note: 'Synthetic: the bear warning came true' })
    expect(g1.status).toBe(200)
    expect(g1.data.review.grade).toMatchObject({ verdict: 'HIT', note: 'Synthetic: the bear warning came true' })
    await grade(id, bull.id, { verdict: 'HIT' })
    const regrade = await grade(id, bull.id, { verdict: 'MISS' })
    expect(regrade.data.review.grade.verdict).toBe('MISS')

    const detail = await call(`/api/scenarios/${id}`)
    const byId = Object.fromEntries(detail.data.reviews.map((r: any) => [r.id, r.grade?.verdict]))
    expect(byId).toEqual({ [bull.id]: 'MISS', [bear.id]: 'HIT' })
    // Outcome stays immutable regardless of grading.
    expect(detail.data.outcome.rMultiple).toBe(-1)

    const { data } = await call('/api/journal')
    expect(data.entries[0].reviewCounts.graded).toBe(2)
    expect(data.scorecard.overall).toMatchObject({ reviews: 2, graded: 2, hit: 1, miss: 1, hitRate: 0.5 })
    expect(data.scorecard.cells).toEqual([
      { provider: 'chatgpt', role: 'BEAR', reviews: 1, graded: 1, hit: 1, miss: 0, unclear: 0, hitRate: 1 },
      { provider: 'claude', role: 'BULL', reviews: 1, graded: 1, hit: 0, miss: 1, unclear: 0, hitRate: 0 },
    ])
    expect(data.scorecard.lossesWarnedByBear).toBe(1)
    expect(data.scorecard.awaitingGrade).toBe(0)
  })

  it('counts reviews awaiting a grade once an outcome exists', async () => {
    const { id } = await setup()
    expect((await call('/api/journal')).data.scorecard.awaitingGrade).toBe(0)
    await call(`/api/scenarios/${id}/paper-outcome`, { body: { exitPrice: 151.4 } })
    expect((await call('/api/journal')).data.scorecard.awaitingGrade).toBe(2)
  })

  it('validates verdict, review ownership and content type', async () => {
    const { id, bull } = await setup()
    await call(`/api/scenarios/${id}/paper-outcome`, { body: { exitPrice: 151.4 } })
    expect((await grade(id, bull.id, { verdict: 'CORRECT' })).status).toBe(400)
    expect((await grade(id, bull.id, { verdict: 'HIT', extra: 1 })).status).toBe(400)
    expect((await grade(id, 'missing-review', { verdict: 'HIT' })).status).toBe(404)
    const other = (await createScenario()).data.scenario.id
    expect((await grade(other, bull.id, { verdict: 'HIT' })).status).toBe(404) // review belongs to another scenario
    const res = await app.request(`${base}/api/scenarios/${id}/reviews/${bull.id}/grade`, { method: 'PUT', body: 'verdict=HIT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, env)
    expect(res.status).toBe(415)
    const cross = await call(`/api/scenarios/${id}/reviews/${bull.id}/grade`, { method: 'PUT', body: { verdict: 'HIT' }, headers: { Origin: 'https://evil.example' } })
    expect(cross.status).toBe(403)
  })
})

describe('root guidance', () => {
  it('explains that the UI is on :5173 and still enforces the localhost guard', async () => {
    const { status, data } = await call('/')
    expect(status).toBe(200)
    expect(data).toMatchObject({ web: 'http://127.0.0.1:5173', health: '/api/health' })
    const res = await app.request('http://evil.example/', { headers: { Host: 'evil.example' } }, env)
    expect(res.status).toBe(403)
  })
})

describe('market link and path check (synthetic candles)', () => {
  // Daily JST candles. LONG entry 150 / stop 149 / target 152 (R:R 2).
  const jst = [
    { date: '2026-01-05', open: 149.8, high: 150.3, low: 149.6, close: 150.0 },
    { date: '2026-01-06', open: 150.0, high: 151.0, low: 149.4, close: 150.6 },
    { date: '2026-01-07', open: 150.6, high: 152.2, low: 150.4, close: 152.0 },
  ]
  const importJst = async () => (await call('/api/market/datasets', { body: { symbol: 'USDJPY', timeframe: '1d', sourceName: 'synthetic-jst.csv', tzOffset: '+09:00', candles: jst } })).data.dataset
  const linked = (datasetId: string, asOfDate: string) => createScenario({ entry: 150, stop: 149, target: 152, marketRef: { datasetId, asOfDate } })

  it('stores tzOffset on datasets and rejects malformed offsets', async () => {
    expect((await importJst()).tzOffset).toBe('+09:00')
    expect((await call('/api/market/datasets', { body: { symbol: 'USDJPY', timeframe: '1d', sourceName: 'x.csv', tzOffset: 'JST', candles: jst } })).status).toBe(400)
    const legacy = await call('/api/market/datasets', { body: { symbol: 'USDJPY', timeframe: '1d', sourceName: 'y.csv', candles: jst } })
    expect(legacy.data.dataset.tzOffset).toBeNull()
  })

  it('links a scenario to an as-of candle and fixes the as-of close instant', async () => {
    const ds = await importJst()
    const { status, data } = await linked(ds.id, '2026-01-05')
    expect(status).toBe(201)
    // 2026-01-05 00:00 JST = 2026-01-04T15:00Z; daily close = +24h.
    expect(data.scenario.marketRef).toEqual({ datasetId: ds.id, asOfDate: '2026-01-05', asOfAt: '2026-01-05T15:00:00.000Z' })
    const detail = await call(`/api/scenarios/${data.scenario.id}`)
    expect(detail.data.scenario.marketRef.asOfAt).toBe('2026-01-05T15:00:00.000Z')
    const unlinked = await createScenario()
    expect(unlinked.data.scenario.marketRef).toBeNull()
  })

  it('rejects links to unknown datasets or candles', async () => {
    const ds = await importJst()
    const missingDs = await linked('nope', '2026-01-05')
    expect(missingDs.status).toBe(400)
    expect(missingDs.data.issues[0].path).toBe('marketRef.datasetId')
    const missingBar = await linked(ds.id, '2026-01-09')
    expect(missingBar.status).toBe(400)
    expect(missingBar.data.issues[0].path).toBe('marketRef.asOfDate')
  })

  it('evaluates candles after the as-of close: stop/target order, MFE/MAE and chart window', async () => {
    const ds = await importJst()
    const id = (await linked(ds.id, '2026-01-05')).data.scenario.id
    const { status, data } = await call(`/api/scenarios/${id}/path-check`)
    expect(status).toBe(200)
    expect(data.kind).toBe('reference')
    expect(data.dataset.id).toBe(ds.id)
    // 01-06 touches 149.4 <= stop 149 ? no (149.4 > 149). 01-07 reaches 152.2 >= target.
    expect(data.evaluation).toMatchObject({ outcome: 'TARGET_FIRST', decidedDate: '2026-01-07', barsChecked: 2, referenceR: 2, mfeR: 1, maeR: -0.6 })
    expect(data.chart.firstAfterIndex).toBe(1)
    expect(data.chart.decidedIndex).toBe(2)
    expect(data.chart.candles).toHaveLength(3)
  })

  it('reports NO_DATA when nothing exists after the as-of candle, then uses a newer import', async () => {
    const ds = await importJst()
    const id = (await linked(ds.id, '2026-01-07')).data.scenario.id
    const first = await call(`/api/scenarios/${id}/path-check`)
    expect(first.data.evaluation.outcome).toBe('NO_DATA')
    expect(first.data.candidates).toEqual([])
    // A later UTC export of synthetic hourly bars: first bar 2026-01-07T15:00Z opens exactly at the as-of close.
    const newer = (await call('/api/market/datasets', { body: { symbol: 'USDJPY', timeframe: '1h', sourceName: 'synthetic-later-utc.csv', tzOffset: '+00:00', candles: [
      { date: '2026-01-07 14:00', open: 151.5, high: 153.0, low: 148.0, close: 150.0 }, // inside the as-of daily bar: ignored
      { date: '2026-01-07 15:00', open: 150.0, high: 150.5, low: 148.9, close: 149.0 },
      { date: '2026-01-07 16:00', open: 149.0, high: 152.5, low: 148.8, close: 152.0 },
    ] } })).data.dataset
    const second = await call(`/api/scenarios/${id}/path-check`)
    expect(second.data.dataset.id).toBe(newer.id)
    expect(second.data.candidates.map((d: any) => d.id)).toEqual([newer.id])
    expect(second.data.evaluation).toMatchObject({ outcome: 'STOP_FIRST', decidedDate: '2026-01-07 15:00', barsChecked: 1 })
    // Explicit dataset selection still works.
    expect((await call(`/api/scenarios/${id}/path-check?datasetId=${ds.id}`)).data.evaluation.outcome).toBe('NO_DATA')
  })

  it('reports AMBIGUOUS when one candle spans both levels', async () => {
    const ds = (await call('/api/market/datasets', { body: { symbol: 'USDJPY', timeframe: '1d', sourceName: 'amb.csv', candles: [
      { date: '2026-02-02', open: 150, high: 150.5, low: 149.5, close: 150 },
      { date: '2026-02-03', open: 150, high: 152.5, low: 148.5, close: 150 },
    ] } })).data.dataset
    const id = (await linked(ds.id, '2026-02-02')).data.scenario.id
    expect((await call(`/api/scenarios/${id}/path-check`)).data.evaluation).toMatchObject({ outcome: 'AMBIGUOUS', referenceR: null })
  })

  it('returns 409 for unlinked scenarios and 404 for unknown ids', async () => {
    const id = (await createScenario()).data.scenario.id
    expect((await call(`/api/scenarios/${id}/path-check`)).status).toBe(409)
    expect((await call('/api/scenarios/missing/path-check')).status).toBe(404)
    const ds = await importJst()
    const linkedId = (await linked(ds.id, '2026-01-05')).data.scenario.id
    expect((await call(`/api/scenarios/${linkedId}/path-check?datasetId=missing`)).status).toBe(404)
  })
})

describe('decision analysis and export', () => {
  async function seed() {
    // Synthetic: linked LONG (entry 150 / stop 149 / target 152) whose CSV hits the target first,
    // closed early at +0.5R; plus an unlinked scenario closed at -1R that deviated from the plan.
    const ds = (await call('/api/market/datasets', { body: { symbol: 'USDJPY', timeframe: '1d', sourceName: 'synthetic.csv', tzOffset: '+00:00', candles: [
      { date: '2026-03-02', open: 149.8, high: 150.2, low: 149.7, close: 150.0 },
      { date: '2026-03-03', open: 150.0, high: 152.3, low: 149.6, close: 152.1 },
    ] } })).data.dataset
    const linked = (await createScenario({ entry: 150, stop: 149, target: 152, thesis: '=HYPERLINK("http://evil") synthetic thesis', marketRef: { datasetId: ds.id, asOfDate: '2026-03-02' } })).data.scenario
    await call(`/api/scenarios/${linked.id}/reviews`, { body: { provider: 'claude', role: 'BULL', content: 'Synthetic bull, "quoted", with comma' } })
    await call(`/api/scenarios/${linked.id}/paper-outcome`, { body: { exitPrice: 150.5, exitReason: 'MANUAL', note: 'Synthetic early exit\nsecond line' } })
    const plain = (await createScenario()).data.scenario
    await call(`/api/scenarios/${plain.id}/paper-outcome`, { body: { exitPrice: 149.6, exitReason: 'STOP', followedPlan: false } })
    await createScenario() // open, no outcome
    return { linked, plain }
  }

  it('aggregates paper outcomes and compares them with the reference path', async () => {
    await seed()
    const { status, data } = await call('/api/analysis')
    expect(status).toBe(200)
    expect(data.kind).toBe('paper')
    const a = data.analysis
    expect(a.window).toMatchObject({ requested: null, closed: 2, scenarios: 3 })
    expect(a.overview).toMatchObject({ count: 2, totalR: -0.5, averageR: -0.25, winRate: 0.5 })
    expect(a.byPlan.deviated).toMatchObject({ count: 1, totalR: -1 })
    expect(a.pathComparison).toMatchObject({ compared: 1, missedTarget: { count: 1, totalR: 1.5 }, excluded: { unlinked: 1 } })
    expect(a.equity.map((p: any) => p.cumulativeR)).toEqual([0.5, -0.5])
  })

  it('validates the limit parameter', async () => {
    await seed()
    expect((await call('/api/analysis?limit=1')).data.analysis.window.closed).toBe(1)
    expect((await call('/api/analysis?limit=all')).data.analysis.window.closed).toBe(2)
    expect((await call('/api/analysis?limit=0')).status).toBe(400)
    expect((await call('/api/analysis?limit=abc')).status).toBe(400)
  })

  it('exports JSON with notice, grades, outcomes and path references', async () => {
    const { linked } = await seed()
    const res = await app.request(`${base}/api/export?format=json`, {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="tradecourt-export-.*\.json"/)
    const body = await res.json() as any
    expect(body.kind).toBe('paper')
    expect(body.notice).toMatch(/not broker fills/)
    expect(body.datasets[0]).not.toHaveProperty('candles')
    const item = body.scenarios.find((x: any) => x.scenario.id === linked.id)
    expect(item.reviews).toHaveLength(1)
    expect(item.outcome.rMultiple).toBe(0.5)
    expect(item.pathReference.evaluation.outcome).toBe('TARGET_FIRST')
  })

  it('exports CSV with BOM, escaping and formula-injection guard', async () => {
    await seed()
    const res = await app.request(`${base}/api/export?format=csv`, {}, env)
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM (text() would strip it)
    const text = new TextDecoder().decode(bytes)
    const lines = text.split('\r\n')
    expect(lines[0].startsWith('scenario_id,created_at,')).toBe(true)
    expect(text).toContain(`"'=HYPERLINK(""http://evil"") synthetic thesis"`)
    expect(text).toContain('"Synthetic early exit\nsecond line"')
    expect(text).toContain('TARGET_FIRST,2,2026-03-03,"paper (user-entered, not broker fills)"')
    expect(text.trim().split('\r\n')).toHaveLength(4) // header + 3 scenarios
    expect((await call('/api/export?format=xml')).status).toBe(400)
  })

  it('works on an empty database', async () => {
    expect((await call('/api/analysis')).data.analysis.overview.count).toBe(0)
    const res = await app.request(`${base}/api/export?format=csv`, {}, env)
    expect((await res.text()).trim().split('\r\n')).toHaveLength(1)
  })
})

describe('optional reference quote (user-initiated)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const withProvider = (provider?: string) => { env = { ...env, QUOTE_PROVIDER: provider } as typeof env }

  it('is disabled unless configured, and health reports the provider', async () => {
    expect((await call('/api/health')).data.quoteProvider).toBe('off')
    expect((await call('/api/quote/usdjpy')).status).toBe(403)
    withProvider('something-else')
    expect((await call('/api/quote/usdjpy')).status).toBe(403)
  })

  it('synthetic provider returns a labelled fixed value without network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    withProvider('synthetic')
    const { status, data } = await call('/api/quote/usdjpy')
    expect(status).toBe(200)
    expect(data.quote).toMatchObject({ symbol: 'USDJPY', price: 150.123, provider: 'synthetic', realtime: false, kind: 'reference' })
    expect(data.quote.source).toMatch(/SYNTHETIC/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('frankfurter provider: validated ECB daily reference rate, plain GET without user data', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-11-12', rates: { JPY: 159.7 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    withProvider('frankfurter')
    expect((await call('/api/health')).data.quoteProvider).toBe('frankfurter')
    const { status, data } = await call('/api/quote/usdjpy')
    expect(status).toBe(200)
    expect(data.quote).toMatchObject({ price: 159.7, asOf: '2026-11-12', provider: 'frankfurter', realtime: false })
    expect(data.quote.source).toMatch(/European Central Bank daily reference rate/)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY')
    expect(init.body).toBeUndefined()
    expect(init.method).toBeUndefined() // GET
  })

  it.each([
    ['HTTP error', async () => new Response('down', { status: 500 })],
    ['malformed body', async () => new Response('not json', { status: 200 })],
    ['out-of-range value', async () => new Response(JSON.stringify({ base: 'USD', date: '2026-11-12', rates: { JPY: 9999 } }), { status: 200 })],
    ['network failure', async () => { throw new TypeError('fetch failed') }],
  ])('frankfurter provider: %s -> 502 without crashing', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    withProvider('frankfurter')
    const { status, data } = await call('/api/quote/usdjpy')
    expect(status).toBe(502)
    expect(data.error).toMatch(/Quote provider/)
  })
})
