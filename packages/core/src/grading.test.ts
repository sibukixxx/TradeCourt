import { describe, expect, it } from 'vitest'
import { reviewGradeInputSchema, suggestVerdict, summarizeReviewGrades, type ReviewScoreRow } from './grading'

describe('review grade contract', () => {
  it('accepts HIT/MISS/UNCLEAR with optional note and rejects anything else', () => {
    expect(reviewGradeInputSchema.parse({ verdict: 'HIT' })).toEqual({ verdict: 'HIT', note: '' })
    expect(reviewGradeInputSchema.safeParse({ verdict: 'MISS', note: '  trimmed  ' }).data?.note).toBe('trimmed')
    expect(reviewGradeInputSchema.safeParse({ verdict: 'CORRECT' }).success).toBe(false)
    expect(reviewGradeInputSchema.safeParse({ verdict: 'HIT', score: 5 }).success).toBe(false)
    expect(reviewGradeInputSchema.safeParse({ verdict: 'HIT', note: 'x'.repeat(1001) }).success).toBe(false)
  })
})

describe('suggestVerdict (default only, user decides)', () => {
  it('maps paper result direction to BULL/BEAR', () => {
    expect(suggestVerdict('BULL', 2)).toBe('HIT')
    expect(suggestVerdict('BEAR', 2)).toBe('MISS')
    expect(suggestVerdict('BULL', -1)).toBe('MISS')
    expect(suggestVerdict('BEAR', -0.4)).toBe('HIT')
    expect(suggestVerdict('BULL', 0)).toBe('UNCLEAR')
    expect(suggestVerdict('BEAR', Number.NaN)).toBe('UNCLEAR')
  })
})

describe('summarizeReviewGrades', () => {
  const row = (o: Partial<ReviewScoreRow>): ReviewScoreRow => ({
    scenarioId: 's1', provider: 'chatgpt', role: 'BEAR', verdict: null, rMultiple: null, ...o,
  })

  it('returns an empty scorecard for no reviews', () => {
    expect(summarizeReviewGrades([])).toEqual({
      cells: [],
      overall: { reviews: 0, graded: 0, hit: 0, miss: 0, unclear: 0, hitRate: null },
      awaitingGrade: 0,
      lossesWarnedByBear: 0,
    })
  })

  it('tallies per provider x role, excludes UNCLEAR from hit rate, orders cells', () => {
    const card = summarizeReviewGrades([
      row({ provider: 'claude', role: 'BULL', verdict: 'HIT', rMultiple: 2 }),
      row({ provider: 'chatgpt', role: 'BEAR', verdict: 'MISS', rMultiple: 2 }),
      row({ provider: 'chatgpt', role: 'BEAR', verdict: 'HIT', rMultiple: -1, scenarioId: 's2' }),
      row({ provider: 'chatgpt', role: 'BEAR', verdict: 'UNCLEAR', rMultiple: 0, scenarioId: 's3' }),
      row({ provider: 'chatgpt', role: 'BEAR', verdict: null, rMultiple: -1, scenarioId: 's4' }),
      row({ provider: 'grok', role: 'BULL', verdict: null, rMultiple: null, scenarioId: 's5' }),
    ])
    expect(card.cells.map((c) => `${c.provider}:${c.role}`)).toEqual(['chatgpt:BEAR', 'claude:BULL', 'grok:BULL'])
    expect(card.cells[0]).toEqual({ provider: 'chatgpt', role: 'BEAR', reviews: 4, graded: 3, hit: 1, miss: 1, unclear: 1, hitRate: 0.5 })
    expect(card.cells[2].hitRate).toBeNull()
    expect(card.overall).toEqual({ reviews: 6, graded: 4, hit: 2, miss: 1, unclear: 1, hitRate: 0.667 })
    expect(card.awaitingGrade).toBe(1) // s4 has an outcome but no verdict; s5 has no outcome yet
    expect(card.lossesWarnedByBear).toBe(1)
  })

  it('counts a warned loss once per scenario', () => {
    const card = summarizeReviewGrades([
      row({ provider: 'chatgpt', verdict: 'HIT', rMultiple: -1 }),
      row({ provider: 'gemini', verdict: 'HIT', rMultiple: -1 }),
    ])
    expect(card.lossesWarnedByBear).toBe(1)
  })
})
