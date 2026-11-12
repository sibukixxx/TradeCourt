// Deterministic Entry / Stop / Target DRAFTS from the user's own imported candles.
// The user always chooses the direction (LONG/SHORT): this module never recommends buying or
// selling. It only applies fixed, documented rules to past candles up to the as-of candle
// (no look-ahead) and labels the result as an editable draft.
import type { Candle } from './market'

export type LevelMethod = 'SWING' | 'ATR'

export const SWING_LOOKBACK = 20
export const ATR_PERIOD = 14
export const ATR_STOP_MULTIPLE = 1.5
/** Buffer beyond the swing extreme when ATR is unavailable (2 pips for USD/JPY). */
export const MIN_SWING_BUFFER = 0.02

export type LevelFacts = {
  asOfDate: string
  close: number
  /** Candles used for the swing range (as-of candle included). */
  lookback: number
  swingLow: number
  swingHigh: number
  /** Simple average true range over the last 14 candles; null if fewer than 15 candles. */
  atr: number | null
  /** Simple average of the last 20 closes; null if fewer than 20 candles. */
  sma20: number | null
}

export type LevelDraft = {
  method: LevelMethod
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  rewardR: number
  /** The opposite swing extreme as an alternative target, when it lies on the profit side. */
  swingTarget: { price: number; rewardR: number } | null
  facts: LevelFacts
  thesisDraft: string
  invalidationDraft: string
}

const r3 = (n: number) => Number(n.toFixed(3))
const r2 = (n: number) => Number(n.toFixed(2))

export function computeLevelFacts(candles: Candle[], asOfIndex: number): LevelFacts | null {
  if (asOfIndex < 0 || asOfIndex >= candles.length) return null
  const upto = candles.slice(0, asOfIndex + 1) // never look past the as-of candle
  const window = upto.slice(-SWING_LOOKBACK)
  const last = upto[upto.length - 1]
  let atr: number | null = null
  if (upto.length >= ATR_PERIOD + 1) {
    const recent = upto.slice(-(ATR_PERIOD + 1))
    let sum = 0
    for (let i = 1; i < recent.length; i++) {
      const c = recent[i]
      const prevClose = recent[i - 1].close
      sum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
    }
    atr = r3(sum / ATR_PERIOD)
  }
  const sma20 = upto.length >= 20 ? r3(upto.slice(-20).reduce((a, c) => a + c.close, 0) / 20) : null
  return {
    asOfDate: last.date,
    close: last.close,
    lookback: window.length,
    swingLow: Math.min(...window.map((c) => c.low)),
    swingHigh: Math.max(...window.map((c) => c.high)),
    atr,
    sma20,
  }
}

/** Target at `r` times the stop distance on the profit side. */
export function targetForR(side: 'LONG' | 'SHORT', entry: number, stop: number, r: number): number {
  const risk = Math.abs(entry - stop)
  return r3(side === 'LONG' ? entry + r * risk : entry - r * risk)
}

/**
 * Draft levels for a direction the USER chose. Returns null when the rule cannot produce a valid
 * stop (e.g. SWING when the as-of close is itself the swing extreme, ATR without enough candles).
 */
export function draftLevels(
  candles: Candle[],
  asOfIndex: number,
  side: 'LONG' | 'SHORT',
  method: LevelMethod,
  rewardR = 2,
  timeframe = '',
): LevelDraft | null {
  const f = computeLevelFacts(candles, asOfIndex)
  if (!f) return null
  const long = side === 'LONG'
  const entry = f.close
  let stop: number
  if (method === 'ATR') {
    if (f.atr === null || f.atr <= 0) return null
    stop = r3(long ? entry - ATR_STOP_MULTIPLE * f.atr : entry + ATR_STOP_MULTIPLE * f.atr)
  } else {
    const buffer = f.atr !== null ? Math.max(MIN_SWING_BUFFER, 0.1 * f.atr) : MIN_SWING_BUFFER
    stop = r3(long ? f.swingLow - buffer : f.swingHigh + buffer)
  }
  if (long ? !(stop < entry) : !(stop > entry)) return null
  const risk = Math.abs(entry - stop)
  const target = targetForR(side, entry, stop, rewardR)
  const swingLevel = long ? f.swingHigh : f.swingLow
  const swingTarget = (long ? swingLevel > entry : swingLevel < entry)
    ? { price: swingLevel, rewardR: r2(Math.abs(swingLevel - entry) / risk) }
    : null

  const tf = timeframe ? `${timeframe}足 ` : ''
  const trend = f.sma20 === null ? '' : `終値は直近20本の平均 ${f.sma20} より${f.close >= f.sma20 ? '上' : '下'}。`
  const stopRule = method === 'ATR'
    ? `損切りはATR(${ATR_PERIOD})=${f.atr} の${ATR_STOP_MULTIPLE}倍`
    : `損切りは直近${f.lookback}本の${long ? '安値' : '高値'} ${long ? f.swingLow : f.swingHigh} の少し${long ? '下' : '上'}`
  const thesisDraft = `【自動下書き・要編集】${tf}${f.asOfDate} の終値 ${f.close}（取込CSV）。直近${f.lookback}本の高値 ${f.swingHigh} / 安値 ${f.swingLow}` +
    `${f.atr !== null ? `、ATR(${ATR_PERIOD}) ${f.atr}` : ''}。${trend}${side}を選択。${stopRule}、利確は${rewardR}R。` +
    `ここに自分の根拠（なぜこの方向か）を書き足してください。`
  const invalidationDraft = long ? `${stop} を下回ったら仮説は無効` : `${stop} を上回ったら仮説は無効`
  return { method, side, entry, stop, target, rewardR, swingTarget, facts: f, thesisDraft, invalidationDraft }
}
