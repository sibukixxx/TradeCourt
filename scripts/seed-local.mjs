#!/usr/bin/env node
// Load SYNTHETIC seed data into the LOCAL app through its API (same validation as the UI).
//
//   make seed                 # anchor = DEFAULT_ANCHOR (159.7, ECB 2026-11-12), offline
//   make seed ANCHOR=live     # anchor = latest reference quote via the running local API
//   make seed ANCHOR=150.25   # explicit anchor
//   make seed FORCE=1         # add seed data even if the database already has scenarios
//
// Refuses non-loopback targets. Never touches existing records: it only adds new ones.
import { DEFAULT_ANCHOR, RECENT_RANGE, SEED_VERSION, buildSeedPlan, exitFor, generateDailyCandles, reviewText, verdictFor } from './seed-data.mjs'

export async function runSeed({ base = 'http://127.0.0.1:8787', fetchImpl = fetch, anchor: anchorOpt, force = false, today = new Date(), log = console.log } = {}) {
  const url = new URL(base)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') {
    throw new Error('Seeding is restricted to the local loopback API.')
  }
  const call = async (path, { method, body, key, expect = [200, 201] } = {}) => {
    const res = await fetchImpl(base + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!expect.includes(res.status)) throw new Error(`${method ?? (body === undefined ? 'GET' : 'POST')} ${path} → HTTP ${res.status}: ${JSON.stringify(data)}`)
    return { status: res.status, data }
  }

  const health = (await call('/api/health', { expect: [200, 503] })).data
  if (health.status !== 'ok') throw new Error(`API not ready: ${health.error ?? health.status}. Run make migrate.`)
  const existing = (await call('/api/scenarios')).data.scenarios.length
  if (existing > 0 && !force) {
    log(`• The local database already has ${existing} scenario(s); nothing was added. Use FORCE=1 to add seed data anyway, or make reseed CONFIRM=yes for a fresh database.`)
    return { skipped: true, existing }
  }

  // Anchor: last close of the synthetic series.
  let anchor = { ...DEFAULT_ANCHOR }
  if (anchorOpt === 'live') {
    const q = (await call('/api/quote/usdjpy')).data.quote
    anchor = { price: q.price, date: q.asOf, source: q.source }
  } else if (anchorOpt !== undefined && anchorOpt !== '') {
    const price = Number(anchorOpt)
    if (!Number.isFinite(price) || price < 50 || price > 500) throw new Error(`ANCHOR must be "live" or a USD/JPY price, got ${anchorOpt}`)
    anchor = { price, date: 'manual', source: 'ANCHOR set by the user' }
  }

  const candles = generateDailyCandles({ anchor: anchor.price, today })
  const lastDate = candles[candles.length - 1].date
  const k = (name) => `seed-${SEED_VERSION}-${lastDate}-${anchor.price}-${name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
  const { data: { dataset } } = await call('/api/market/datasets', {
    key: k('dataset'),
    body: {
      symbol: 'USDJPY', timeframe: '1d', tzOffset: '+00:00',
      sourceName: `SYNTHETIC-seed-usdjpy-1d-${lastDate}.csv`,
      sourceNote: `SYNTHETIC random walk for local development (seed ${SEED_VERSION}); last close anchored to ${anchor.price} (${anchor.source}, ${anchor.date}); scaled to the recent ECB range ${RECENT_RANGE.low}–${RECENT_RANGE.high} (${RECENT_RANGE.from}..${RECENT_RANGE.to}) relative to the anchor. Not real market data.`,
      candles,
    },
  })

  const plan = buildSeedPlan(candles)
  const summary = { dataset: dataset.id, scenarios: 0, reviews: 0, outcomes: 0, grades: 0, paths: {} }
  for (const s of plan) {
    const { data: { scenario } } = await call('/api/scenarios', {
      key: k(s.key),
      body: {
        symbol: 'USDJPY', timeframe: s.timeframe, side: s.side, entry: s.entry, stop: s.stop, target: s.target,
        thesis: s.thesis, invalidation: s.invalidation,
        ...(s.asOfDate ? { marketRef: { datasetId: dataset.id, asOfDate: s.asOfDate } } : {}),
      },
    })
    summary.scenarios++
    const reviews = []
    for (const [provider, role] of s.reviews) {
      const { data } = await call(`/api/scenarios/${scenario.id}/reviews`, {
        key: k(`${s.key}-${provider}-${role}`), body: { provider, role, content: reviewText(role, provider, s) },
      })
      reviews.push(data.review)
      summary.reviews++
    }
    const path = s.asOfDate ? (await call(`/api/scenarios/${scenario.id}/path-check?datasetId=${dataset.id}`)).data.evaluation : null
    if (path) summary.paths[path.outcome] = (summary.paths[path.outcome] ?? 0) + 1
    const exit = exitFor(s, s.outcome, path)
    if (!exit) continue
    const res = await call(`/api/scenarios/${scenario.id}/paper-outcome`, {
      body: { ...exit, note: '[SYNTHETIC SEED] Demo paper outcome for local development. / 開発用の架空の仮想結果。' },
      expect: [201, 409], // 409: already recorded by an earlier identical seed run
    })
    if (res.status === 201) summary.outcomes++
    const rMultiple = res.status === 201 ? res.data.outcome.rMultiple : 0
    if (!s.grade) continue
    for (const review of reviews) {
      if (review.grade) continue
      await call(`/api/scenarios/${scenario.id}/reviews/${review.id}/grade`, {
        method: 'PUT', body: { verdict: verdictFor(review.role, path, rMultiple), note: '[SYNTHETIC SEED]' },
      })
      summary.grades++
    }
  }
  log(`✓ Seeded SYNTHETIC data: ${candles.length} daily candles (${candles[0].date} → ${lastDate}, last close ${anchor.price} = ${anchor.source} ${anchor.date}),`)
  log(`  ${summary.scenarios} scenarios, ${summary.reviews} placeholder reviews, ${summary.outcomes} paper outcomes, ${summary.grades} grades. Path checks: ${JSON.stringify(summary.paths)}`)
  return summary
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed({
    base: process.env.TRADECOURT_API_URL || 'http://127.0.0.1:8787',
    anchor: process.env.ANCHOR,
    force: ['1', 'true', 'yes'].includes(String(process.env.FORCE ?? '').toLowerCase()),
  }).catch((e) => { console.error(`✗ ${e.message}`); process.exit(1) })
}
