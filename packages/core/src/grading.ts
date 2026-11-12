import { z } from 'zod'

// Post-hoc grading ("答え合わせ") of manually pasted AI reviews against the user's own PAPER outcome.
// A verdict is the user's subjective judgment. It is not market verification of the AI's claims.

export const verdictSchema = z.enum(['HIT', 'MISS', 'UNCLEAR'])
export type Verdict = z.infer<typeof verdictSchema>

export const reviewGradeInputSchema = z.object({
  verdict: verdictSchema,
  note: z.string().trim().max(1000).default(''),
}).strict()
export type ReviewGradeInput = z.input<typeof reviewGradeInputSchema>

export type ReviewGrade = {
  verdict: Verdict
  note: string
  gradedAt: string
}

type GradeRole = 'BULL' | 'BEAR'
type GradeProvider = 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'other'

/**
 * Default suggestion only; the user decides. A BULL argument "hit" when the paper trade made
 * money, a BEAR argument "hit" when it lost. Exactly 0R cannot be judged mechanically.
 */
export function suggestVerdict(role: GradeRole, rMultiple: number): Verdict {
  if (!Number.isFinite(rMultiple) || rMultiple === 0) return 'UNCLEAR'
  const profitable = rMultiple > 0
  return (role === 'BULL') === profitable ? 'HIT' : 'MISS'
}

export type ReviewScoreRow = {
  scenarioId: string
  provider: GradeProvider
  role: GradeRole
  verdict: Verdict | null
  /** Paper R multiple of the scenario, or null if no paper outcome recorded yet. */
  rMultiple: number | null
}

export type ScoreCell = {
  provider: GradeProvider
  role: GradeRole
  reviews: number
  graded: number
  hit: number
  miss: number
  unclear: number
  /** hit / (hit + miss); UNCLEAR is excluded. null when nothing decisive is graded. */
  hitRate: number | null
}

export type ReviewScorecard = {
  cells: ScoreCell[]
  overall: Omit<ScoreCell, 'provider' | 'role'>
  /** Reviews whose scenario has a paper outcome but no verdict yet. */
  awaitingGrade: number
  /** Losing paper trades where at least one BEAR warning was graded HIT. */
  lossesWarnedByBear: number
}

const providerOrder: GradeProvider[] = ['chatgpt', 'claude', 'gemini', 'grok', 'other']
const roleOrder: GradeRole[] = ['BULL', 'BEAR']

function tally(rows: ReviewScoreRow[]): Omit<ScoreCell, 'provider' | 'role'> {
  const hit = rows.filter((r) => r.verdict === 'HIT').length
  const miss = rows.filter((r) => r.verdict === 'MISS').length
  const unclear = rows.filter((r) => r.verdict === 'UNCLEAR').length
  return {
    reviews: rows.length,
    graded: hit + miss + unclear,
    hit,
    miss,
    unclear,
    hitRate: hit + miss ? Number((hit / (hit + miss)).toFixed(3)) : null,
  }
}

export function summarizeReviewGrades(rows: ReviewScoreRow[]): ReviewScorecard {
  const cells: ScoreCell[] = []
  for (const provider of providerOrder) {
    for (const role of roleOrder) {
      const subset = rows.filter((r) => r.provider === provider && r.role === role)
      if (subset.length) cells.push({ provider, role, ...tally(subset) })
    }
  }
  const warnedLosses = new Set(
    rows.filter((r) => r.role === 'BEAR' && r.verdict === 'HIT' && r.rMultiple !== null && r.rMultiple < 0)
      .map((r) => r.scenarioId),
  )
  return {
    cells,
    overall: tally(rows),
    awaitingGrade: rows.filter((r) => r.rMultiple !== null && r.verdict === null).length,
    lossesWarnedByBear: warnedLosses.size,
  }
}

/**
 * Alternative suggestion from the reference CSV path check: target first => BULL argument held,
 * stop first => BEAR argument held. null when the path cannot decide (open / ambiguous / no data).
 */
export function suggestVerdictFromPath(
  role: GradeRole,
  pathOutcome: 'TARGET_FIRST' | 'STOP_FIRST' | 'AMBIGUOUS' | 'OPEN' | 'NO_DATA',
): Verdict | null {
  if (pathOutcome === 'TARGET_FIRST') return role === 'BULL' ? 'HIT' : 'MISS'
  if (pathOutcome === 'STOP_FIRST') return role === 'BEAR' ? 'HIT' : 'MISS'
  return null
}
