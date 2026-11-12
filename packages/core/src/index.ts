import { z } from 'zod'

export * from './market'
export * from './grading'
export * from './path'
export * from './analysis'
export * from './levels'

import type { ReviewGrade, ReviewScorecard } from './grading'
import { marketRefInputSchema, type MarketRef } from './path'

const positivePrice = z.number().finite().positive()

export const scenarioInputSchema = z.object({
  symbol: z.literal('USDJPY'),
  timeframe: z.enum(['1h', '4h', '1d']),
  side: z.enum(['LONG', 'SHORT']),
  entry: positivePrice,
  stop: positivePrice,
  target: positivePrice,
  thesis: z.string().trim().min(12).max(2000),
  invalidation: z.string().trim().min(5).max(1000),
  /** Optional link to an imported CSV candle the hypothesis was formed at (immutable). */
  marketRef: marketRefInputSchema.optional(),
}).strict().superRefine((scenario, ctx) => {
  const correctDirection = scenario.side === 'LONG'
    ? scenario.stop < scenario.entry && scenario.target > scenario.entry
    : scenario.target < scenario.entry && scenario.stop > scenario.entry
  if (!correctDirection) {
    ctx.addIssue({
      code: 'custom',
      message: 'LONG requires stop < entry < target; SHORT requires target < entry < stop',
      path: ['stop'],
    })
  }
})

export const providerSchema = z.enum(['chatgpt', 'claude', 'gemini', 'grok', 'other'])
export const roleSchema = z.enum(['BULL', 'BEAR'])

export const reviewInputSchema = z.object({
  provider: providerSchema,
  role: roleSchema,
  content: z.string().trim().min(10).max(20000),
  /** When the user received the answer on the external AI site (user-declared). Defaults to save time. */
  respondedAt: z.iso.datetime({ offset: true }).optional(),
}).strict()

export const exitReasonSchema = z.enum(['TARGET', 'STOP', 'INVALIDATED', 'MANUAL'])

export const paperOutcomeInputSchema = z.object({
  exitPrice: positivePrice,
  exitReason: exitReasonSchema.default('MANUAL'),
  followedPlan: z.boolean().default(true),
  note: z.string().trim().max(2000).default(''),
}).strict()

export type ScenarioInput = z.infer<typeof scenarioInputSchema>
export type ReviewInput = z.infer<typeof reviewInputSchema>
export type PaperOutcomeInput = z.input<typeof paperOutcomeInputSchema>

/** Scenario fields without the market link (what prompts and R math need). */
export type ScenarioCore = Omit<ScenarioInput, 'marketRef'>

export type Scenario = ScenarioCore & {
  marketRef: MarketRef | null
  id: string
  createdAt: string
  riskReward: number
}

export type Provider = z.infer<typeof providerSchema>
export type Role = z.infer<typeof roleSchema>
export type ExitReason = z.infer<typeof exitReasonSchema>

export type Review = {
  id: string
  scenarioId: string
  provider: Provider
  role: Role
  content: string
  /** User-declared time the external AI answered; falls back to createdAt. */
  respondedAt: string
  /** Time TradeCourt stored the manual paste. */
  createdAt: string
  /** Reviews only ever enter TradeCourt by manual paste; never fetched from an AI service. */
  source: 'manual_paste'
  /** Post-hoc user grade against the paper outcome; null until graded. */
  grade: ReviewGrade | null
}

export type PaperOutcome = {
  scenarioId: string
  exitPrice: number
  rMultiple: number
  exitReason: ExitReason
  followedPlan: boolean
  note: string
  recordedAt: string
  /** Always 'paper': user-entered hypothetical close, never a broker fill. */
  kind: 'paper'
}

export type JournalEntry = {
  scenario: Scenario
  reviewCounts: { total: number; bull: number; bear: number; graded: number; providers: Provider[] }
  outcome: PaperOutcome | null
}

export type JournalResponse = {
  entries: JournalEntry[]
  summary: JournalSummary
  scorecard: ReviewScorecard
  kind: 'paper'
}

export type ScenarioDetail = {
  scenario: Scenario
  reviews: Review[]
  outcome: PaperOutcome | null
}

export const providerLabels: Record<Provider, string> = {
  chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', other: 'Other',
}

export const aiProviders = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  claude: { label: 'Claude', url: 'https://claude.ai/new' },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com/app' },
  grok: { label: 'Grok', url: 'https://grok.com/' },
} as const

export function calculateRiskReward(s: Pick<ScenarioInput, 'entry' | 'stop' | 'target'>): number {
  const risk = Math.abs(s.entry - s.stop)
  if (!Number.isFinite(risk) || risk <= 0) throw new Error('Invalid stop distance')
  return Number((Math.abs(s.target - s.entry) / risk).toFixed(3))
}

export function calculatePaperRMultiple(
  s: Pick<ScenarioInput, 'entry' | 'stop' | 'side'>,
  exitPrice: number,
): number {
  const risk = Math.abs(s.entry - s.stop)
  if (risk <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    throw new Error('Invalid paper outcome')
  }
  const move = s.side === 'LONG' ? exitPrice - s.entry : s.entry - exitPrice
  return Number((move / risk).toFixed(3))
}

export type PlanComparison = {
  plannedRewardR: number
  realizedR: number
  /** realizedR / plannedRewardR, e.g. 0.5 = half of the planned reward captured. */
  captureRatio: number
  zone: 'BEYOND_TARGET' | 'AT_TARGET' | 'BETWEEN' | 'AT_STOP' | 'BEYOND_STOP'
  lossExceededPlan: boolean
}

export function comparePlanToOutcome(
  s: Pick<ScenarioInput, 'entry' | 'stop' | 'target' | 'side'>,
  exitPrice: number,
): PlanComparison {
  const plannedRewardR = calculateRiskReward(s)
  const realizedR = calculatePaperRMultiple(s, exitPrice)
  const eps = 1e-9
  let zone: PlanComparison['zone']
  if (Math.abs(realizedR - plannedRewardR) < 1e-6) zone = 'AT_TARGET'
  else if (realizedR > plannedRewardR + eps) zone = 'BEYOND_TARGET'
  else if (Math.abs(realizedR + 1) < 1e-6) zone = 'AT_STOP'
  else if (realizedR < -1 - eps) zone = 'BEYOND_STOP'
  else zone = 'BETWEEN'
  return {
    plannedRewardR,
    realizedR,
    captureRatio: Number((realizedR / plannedRewardR).toFixed(3)),
    zone,
    lossExceededPlan: zone === 'BEYOND_STOP',
  }
}

export type JournalSummary = {
  scenarios: number
  closed: number
  open: number
  wins: number
  losses: number
  breakeven: number
  totalR: number
  averageR: number | null
  followedPlanRate: number | null
}

export function summarizeJournal(entries: Pick<JournalEntry, 'outcome'>[]): JournalSummary {
  const closed = entries.flatMap((e) => (e.outcome ? [e.outcome] : []))
  const totalR = Number(closed.reduce((sum, o) => sum + o.rMultiple, 0).toFixed(3))
  return {
    scenarios: entries.length,
    closed: closed.length,
    open: entries.length - closed.length,
    wins: closed.filter((o) => o.rMultiple > 0).length,
    losses: closed.filter((o) => o.rMultiple < 0).length,
    breakeven: closed.filter((o) => o.rMultiple === 0).length,
    totalR,
    averageR: closed.length ? Number((totalR / closed.length).toFixed(3)) : null,
    followedPlanRate: closed.length
      ? Number((closed.filter((o) => o.followedPlan).length / closed.length).toFixed(3))
      : null,
  }
}

export function buildReviewPrompt(
  scenario: ScenarioCore & { marketRef?: Pick<MarketRef, 'asOfDate'> | null },
  role: 'BULL' | 'BEAR',
): string {
  const focus = role === 'BULL'
    ? 'このトレード案が合理的になる条件を示し、同時に最も強い反論も提示してください。'
    : 'このトレード案を採用しない理由を優先して探し、反証できる条件を提示してください。'
  return `あなたはトレード判断の監査役です。売買の指示や利益保証は不要です。
以下はユーザー入力の仮説であり、最新相場データではありません。リアルタイム価格や経済指標を確認できない場合、確認済みと主張しないでください。

銘柄: ${scenario.symbol}
時間足: ${scenario.timeframe}
方向: ${scenario.side}
エントリー仮説: ${scenario.entry}
損切り: ${scenario.stop}
利確: ${scenario.target}
リスクリワード: 1:${calculateRiskReward(scenario)}
根拠: ${scenario.thesis}
無効化条件: ${scenario.invalidation}${scenario.marketRef ? `\n仮説時点: ${scenario.marketRef.asOfDate} の足の終値時点（ユーザーが取り込んだCSVに基づく。最新相場ではありません）` : ''}

役割: ${role === 'BULL' ? '賛成側' : '反対側'}
${focus}

次の見出しで日本語で回答してください。
1. 仮説の強み
2. 反対材料・想定外のリスク
3. 欠けている事実（未確認と明記）
4. この案を撤回すべき条件
5. 判断前に検証するチェック項目

架空の根拠・価格・反発回数・ニュースを捏造しないでください。最終判断はユーザーが行います。`
}
