// Deterministic SYNTHETIC seed data for local development. Pure functions, no I/O.
//
// The candles are NOT real market data: they are a seeded random walk whose last close is
// anchored to a recent real reference level so prices look plausible. Every name and text
// says SYNTHETIC. AI review texts are placeholders, never AI assessments.

/** Default anchor: ECB USD/JPY reference rate (api.frankfurter.dev, published 2026-11-12). */
export const DEFAULT_ANCHOR = { price: 159.7, date: '2026-11-12', source: 'ECB reference rate via frankfurter.dev' }
/**
 * Recent real range used only to scale the synthetic walk: ECB USD/JPY reference rates
 * 2026-08-14 .. 2026-11-12 (65 publications) ranged 153.27 .. 160.16. Expressed as ratios to the
 * anchor so a live or custom anchor keeps the same relative shape.
 */
export const RECENT_RANGE = { low: 153.27, high: 160.16, from: '2026-08-14', to: '2026-11-12' }
const BAND = { low: (RECENT_RANGE.low / DEFAULT_ANCHOR.price) * 0.99, high: (RECENT_RANGE.high / DEFAULT_ANCHOR.price) * 1.01 }
export const SEED_VERSION = 'v1'
const DAILY_VOL = 0.0045 // ~7% annualised, typical for USD/JPY
const r3 = (n) => Number(n.toFixed(3))

/** Small, fast, seedable PRNG (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** The last `n` Monday–Friday dates strictly before `today` (UTC), oldest first. */
export function businessDaysBefore(today, n) {
  const days = []
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  while (days.length < n) {
    d.setUTCDate(d.getUTCDate() - 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10))
  }
  return days.reverse()
}

/**
 * Daily SYNTHETIC OHLC candles whose final close equals `anchor`. Built backwards from the
 * anchor with seeded log-returns, so the same inputs always give the same candles.
 */
export function generateDailyCandles({ anchor, today, count = 120, seed = 20261113 }) {
  const rand = prng(seed)
  const dates = businessDaysBefore(today, count)
  const closes = new Array(count)
  closes[count - 1] = anchor
  for (let i = count - 1; i > 0; i--) closes[i - 1] = closes[i] / Math.exp(gaussian(rand) * DAILY_VOL)
  // Keep the walk's shape but shrink its deviations from the anchor so closes stay inside the
  // recent real range (relative to the anchor). Only shrinks, never stretches.
  const devs = closes.map((c) => Math.log(c / anchor))
  const up = Math.max(...devs), down = Math.min(...devs)
  const k = Math.min(1, up > 0 ? Math.log(BAND.high) / up : 1, down < 0 ? Math.log(BAND.low) / down : 1)
  for (let i = 0; i < count; i++) closes[i] = anchor * Math.exp(devs[i] * k)
  return dates.map((date, i) => {
    const close = r3(closes[i])
    const prevClose = i === 0 ? closes[0] / Math.exp(gaussian(rand) * DAILY_VOL) : closes[i - 1]
    const open = r3(prevClose * Math.exp(gaussian(rand) * DAILY_VOL * 0.15))
    const high = r3(Math.max(open, close) * Math.exp(Math.abs(gaussian(rand)) * DAILY_VOL * 0.6))
    const low = r3(Math.min(open, close) / Math.exp(Math.abs(gaussian(rand)) * DAILY_VOL * 0.6))
    return { date, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close }
  })
}

const SEED_TAG = '[SYNTHETIC SEED / 合成シード]'
const AI_TAG = '[SYNTHETIC DEMO TEXT – not an AI answer / AIの回答ではない架空のデモ文]'

/** Stop distance bounds (yen): keeps seeded R multiples in a realistic range. */
export const MIN_RISK = 0.5
export const MAX_RISK = 2.5

/**
 * Stop just beyond the 20-candle swing up to the as-of candle, with the distance clamped to
 * [MIN_RISK, MAX_RISK]; target = rewardR × risk.
 */
function levelsAt(candles, asOfIndex, side, rewardR) {
  const window = candles.slice(Math.max(0, asOfIndex - 19), asOfIndex + 1)
  const entry = candles[asOfIndex].close
  const swingStop = side === 'LONG' ? Math.min(...window.map((c) => c.low)) - 0.05 : Math.max(...window.map((c) => c.high)) + 0.05
  const swingRisk = side === 'LONG' ? entry - swingStop : swingStop - entry
  const risk = r3(Math.min(MAX_RISK, Math.max(MIN_RISK, Number.isFinite(swingRisk) ? swingRisk : MIN_RISK)))
  const stop = r3(side === 'LONG' ? entry - risk : entry + risk)
  const target = r3(side === 'LONG' ? entry + rewardR * risk : entry - rewardR * risk)
  return { entry, stop, target }
}

/**
 * Scenario plan. `outcome` rules are resolved by the loader after it asks the API for the
 * path check: FOLLOW_PATH, EARLY (0.4R, rule broken), BEYOND_STOP (-1.3R, rule broken),
 * FIXED_R (manual), or null (left open so the one-tap record can be tried).
 */
export function buildSeedPlan(candles) {
  const last = candles.length - 1
  const linked = [
    { back: 40, side: 'LONG', rewardR: 2, outcome: 'FOLLOW_PATH', reviews: [['chatgpt', 'BULL'], ['claude', 'BEAR']], grade: true },
    { back: 32, side: 'SHORT', rewardR: 1.5, outcome: 'EARLY', reviews: [['claude', 'BULL'], ['gemini', 'BEAR']], grade: true },
    { back: 24, side: 'LONG', rewardR: 3, outcome: 'FOLLOW_PATH', reviews: [['grok', 'BEAR']], grade: true },
    { back: 16, side: 'SHORT', rewardR: 2, outcome: 'BEYOND_STOP', reviews: [['chatgpt', 'BULL'], ['claude', 'BEAR']], grade: false },
    { back: 9, side: 'LONG', rewardR: 2, outcome: null, reviews: [['gemini', 'BULL'], ['grok', 'BEAR']], grade: false },
    { back: 3, side: 'SHORT', rewardR: 2, outcome: null, reviews: [], grade: false },
  ].map((p, i) => {
    const asOfIndex = last - p.back
    const c = candles[asOfIndex]
    const lv = levelsAt(candles, asOfIndex, p.side, p.rewardR)
    return {
      key: `linked-${i}`, side: p.side, timeframe: '1d', ...lv, asOfDate: c.date,
      thesis: `${SEED_TAG} ${p.side} hypothesis at the ${c.date} close of the synthetic series (anchored near a recent reference level). Demo data for local development, not a market view. / 開発用の合成データで、相場観ではありません。`,
      invalidation: `${SEED_TAG} Daily close ${p.side === 'LONG' ? 'below' : 'above'} ${lv.stop}`,
      outcome: p.outcome, reviews: p.reviews, grade: p.grade,
    }
  })
  const lastClose = candles[last].close
  const unlinked = [
    { key: 'unlinked-0', side: 'LONG', timeframe: '4h', entry: r3(lastClose - 0.4), stop: r3(lastClose - 0.9), target: r3(lastClose + 0.6), outcome: 'FIXED_R', fixedR: 1.2 },
    { key: 'unlinked-1', side: 'SHORT', timeframe: '1h', entry: r3(lastClose + 0.2), stop: r3(lastClose + 0.5), target: r3(lastClose - 0.4), outcome: null },
  ].map((u) => ({
    ...u, asOfDate: null, reviews: [], grade: false,
    thesis: `${SEED_TAG} Unlinked ${u.side} ${u.timeframe} hypothesis for trying the forms without market data. Not a market view. / 相場データに紐付けていない合成シナリオ。`,
    invalidation: `${SEED_TAG} Price ${u.side === 'LONG' ? 'below' : 'above'} ${u.stop}`,
  }))
  return [...linked, ...unlinked]
}

export function reviewText(role, provider, scenario) {
  const view = role === 'BULL'
    ? 'Placeholder for a BULL argument (paste a real answer from your AI here).'
    : 'Placeholder for a BEAR argument (paste a real answer from your AI here).'
  return `${AI_TAG} ${provider} / ${role}: ${view} Scenario ${scenario.side} ${scenario.entry} → ${scenario.target}, stop ${scenario.stop}.`
}

/** Paper exit for a plan rule, given the API's path check (or null when unlinked/undecided). */
export function exitFor(scenario, rule, path) {
  const dir = scenario.side === 'LONG' ? 1 : -1
  const risk = Math.abs(scenario.entry - scenario.stop)
  switch (rule) {
    case 'FOLLOW_PATH': {
      if (path?.outcome === 'TARGET_FIRST') return { exitPrice: scenario.target, exitReason: 'TARGET', followedPlan: true }
      // Ambiguous candle: assume the conservative order (stop first).
      if (path?.outcome === 'STOP_FIRST' || path?.outcome === 'AMBIGUOUS') return { exitPrice: scenario.stop, exitReason: 'STOP', followedPlan: true }
      // Undecided: close at the path's mark-to-market R, bounded by the plan (-1R .. target R).
      const rewardR = Math.abs(scenario.target - scenario.entry) / risk
      const r = Math.min(rewardR, Math.max(-1, path?.referenceR ?? 0))
      return { exitPrice: r3(scenario.entry + dir * r * risk), exitReason: 'MANUAL', followedPlan: true }
    }
    case 'EARLY': return { exitPrice: r3(scenario.entry + dir * 0.4 * risk), exitReason: 'MANUAL', followedPlan: false }
    case 'BEYOND_STOP': return { exitPrice: r3(scenario.entry - dir * 1.3 * risk), exitReason: 'MANUAL', followedPlan: false }
    case 'FIXED_R': return { exitPrice: r3(scenario.entry + dir * scenario.fixedR * risk), exitReason: 'MANUAL', followedPlan: true }
    default: return null
  }
}

/** Grade suggestion: CSV path when decided, else the paper result. */
export function verdictFor(role, path, rMultiple) {
  if (path?.outcome === 'TARGET_FIRST') return role === 'BULL' ? 'HIT' : 'MISS'
  if (path?.outcome === 'STOP_FIRST') return role === 'BEAR' ? 'HIT' : 'MISS'
  if (rMultiple === 0) return 'UNCLEAR'
  return (role === 'BULL') === rMultiple > 0 ? 'HIT' : 'MISS'
}
