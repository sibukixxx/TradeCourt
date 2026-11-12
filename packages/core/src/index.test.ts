import { describe, expect, it } from 'vitest'
import {
  buildReviewPrompt,
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
      ...long, side: 'SHORT', stop: 151, target: 149,
    }, 149)).toBe(1.25)
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
