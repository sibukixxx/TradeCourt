import { describe, expect, it } from 'vitest'
import {
  buildReviewPrompt,
  comparePlanToOutcome,
  summarizeJournal,
  type PaperOutcome,
  calculatePaperRMultiple,
  calculateRiskReward,
  paperOutcomeInputSchema,
  reviewInputSchema,
  scenarioInputSchema,
  type ScenarioInput,
} from './index'

const long: ScenarioInput = {
  symbol: 'USDJPY',
  timeframe: '4h',
  side: 'LONG',
  entry: 150.2,
  stop: 149.6,
  target: 151.4,
  thesis: 'Synthetic example: pullback toward prior resistance',
  invalidation: 'Scenario rejected if price closes under 149.6',
}

describe('scenario contract', () => {
  it('accepts a valid long and a valid short', () => {
    expect(scenarioInputSchema.safeParse(long).success).toBe(true)
    expect(scenarioInputSchema.safeParse({
      ...long, side: 'SHORT', stop: 151, target: 149,
    }).success).toBe(true)
  })

  it('rejects inverse stop / target and nonpositive prices', () => {
    expect(scenarioInputSchema.safeParse({ ...long, stop: 151 }).success).toBe(false)
    expect(scenarioInputSchema.safeParse({ ...long, entry: -1 }).success).toBe(false)
    expect(scenarioInputSchema.safeParse({ ...long, target: 149 }).success).toBe(false)
  })

  it('rejects additional fields, short reviews and invalid paper exits', () => {
    expect(scenarioInputSchema.safeParse({ ...long, apiKey: 'do-not-store' }).success).toBe(false)
    expect(reviewInputSchema.safeParse({
      provider: 'chatgpt', role: 'BULL', content: 'short',
    }).success).toBe(false)
    expect(paperOutcomeInputSchema.safeParse({ exitPrice: 0 }).success).toBe(false)
  })
})

describe('pure trade math and prompt boundaries', () => {
  it('computes directional risk/reward and paper R multiple', () => {
    expect(calculateRiskReward(long)).toBe(2)
    expect(calculatePaperRMultiple(long, 151.4)).toBe(2)
    expect(calculatePaperRMultiple(long, 149.6)).toBe(-1)
    expect(calculatePaperRMultiple({
      ...long, side: 'SHORT', stop: 151,
    }, 149)).toBe(1.5)
  })

  it('generates distinct roles without pretending to know live prices', () => {
    const bull = buildReviewPrompt(long, 'BULL')
    const bear = buildReviewPrompt(long, 'BEAR')
    expect(bull).toContain('賛成側')
    expect(bear).toContain('反対側')
    expect(bull).not.toEqual(bear)
    expect(bull).toContain('リアルタイム価格')
  })
})

describe('review and outcome contracts', () => {
  it('accepts an optional ISO respondedAt and rejects free text dates', () => {
    const base = { provider: 'claude', role: 'BEAR', content: 'Synthetic pasted answer text' }
    expect(reviewInputSchema.safeParse(base).success).toBe(true)
    expect(reviewInputSchema.safeParse({ ...base, respondedAt: '2026-11-12T10:00:00.000Z' }).success).toBe(true)
    expect(reviewInputSchema.safeParse({ ...base, respondedAt: 'yesterday' }).success).toBe(false)
    expect(reviewInputSchema.safeParse({ ...base, provider: 'openai-api' }).success).toBe(false)
  })

  it('defaults exit reason and followedPlan, rejects unknown reasons', () => {
    const parsed = paperOutcomeInputSchema.parse({ exitPrice: 150 })
    expect(parsed).toEqual({ exitPrice: 150, exitReason: 'MANUAL', followedPlan: true, note: '' })
    expect(paperOutcomeInputSchema.safeParse({ exitPrice: 150, exitReason: 'BROKER_FILL' }).success).toBe(false)
  })
})

describe('plan vs paper outcome comparison', () => {
  it('classifies the exit zone relative to the original plan', () => {
    expect(comparePlanToOutcome(long, 151.4)).toMatchObject({ plannedRewardR: 2, realizedR: 2, zone: 'AT_TARGET', captureRatio: 1 })
    expect(comparePlanToOutcome(long, 150.8)).toMatchObject({ realizedR: 1, zone: 'BETWEEN', captureRatio: 0.5 })
    expect(comparePlanToOutcome(long, 149.6).zone).toBe('AT_STOP')
    expect(comparePlanToOutcome(long, 149.0)).toMatchObject({ zone: 'BEYOND_STOP', lossExceededPlan: true })
    expect(comparePlanToOutcome(long, 152.0).zone).toBe('BEYOND_TARGET')
    const short = { ...long, side: 'SHORT' as const, stop: 151, target: 149 }
    expect(comparePlanToOutcome(short, 149)).toMatchObject({ plannedRewardR: 1.5, realizedR: 1.5, zone: 'AT_TARGET' })
  })

  it('summarizes paper journal entries without inventing open results', () => {
    const outcome = (r: number, followedPlan = true): PaperOutcome => ({
      scenarioId: String(r), exitPrice: 150, rMultiple: r, exitReason: 'MANUAL', followedPlan,
      note: '', recordedAt: '2026-11-12T00:00:00.000Z', kind: 'paper',
    })
    expect(summarizeJournal([])).toMatchObject({ scenarios: 0, closed: 0, averageR: null, followedPlanRate: null })
    const summary = summarizeJournal([{ outcome: outcome(2) }, { outcome: outcome(-1, false) }, { outcome: null }])
    expect(summary).toEqual({
      scenarios: 3, closed: 2, open: 1, wins: 1, losses: 1, breakeven: 0,
      totalR: 1, averageR: 0.5, followedPlanRate: 0.5,
    })
  })
})
