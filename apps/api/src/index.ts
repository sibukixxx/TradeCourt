import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { REQUIRED_MIGRATION } from './schema'
import {
  calculatePaperRMultiple,
  calculateRiskReward,
  candleCloseTime,
  candleTime,
  analyzeDecisions,
  evaluatePath,
  toCsv,
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
  type AnalysisEntry,
  type PathEvaluation,
  type MarketDataset,
  type MarketDatasetMeta,
  type MarketRef,
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
  dataset_id: string | null
  as_of_candle: string | null
  as_of_at: string | null
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
  tz_offset: string | null
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
  marketRef: r.dataset_id && r.as_of_candle && r.as_of_at
    ? { datasetId: r.dataset_id, asOfDate: r.as_of_candle, asOfAt: r.as_of_at }
    : null,
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
  tzOffset: r.tz_offset,
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

// Applied to every route (including `/`), not only /api.
app.use('*', async (c, next) => {
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

// ---- Root: this port is the API only; the UI is served by Vite on :5173 --------------------
app.get('/', (c) => c.json({
  service: 'TradeCourt local API (no UI on this port)',
  web: 'http://127.0.0.1:5173',
  health: '/api/health',
  note: 'Open the web app on port 5173. This API is localhost-only and has no authentication.',
}))

// ---- Health ---------------------------------------------------------------------------------

app.get('/api/health', async (c) => {
  const applied = await c.env.DB.prepare('SELECT name FROM d1_migrations WHERE name = ?')
    .bind(REQUIRED_MIGRATION).first<{ name: string }>()
    .catch(() => null) // d1_migrations does not exist before the first migration run
  if (!applied) {
    const message = `Local database migrations are pending (need ${REQUIRED_MIGRATION}). Stop the app and run: make migrate (or corepack pnpm db:migrate:local)`
    return c.json({ status: 'setup_required', error: message, message, requiredMigration: REQUIRED_MIGRATION }, 503)
  }
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

  const { marketRef: refInput, ...s } = input.data
  let marketRef: MarketRef | null = null
  if (refInput) {
    // The as-of candle must exist in the referenced dataset; its close instant is fixed now.
    const ds = await c.env.DB.prepare('SELECT * FROM market_datasets WHERE id = ?').bind(refInput.datasetId).first<DatasetRow>()
    if (!ds) return c.json({ error: 'Invalid scenario', issues: [{ path: 'marketRef.datasetId', message: 'Market dataset not found' }] }, 400)
    const candles = JSON.parse(ds.candles_json ?? '[]') as Candle[]
    if (!candles.some((k) => k.date === refInput.asOfDate)) {
      return c.json({ error: 'Invalid scenario', issues: [{ path: 'marketRef.asOfDate', message: 'asOfDate is not a candle in that dataset' }] }, 400)
    }
    marketRef = {
      datasetId: ds.id,
      asOfDate: refInput.asOfDate,
      asOfAt: new Date(candleCloseTime(refInput.asOfDate, ds.timeframe, ds.tz_offset)).toISOString(),
    }
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  try {
    await c.env.DB.prepare(
      `INSERT INTO scenarios
        (id,symbol,timeframe,side,entry,stop,target,thesis,invalidation,created_at,client_request_id,dataset_id,as_of_candle,as_of_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, s.symbol, s.timeframe, s.side, s.entry, s.stop, s.target, s.thesis, s.invalidation, createdAt, key ?? null,
      marketRef?.datasetId ?? null, marketRef?.asOfDate ?? null, marketRef?.asOfAt ?? null).run()
  } catch (e) {
    if (isUniqueViolation(e)) {
      const raced = await replay()
      if (raced) return raced
    }
    throw e
  }
  return c.json({ scenario: { ...s, id, createdAt, riskReward: calculateRiskReward(s), marketRef } satisfies Scenario }, 201)
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

// ---- Path check: which level did the user's own CSV touch first after the as-of candle --------
// Computed on demand (never stored). Reference only: user-imported, unverified candles; no spread/fees.
app.get('/api/scenarios/:id/path-check', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM scenarios WHERE id = ?').bind(c.req.param('id')).first<ScenarioRow>()
  if (!row) return c.json({ error: 'Scenario not found' }, 404)
  const scenario = scenarioDto(row)
  if (!scenario.marketRef) return c.json({ error: 'Scenario is not linked to imported market data' }, 409)
  const asOfAtMs = Date.parse(scenario.marketRef.asOfAt)

  const { results: metas } = await c.env.DB.prepare(
    `SELECT id,symbol,timeframe,source_name,source_note,candle_count,first_date,last_date,imported_at,tz_offset
       FROM market_datasets WHERE symbol = ? ORDER BY imported_at DESC, id DESC LIMIT 50`,
  ).bind(scenario.symbol).all<DatasetRow>()
  // Candidates: datasets containing at least one candle that opens at/after the as-of close.
  const candidates = metas.filter((m) => candleTime(m.last_date, m.tz_offset ?? '+00:00') >= asOfAtMs)
  const requested = c.req.query('datasetId')
  const chosenId = requested ?? candidates[0]?.id ?? scenario.marketRef.datasetId
  const ds = await c.env.DB.prepare('SELECT * FROM market_datasets WHERE id = ?').bind(chosenId).first<DatasetRow>()
  if (!ds) return c.json({ error: 'Dataset not found' }, 404)
  if (ds.symbol !== scenario.symbol) return c.json({ error: 'Dataset symbol does not match the scenario' }, 400)

  const candles = JSON.parse(ds.candles_json ?? '[]') as Candle[]
  const evaluation = evaluatePath(scenario, candles, ds.tz_offset, asOfAtMs)
  // Chart window: up to 40 candles before the as-of close through 10 after the deciding candle.
  const firstAfter = candles.findIndex((k) => candleTime(k.date, ds.tz_offset ?? '+00:00') >= asOfAtMs)
  const decidedIndex = evaluation.decidedDate ? candles.findIndex((k) => k.date === evaluation.decidedDate) : -1
  const pivot = firstAfter === -1 ? candles.length : firstAfter
  const start = Math.max(0, pivot - 40)
  const end = Math.min(candles.length, (decidedIndex === -1 ? pivot : decidedIndex + 1) + 10, start + 400)
  return c.json({
    evaluation,
    dataset: datasetMeta(ds),
    candidates: candidates.map(datasetMeta),
    chart: {
      candles: candles.slice(start, end),
      firstAfterIndex: firstAfter === -1 ? null : firstAfter - start,
      decidedIndex: decidedIndex === -1 ? null : decidedIndex - start,
    },
    kind: 'reference',
  })
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

// ---- Shared loaders for analysis / export --------------------------------------------------
type FullState = {
  scenarios: Scenario[]
  reviews: Review[]
  outcomes: Map<string, PaperOutcome>
  datasets: DatasetRow[]
  /** Default reference path check per linked scenario (newest dataset with later candles). */
  paths: Map<string, { datasetId: string; evaluation: PathEvaluation }>
}

async function loadFullState(db: D1Database): Promise<FullState> {
  const [scenarios, reviews, outcomes, datasets] = await Promise.all([
    db.prepare('SELECT * FROM scenarios ORDER BY created_at ASC, id ASC').all<ScenarioRow>(),
    db.prepare('SELECT * FROM reviews ORDER BY created_at ASC, id ASC').all<ReviewRow>(),
    db.prepare('SELECT * FROM paper_outcomes').all<OutcomeRow>(),
    db.prepare(
      `SELECT id,symbol,timeframe,source_name,source_note,candle_count,first_date,last_date,imported_at,tz_offset
         FROM market_datasets ORDER BY imported_at DESC, id DESC`,
    ).all<DatasetRow>(),
  ])
  const state: FullState = {
    scenarios: scenarios.results.map(scenarioDto),
    reviews: reviews.results.map(reviewDto),
    outcomes: new Map(outcomes.results.map((o) => [o.scenario_id, outcomeDto(o)])),
    datasets: datasets.results,
    paths: new Map(),
  }
  const candleCache = new Map<string, { row: DatasetRow; candles: Candle[] }>()
  const loadCandles = async (id: string) => {
    if (!candleCache.has(id)) {
      const row = await db.prepare('SELECT * FROM market_datasets WHERE id = ?').bind(id).first<DatasetRow>()
      if (!row) return null
      candleCache.set(id, { row, candles: JSON.parse(row.candles_json ?? '[]') as Candle[] })
    }
    return candleCache.get(id) ?? null
  }
  for (const s of state.scenarios) {
    if (!s.marketRef) continue
    const asOf = Date.parse(s.marketRef.asOfAt)
    const chosen = state.datasets.find((d) => d.symbol === s.symbol && candleTime(d.last_date, d.tz_offset ?? '+00:00') >= asOf)?.id
      ?? s.marketRef.datasetId
    const ds = await loadCandles(chosen)
    if (ds) state.paths.set(s.id, { datasetId: ds.row.id, evaluation: evaluatePath(s, ds.candles, ds.row.tz_offset, asOf) })
  }
  return state
}

// ---- Decision analysis (paper records only) -------------------------------------------------
app.get('/api/analysis', async (c) => {
  const raw = c.req.query('limit')
  let limit: number | null = null
  if (raw !== undefined && raw !== 'all') {
    limit = Number(raw)
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return c.json({ error: 'limit must be an integer 1-1000 or "all"' }, 400)
  }
  const state = await loadFullState(c.env.DB)
  const entries: AnalysisEntry[] = state.scenarios.map((s) => {
    const o = state.outcomes.get(s.id)
    const p = state.paths.get(s.id)
    return {
      scenario: { id: s.id, createdAt: s.createdAt, side: s.side, riskReward: s.riskReward },
      outcome: o ? { rMultiple: o.rMultiple, exitReason: o.exitReason, followedPlan: o.followedPlan, recordedAt: o.recordedAt } : null,
      path: p ? { outcome: p.evaluation.outcome, referenceR: p.evaluation.referenceR } : null,
    }
  })
  return c.json({ analysis: analyzeDecisions(entries, limit), kind: 'paper' })
})

// ---- Export (user's own local data; paper records, not broker fills) --------------------------
const EXPORT_NOTICE = 'TradeCourt local export. Outcomes are user-entered PAPER records (not broker fills); AI reviews are manually pasted opinions; path checks are references computed from user-imported, unverified CSV.'

app.get('/api/export', async (c) => {
  const format = c.req.query('format') ?? 'json'
  if (format !== 'json' && format !== 'csv') return c.json({ error: 'format must be json or csv' }, 400)
  const state = await loadFullState(c.env.DB)
  const stamp = new Date().toISOString()
  const fileStamp = stamp.slice(0, 19).replace(/[:T]/g, '-')
  c.header('Cache-Control', 'no-store')

  if (format === 'json') {
    const body = {
      exportedAt: stamp,
      kind: 'paper',
      notice: EXPORT_NOTICE,
      datasets: state.datasets.map(datasetMeta),
      scenarios: state.scenarios.map((s) => ({
        scenario: s,
        reviews: state.reviews.filter((r) => r.scenarioId === s.id),
        outcome: state.outcomes.get(s.id) ?? null,
        pathReference: state.paths.get(s.id) ?? null,
      })),
    }
    c.header('Content-Disposition', `attachment; filename="tradecourt-export-${fileStamp}.json"`)
    return c.body(JSON.stringify(body, null, 2), 200, { 'Content-Type': 'application/json; charset=utf-8' })
  }

  const header = [
    'scenario_id', 'created_at', 'symbol', 'timeframe', 'side', 'entry', 'stop', 'target', 'planned_rr',
    'thesis', 'invalidation', 'as_of_candle', 'as_of_at',
    'reviews_total', 'reviews_bull', 'reviews_bear', 'graded_hit', 'graded_miss', 'graded_unclear',
    'paper_exit_price', 'paper_r', 'exit_reason', 'followed_plan', 'reflection', 'recorded_at',
    'path_outcome', 'path_reference_r', 'path_decided_candle', 'data_kind',
  ]
  const rows = state.scenarios.map((s) => {
    const rv = state.reviews.filter((r) => r.scenarioId === s.id)
    const o = state.outcomes.get(s.id)
    const p = state.paths.get(s.id)?.evaluation
    const count = (pred: (r: Review) => boolean) => rv.filter(pred).length
    return [
      s.id, s.createdAt, s.symbol, s.timeframe, s.side, s.entry, s.stop, s.target, s.riskReward,
      s.thesis, s.invalidation, s.marketRef?.asOfDate, s.marketRef?.asOfAt,
      rv.length, count((r) => r.role === 'BULL'), count((r) => r.role === 'BEAR'),
      count((r) => r.grade?.verdict === 'HIT'), count((r) => r.grade?.verdict === 'MISS'), count((r) => r.grade?.verdict === 'UNCLEAR'),
      o?.exitPrice, o?.rMultiple, o?.exitReason, o ? o.followedPlan : null, o?.note, o?.recordedAt,
      p?.outcome, p?.referenceR, p?.outcome === 'OPEN' ? null : p?.decidedDate,
      'paper (user-entered, not broker fills)',
    ]
  })
  c.header('Content-Disposition', `attachment; filename="tradecourt-export-${fileStamp}.csv"`)
  // UTF-8 BOM so spreadsheet apps (e.g. Excel) read Japanese text correctly.
  return c.body('\uFEFF' + toCsv([header, ...rows]), 200, { 'Content-Type': 'text/csv; charset=utf-8' })
})

// ---- Market datasets (imported CSV snapshots) ---------------------------------------------
app.get('/api/market/datasets', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id,symbol,timeframe,source_name,source_note,candle_count,first_date,last_date,imported_at,tz_offset
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
    tz_offset: d.tzOffset ?? null,
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO market_datasets
        (id,symbol,timeframe,source_name,source_note,candle_count,first_date,last_date,candles_json,imported_at,client_request_id,tz_offset)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(row.id, row.symbol, row.timeframe, row.source_name, row.source_note, row.candle_count,
      row.first_date, row.last_date, row.candles_json, row.imported_at, key ?? null, row.tz_offset).run()
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
