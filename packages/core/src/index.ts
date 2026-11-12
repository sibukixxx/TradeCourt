import { z } from 'zod'

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

export const reviewInputSchema = z.object({
  provider: z.enum(['chatgpt', 'claude', 'gemini', 'grok', 'other']),
  role: z.enum(['BULL', 'BEAR']),
  content: z.string().trim().min(10).max(20000),
}).strict()

export const paperOutcomeInputSchema = z.object({
  exitPrice: positivePrice,
  note: z.string().trim().max(2000).default(''),
}).strict()

export type ScenarioInput = z.infer<typeof scenarioInputSchema>
export type ReviewInput = z.infer<typeof reviewInputSchema>
export type PaperOutcomeInput = z.input<typeof paperOutcomeInputSchema>

export type Scenario = ScenarioInput & {
  id: string
  createdAt: string
  riskReward: number
}

export type Review = ReviewInput & {
  id: string
  scenarioId: string
  createdAt: string
}

export type PaperOutcome = {
  scenarioId: string
  exitPrice: number
  rMultiple: number
  note: string
  recordedAt: string
}

export type ScenarioDetail = {
  scenario: Scenario
  reviews: Review[]
  outcome: PaperOutcome | null
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

export function buildReviewPrompt(scenario: ScenarioInput, role: 'BULL' | 'BEAR'): string {
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
無効化条件: ${scenario.invalidation}

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
