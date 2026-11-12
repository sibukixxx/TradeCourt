import { Hono } from 'hono'
import {
  calculatePaperRMultiple,
  calculateRiskReward,
  paperOutcomeInputSchema,
  reviewInputSchema,
  scenarioInputSchema,
  type PaperOutcome,
  type Review,
  type Scenario,
} from '@tradecourt/core'

type Bindings = { DB: D1Database }
const app = new Hono<{ Bindings: Bindings }>()

type ScenarioRow = {
  id: string
  symbol: 'USDJPY'
  timeframe: '1h' | '4h' | '1d'
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  thesis: string
  invalidation: string
  created_at: string
}
type ReviewRow = {
  id: string
  scenario_id: string
  provider: Review['provider']
  role: Review['role']
  content: string
  created_at: string
}
type OutcomeRow = {
  scenario_id: string
  exit_price: number
  r_multiple: number
  note: string
  recorded_at: string
}

const scenarioDto = (r: ScenarioRow): Scenario => ({
  id: r.id,
  symbol: r.symbol,
  timeframe: r.timeframe,
  side: r.side,
  entry: r.entry,
  stop: r.stop,
  target: r.target,
  thesis: r.thesis,
  invalidation: r.invalidation,
  createdAt: r.created_at,
  riskReward: calculateRiskReward(r),
})
const reviewDto = (r: ReviewRow): Review => ({
  id: r.id,
  scenarioId: r.scenario_id,
  provider: r.provider,
  role: r.role,
  content: r.content,
  createdAt: r.created_at,
})
const outcomeDto = (r: OutcomeRow): PaperOutcome => ({
  scenarioId: r.scenario_id,
  exitPrice: r.exit_price,
  rMultiple: r.r_multiple,
  note: r.note,
  recordedAt: r.recorded_at,
})
function issuesFrom(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
}

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scenarios'",
  ).first<{ name: string }>()
  if (!row) return c.json({ status: 'setup_required', message: 'Run pnpm db:migrate:local' }, 503)
  return c.json({ status: 'ok', mode: 'local', liveMarketData: false })
})

app.get('/api/scenarios', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM scenarios ORDER BY created_at DESC, id DESC LIMIT 100',
  ).all<ScenarioRow>()
  return c.json({ scenarios: results.map(scenarioDto) })
})

app.post('/api/scenarios', async (c) => {
  const input = scenarioInputSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid scenario', issues: issuesFrom(input.error) }, 400)

  const s = input.data
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await c.env.DB.prepare(
    `INSERT INTO scenarios
      (id,symbol,timeframe,side,entry,stop,target,thesis,invalidation,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, s.symbol, s.timeframe, s.side, s.entry, s.stop, s.target, s.thesis, s.invalidation, createdAt).run()

  return c.json({ scenario: { ...s, id, createdAt, riskReward: calculateRiskReward(s) } }, 201)
})

app.get('/api/scenarios/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM scenarios WHERE id = ?').bind(id).first<ScenarioRow>()
  if (!row) return c.json({ error: 'Scenario not found' }, 404)

  const reviews = await c.env.DB.prepare(
    'SELECT * FROM reviews WHERE scenario_id = ? ORDER BY created_at DESC, id DESC',
  ).bind(id).all<ReviewRow>()
  const outcome = await c.env.DB.prepare(
    'SELECT * FROM paper_outcomes WHERE scenario_id = ?',
  ).bind(id).first<OutcomeRow>()

  return c.json({
    scenario: scenarioDto(row),
    reviews: reviews.results.map(reviewDto),
    outcome: outcome ? outcomeDto(outcome) : null,
  })
})

app.post('/api/scenarios/:id/reviews', async (c) => {
  const id = c.req.param('id')
  const exists = await c.env.DB.prepare('SELECT id FROM scenarios WHERE id = ?').bind(id).first()
  if (!exists) return c.json({ error: 'Scenario not found' }, 404)

  const input = reviewInputSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid review', issues: issuesFrom(input.error) }, 400)
  const review = { ...input.data, id: crypto.randomUUID(), scenarioId: id, createdAt: new Date().toISOString() }
  await c.env.DB.prepare(
    'INSERT INTO reviews (id,scenario_id,provider,role,content,created_at) VALUES (?,?,?,?,?,?)',
  ).bind(review.id, id, review.provider, review.role, review.content, review.createdAt).run()

  return c.json({ review }, 201)
})

app.post('/api/scenarios/:id/paper-outcome', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM scenarios WHERE id = ?').bind(id).first<ScenarioRow>()
  if (!row) return c.json({ error: 'Scenario not found' }, 404)

  const input = paperOutcomeInputSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid paper outcome', issues: issuesFrom(input.error) }, 400)
  const prior = await c.env.DB.prepare(
    'SELECT scenario_id FROM paper_outcomes WHERE scenario_id = ?',
  ).bind(id).first()
  if (prior) return c.json({ error: 'Paper outcome already recorded; original is immutable' }, 409)

  const outcome: PaperOutcome = {
    scenarioId: id,
    exitPrice: input.data.exitPrice,
    rMultiple: calculatePaperRMultiple(row, input.data.exitPrice),
    note: input.data.note,
    recordedAt: new Date().toISOString(),
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO paper_outcomes (scenario_id,exit_price,r_multiple,note,recorded_at) VALUES (?,?,?,?,?)',
    ).bind(id, outcome.exitPrice, outcome.rMultiple, outcome.note, outcome.recordedAt).run()
  } catch (e) {
    // Do not convert every storage failure into success. A concurrent duplicate is still a conflict.
    const existsNow = await c.env.DB.prepare(
      'SELECT scenario_id FROM paper_outcomes WHERE scenario_id = ?',
    ).bind(id).first()
    if (existsNow) return c.json({ error: 'Paper outcome already recorded' }, 409)
    throw e
  }
  return c.json({ outcome }, 201)
})

// Local development only. Do not expose publicly before an authentication release gate.
app.onError((error, c) => {
  console.error('TradeCourt API error:', error.name)
  return c.json({ error: 'Internal error; check local API logs' }, 500)
})

export default app
