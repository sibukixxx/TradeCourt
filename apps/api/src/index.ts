import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  calculatePaperRMultiple,
  calculateRiskReward,
  marketDatasetInputSchema,
  paperOutcomeInputSchema,
  reviewGradeInputSchema,
  reviewInputSchema,
  scenarioInputSchema,
  summarizeCandles,
  summarizeJournal,
  summarizeReviewGrades,
  type Candle,
  type JournalEntry,
  type JournalResponse,
  type ReviewScoreRow,
  type Verdict,
  type MarketDataset,
  type MarketDatasetMeta,
  type PaperOutcome,
  type Provider,
  type Review,
  type Scenario,
} from '@tradecourt/core'

// LOCAL DEVELOPMENT ONLY. There is no authentication. Do not deploy publicly.
type Bindings = { DB: D1Database }
type AppContext = Context<{ Bindings: Bindings }>
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
  responded_at: string | null
  created_at: string
  verdict: Verdict | null
  verdict_note: string
  graded_at: string | null
}
type OutcomeRow = {
  scenario_id: string
  exit_price: number
  r_multiple: number
  exit_reason: PaperOutcome['exitReason']
  followed_plan: number
  note: string
  recorded_at: string
}
type DatasetRow = {
  id: string
  symbol: 'USDJPY'
  timeframe: '1h' | '4h' | '1d'
  source_name: string
  source_note: string
  candle_count: number
  first_date: string
  last_date: string
  candles_json?: string
  imported_at: string
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
  respondedAt: r.responded_at ?? r.created_at,
  createdAt: r.created_at,
  source: 'manual_paste',
  grade: r.verdict && r.graded_at ? { verdict: r.verdict, note: r.verdict_note, gradedAt: r.graded_at } : null,
})
const outcomeDto = (r: OutcomeRow): PaperOutcome => ({
  scenarioId: r.scenario_id,
  exitPrice: r.exit_price,
  rMultiple: r.r_multiple,
  exitReason: r.exit_reason,
  followedPlan: r.followed_plan === 1,
  note: r.note,
  recordedAt: r.recorded_at,
  kind: 'paper',
})
const datasetMeta = (r: DatasetRow): MarketDatasetMeta => ({
  id: r.id,
  symbol: r.symbol,
  timeframe: r.timeframe,
  sourceName: r.source_name,
  sourceNote: r.source_note,
  candleCount: r.candle_count,
  firstDate: r.first_date,
  lastDate: r.last_date,
  importedAt: r.imported_at,
  verified: false as const,
})

type Issue = { path: PropertyKey[]; message: string }
const issuesFrom = (error: { issues: ReadonlyArray<Issue> }) =>
  error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))

const MALFORMED = Symbol('malformed')
async function readJson(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return MALFORMED
  }
}
function badRequest(c: AppContext, label: string, body: unknown, issues?: ReturnType<typeof issuesFrom>) {
  if (body === MALFORMED) return c.json({ error: 'Malformed JSON body' }, 400)
  return c.json({ error: label, issues: issues ?? [] }, 400)
}

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
/** Returns undefined when absent, null when malformed. */
function idempotencyKey(c: AppContext): string | undefined | null {
  const key = c.req.header('Idempotency-Key')
  if (key === undefined) return undefined
  return IDEMPOTENCY_PATTERN.test(key) ? key : null
}
const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message)

// ---- Localhost-only guard ------------------------------------------------------------------
// The API has no authentication. Refuse non-loopback Host headers (DNS rebinding) and
// cross-origin browser writes (CSRF from arbitrary websites). Writes must be JSON.
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i

app.use('/api/*', async (c, next) => {
  const host = c.req.header('Host') ?? new URL(c.req.url).host
  if (!LOOPBACK_HOST.test(host)) return c.json({ error: 'TradeCourt API is localhost-only' }, 403)
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('Origin')
    if (origin && !LOOPBACK_ORIGIN.test(origin)) return c.json({ error: 'Cross-origin write rejected' }, 403)
    const type = c.req.header('Content-Type') ?? ''
    if (!/^application\/json\b/i.test(type)) return c.json({ error: 'Content-Type must be application/json' }, 415)
  }
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  await next()
})

const tooLarge = (c: AppContext) => c.json({ error: 'Request body too large' }, 413)
app.use('/api/market/*', bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge }))
app.use('/api/scenarios/*', bodyLimit({ maxSize: 64 * 1024, onError: tooLarge }))
app.use('/api/scenarios', bodyLimit({ maxSize: 64 * 1024, onError: tooLarge }))

// ---- Health ---------------------------------------------------------------------------------
app.get('/api/health', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('scenarios','market_datasets')",
  ).all<{ name: string }>()
  if (results.length < 2) return c.json({ status: 'setup_required', message: 'Run pnpm db:migrate:local' }, 503)
  return c.json({ status: 'ok', mode: 'local', liveMarketData: false, orderExecution: false })
})

// ---- Scenarios --------------------------------------------------------------------------------
app.get('/api/scenarios', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM scenarios ORDER BY created_at DESC, id DESC LIMIT 200',
  ).all<ScenarioRow>()
  return c.json({ scenarios: results.map(scenarioDto) })
})

app.post('/api/scenarios', async (c) => {
  const key = idempotencyKey(c)
  if (key === null) return c.json({ error: 'Invalid Idempotency-Key' }, 400)
  const body = await readJson(c)
  const input = scenarioInputSchema.safeParse(body)
  if (!input.success) return badRequest(c, 'Invalid scenario', body, issuesFrom(input.error))

  const replay = async () => {
    if (!key) return null
    const row = await c.env.DB.prepare('SELECT * FROM scenarios WHERE client_request_id = ?').bind(key).first<ScenarioRow>()
    return row ? c.json({ scenario: scenarioDto(row), replayed: true }, 200) : null
  }
  const prior = await replay()
  if (prior) return prior

  const s = input.data
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  try {
    await c.env.DB.prepare(
      `INSERT INTO scenarios
        (id,symbol,timeframe,side,entry,stop,target,thesis,invalidation,created_at,client_request_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, s.symbol, s.timeframe, s.side, s.entry, s.stop, s.target, s.thesis, s.invalidation, createdAt, key ?? null).run()
  } catch (e) {
    if (isUniqueViolation(e)) {
      const raced = await replay()
      if (raced) return raced
    }
    throw e
  }
  return c.json({ scenario: { ...s, id, createdAt, riskReward: calculateRiskReward(s) } satisfies Scenario }, 201)
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

// ---- Manually pasted AI reviews ---------------------------------------------------------------
app.post('/api/scenarios/:id/reviews', async (c) => {
  const id = c.req.param('id')
  const exists = await c.env.DB.prepare('SELECT id FROM scenarios WHERE id = ?').bind(id).first()
  if (!exists) return c.json({ error: 'Scenario not found' }, 404)
  const key = idempotencyKey(c)
  if (key === null) return c.json({ error: 'Invalid Idempotency-Key' }, 400)

  const body = await readJson(c)
  const input = reviewInputSchema.safeParse(body)
  if (!input.success) return badRequest(c, 'Invalid review', body, issuesFrom(input.error))
  const createdAt = new Date().toISOString()
  if (input.data.respondedAt && Date.parse(input.data.respondedAt) > Date.now() + 5 * 60_000) {
    return c.json({ error: 'Invalid review', issues: [{ path: 'respondedAt', message: 'respondedAt cannot be in the future' }] }, 400)
  }
  const respondedAt = input.data.respondedAt ? new Date(input.data.respondedAt).toISOString() : createdAt

  const replay = async () => {
    if (!key) return null
    const row = await c.env.DB.prepare('SELECT * FROM reviews WHERE client_request_id = ?').bind(key).first<ReviewRow>()
    if (!row) return null
    if (row.scenario_id !== id) return c.json({ error: 'Idempotency-Key already used for another scenario' }, 409)
    return c.json({ review: reviewDto(row), replayed: true }, 200)
  }
  const prior = await replay()
  if (prior) return prior

  const review: Review = {
    id: crypto.randomUUID(),
    scenarioId: id,
    provider: input.data.provider,
    role: input.data.role,
    content: input.data.content,
    respondedAt,
    createdAt,
    source: 'manual_paste',
    grade: null,
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO reviews (id,scenario_id,provider,role,content,responded_at,created_at,client_request_id) VALUES (?,?,?,?,?,?,?,?)',
    ).bind(review.id, id, review.provider, review.role, review.content, review.respondedAt, review.createdAt, key ?? null).run()
  } catch (e) {
    if (isUniqueViolation(e)) {
      const raced = await replay()
      if (raced) return raced
    }
    throw e
  }
  return c.json({ review }, 201)
})

// ---- Paper outcome (one per scenario, immutable) -------------------------------------------
app.post('/api/scenarios/:id/paper-outcome', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM scenarios WHERE id = ?').bind(id).first<ScenarioRow>()
  if (!row) return c.json({ error: 'Scenario not found' }, 404)

  const body = await readJson(c)
  const input = paperOutcomeInputSchema.safeParse(body)
  if (!input.success) return badRequest(c, 'Invalid paper outcome', body, issuesFrom(input.error))
  const prior = await c.env.DB.prepare(
    'SELECT scenario_id FROM paper_outcomes WHERE scenario_id = ?',
  ).bind(id).first()
  if (prior) return c.json({ error: 'Paper outcome already recorded; original is immutable' }, 409)

  const outcome: PaperOutcome = {
    scenarioId: id,
    exitPrice: input.data.exitPrice,
    rMultiple: calculatePaperRMultiple(row, input.data.exitPrice),
    exitReason: input.data.exitReason,
    followedPlan: input.data.followedPlan,
    note: input.data.note,
    recordedAt: new Date().toISOString(),
    kind: 'paper',
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO paper_outcomes (scenario_id,exit_price,r_multiple,exit_reason,followed_plan,note,recorded_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(id, outcome.exitPrice, outcome.rMultiple, outcome.exitReason, outcome.followedPlan ? 1 : 0, outcome.note, outcome.recordedAt).run()
  } catch (e) {
    // A concurrent duplicate is still a conflict; other storage failures surface as 500.
    if (isUniqueViolation(e)) return c.json({ error: 'Paper outcome already recorded; original is immutable' }, 409)
    throw e
  }
  return c.json({ outcome }, 201)
})

// ---- Post-hoc review grading (答え合わせ) ------------------------------------------------
// Only after a paper outcome exists. Re-grading overwrites the verdict (it is the user's own
// judgment, not a trade record); the paper outcome itself stays immutable.
app.put('/api/scenarios/:id/reviews/:reviewId/grade', async (c) => {
  const id = c.req.param('id')
  const reviewId = c.req.param('reviewId')
  const review = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ? AND scenario_id = ?')
    .bind(reviewId, id).first<ReviewRow>()
  if (!review) return c.json({ error: 'Review not found for this scenario' }, 404)

  const body = await readJson(c)
  const input = reviewGradeInputSchema.safeParse(body)
  if (!input.success) return badRequest(c, 'Invalid review grade', body, issuesFrom(input.error))

  const outcome = await c.env.DB.prepare('SELECT scenario_id FROM paper_outcomes WHERE scenario_id = ?').bind(id).first()
  if (!outcome) return c.json({ error: 'Record the paper outcome before grading reviews' }, 409)

  const gradedAt = new Date().toISOString()
  await c.env.DB.prepare('UPDATE reviews SET verdict = ?, verdict_note = ?, graded_at = ? WHERE id = ? AND scenario_id = ?')
    .bind(input.data.verdict, input.data.note, gradedAt, reviewId, id).run()
  return c.json({ review: reviewDto({ ...review, verdict: input.data.verdict, verdict_note: input.data.note, graded_at: gradedAt }) })
})

// ---- Journal ----------------------------------------------------------------------------------
type JournalRow = ScenarioRow & {
  o_exit_price: number | null
  o_r_multiple: number | null
  o_exit_reason: PaperOutcome['exitReason'] | null
  o_followed_plan: number | null
  o_note: string | null
  o_recorded_at: string | null
  bull: number
  bear: number
  graded: number
  providers: string | null
}
app.get('/api/journal', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*,
        o.exit_price AS o_exit_price, o.r_multiple AS o_r_multiple, o.exit_reason AS o_exit_reason,
        o.followed_plan AS o_followed_plan, o.note AS o_note, o.recorded_at AS o_recorded_at,
        (SELECT COUNT(*) FROM reviews r WHERE r.scenario_id = s.id AND r.role = 'BULL') AS bull,
        (SELECT COUNT(*) FROM reviews r WHERE r.scenario_id = s.id AND r.role = 'BEAR') AS bear,
        (SELECT COUNT(*) FROM reviews r WHERE r.scenario_id = s.id AND r.verdict IS NOT NULL) AS graded,
        (SELECT GROUP_CONCAT(DISTINCT r.provider) FROM reviews r WHERE r.scenario_id = s.id) AS providers
      FROM scenarios s
      LEFT JOIN paper_outcomes o ON o.scenario_id = s.id
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 200`,
  ).all<JournalRow>()
  const entries: JournalEntry[] = results.map((r) => ({
    scenario: scenarioDto(r),
    reviewCounts: {
      total: r.bull + r.bear,
      bull: r.bull,
      bear: r.bear,
      graded: r.graded,
      providers: (r.providers ? r.providers.split(',') : []).sort() as Provider[],
    },
    outcome: r.o_recorded_at === null ? null : outcomeDto({
      scenario_id: r.id,
      exit_price: r.o_exit_price as number,
      r_multiple: r.o_r_multiple as number,
      exit_reason: r.o_exit_reason as PaperOutcome['exitReason'],
      followed_plan: r.o_followed_plan as number,
      note: r.o_note ?? '',
      recorded_at: r.o_recorded_at,
    }),
  }))
  const scoreRows = await c.env.DB.prepare(
    `SELECT r.scenario_id AS scenarioId, r.provider, r.role, r.verdict, o.r_multiple AS rMultiple
       FROM reviews r LEFT JOIN paper_outcomes o ON o.scenario_id = r.scenario_id`,
  ).all<ReviewScoreRow>()
  const body: JournalResponse = {
    entries,
    summary: summarizeJournal(entries),
    scorecard: summarizeReviewGrades(scoreRows.results),
    kind: 'paper',
  }
  return c.json(body)
})

// ---- Market datasets (imported CSV snapshots) ---------------------------------------------
app.get('/api/market/datasets', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id,symbol,timeframe,source_name,source_note,candle_count,first_date,last_date,imported_at
       FROM market_datasets ORDER BY imported_at DESC, id DESC LIMIT 50`,
  ).all<DatasetRow>()
  return c.json({ datasets: results.map(datasetMeta) })
})

function datasetDto(r: DatasetRow): MarketDataset {
  const candles = JSON.parse(r.candles_json ?? '[]') as Candle[]
  return { ...datasetMeta(r), candles, stats: summarizeCandles(candles) }
}

app.get('/api/market/datasets/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM market_datasets WHERE id = ?').bind(c.req.param('id')).first<DatasetRow>()
  if (!row) return c.json({ error: 'Dataset not found' }, 404)
  return c.json({ dataset: datasetDto(row) })
})

app.post('/api/market/datasets', async (c) => {
  const key = idempotencyKey(c)
  if (key === null) return c.json({ error: 'Invalid Idempotency-Key' }, 400)
  const body = await readJson(c)
  const input = marketDatasetInputSchema.safeParse(body)
  if (!input.success) return badRequest(c, 'Invalid market dataset', body, issuesFrom(input.error).slice(0, 20))

  const replay = async () => {
    if (!key) return null
    const row = await c.env.DB.prepare('SELECT * FROM market_datasets WHERE client_request_id = ?').bind(key).first<DatasetRow>()
    return row ? c.json({ dataset: datasetDto(row), replayed: true }, 200) : null
  }
  const prior = await replay()
  if (prior) return prior

  const d = input.data
  const row: DatasetRow = {
    id: crypto.randomUUID(),
    symbol: d.symbol,
    timeframe: d.timeframe,
    source_name: d.sourceName,
    source_note: d.sourceNote,
    candle_count: d.candles.length,
    first_date: d.candles[0].date,
    last_date: d.candles[d.candles.length - 1].date,
    candles_json: JSON.stringify(d.candles),
    imported_at: new Date().toISOString(),
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO market_datasets
        (id,symbol,timeframe,source_name,source_note,candle_count,first_date,last_date,candles_json,imported_at,client_request_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(row.id, row.symbol, row.timeframe, row.source_name, row.source_note, row.candle_count,
      row.first_date, row.last_date, row.candles_json, row.imported_at, key ?? null).run()
  } catch (e) {
    if (isUniqueViolation(e)) {
      const raced = await replay()
      if (raced) return raced
    }
    throw e
  }
  return c.json({ dataset: datasetDto(row) }, 201)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Local development only. Do not expose publicly before an authentication release gate.
app.onError((error, c) => {
  console.error('TradeCourt API error:', error.name, error.message)
  return c.json({ error: 'Internal error; check local API logs' }, 500)
})

export default app
