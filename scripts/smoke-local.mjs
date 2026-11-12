#!/usr/bin/env node
// Synthetic local API smoke test. No broker, subscription AI or remote Cloudflare calls.
const base = process.env.TRADECOURT_API_URL || 'http://127.0.0.1:8787'
const u = new URL(base)
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol !== 'http:') {
  throw new Error('Smoke test is restricted to loopback HTTP. No remote URL is allowed.')
}
async function call(path, body, expected = 200) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status !== expected) throw new Error(`${path}: expected HTTP ${expected}, received ${res.status}: ${JSON.stringify(data)}`)
  return data
}
const check = (ok, message) => { if (!ok) throw new Error(message) }
const now = new Date().toISOString()
console.log('Running synthetic local TradeCourt API E2E against', base)
const health = await call('/api/health')
check(health.status === 'ok', 'D1 not initialized')
const payload = {
  symbol: 'USDJPY', timeframe: '4h', side: 'LONG',
  entry: 150.2, stop: 149.6, target: 151.4,
  thesis: `Synthetic local test ${now}: a hypothetical trend pullback`,
  invalidation: 'Synthetic price closes below 149.600',
}
const { scenario } = await call('/api/scenarios', payload, 201)
check(scenario.riskReward === 2, 'Incorrect risk/reward')
const listing = await call('/api/scenarios')
check(listing.scenarios.some((s) => s.id === scenario.id), 'Scenario not listed')
await call('/api/scenarios', { ...payload, stop: 151 }, 400)
const { review } = await call(`/api/scenarios/${scenario.id}/reviews`, {
  provider: 'chatgpt', role: 'BEAR',
  content: 'Synthetic manually pasted test response: no verified market data.',
}, 201)
check(review.role === 'BEAR', 'Review role mismatch')
const { outcome } = await call(`/api/scenarios/${scenario.id}/paper-outcome`, {
  exitPrice: 151.4, note: 'Synthetic paper-close only',
}, 201)
check(outcome.rMultiple === 2, 'Incorrect R multiple')
await call(`/api/scenarios/${scenario.id}/paper-outcome`, {
  exitPrice: 149.6, note: 'Must reject duplicate',
}, 409)
const detail = await call(`/api/scenarios/${scenario.id}`)
check(detail.reviews.length === 1 && detail.outcome?.rMultiple === 2, 'Failed to persist reviews/outcome')
await call('/api/scenarios/not-a-real-id', undefined, 404)
console.log('PASS: TradeCourt local API CRUD / validation / paper outcome. Scenario ID:', scenario.id)
console.log('NOTE: synthetic records persist in local D1; no browser UI was tested.')
