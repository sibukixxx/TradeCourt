import { describe, expect, it } from 'vitest'
import { analyzeDecisions, csvCell, toCsv, type AnalysisEntry } from './analysis'
import { suggestVerdictFromPath } from './grading'

// SYNTHETIC paper records only.
let n = 0
const entry = (
  r: number | null,
  opts: { path?: AnalysisEntry['path']; exitReason?: 'TARGET' | 'STOP' | 'INVALIDATED' | 'MANUAL'; followedPlan?: boolean; side?: 'LONG' | 'SHORT' } = {},
): AnalysisEntry => {
  n += 1
  const day = String(n).padStart(2, '0')
  return {
    scenario: { id: `s${day}`, createdAt: `2026-01-${day}T00:00:00.000Z`, side: opts.side ?? 'LONG', riskReward: 2 },
    outcome: r === null ? null : { rMultiple: r, exitReason: opts.exitReason ?? 'MANUAL', followedPlan: opts.followedPlan ?? true, recordedAt: `2026-02-${day}T00:00:00.000Z` },
    path: opts.path ?? null,
  }
}

describe('analyzeDecisions', () => {
  it('handles no data', () => {
    const a = analyzeDecisions([])
    expect(a.overview).toEqual({ count: 0, totalR: 0, averageR: null, winRate: null, maxDrawdownR: 0, lossBeyondStop: 0 })
    expect(a.pathComparison.averageGapR).toBeNull()
    expect(a.equity).toEqual([])
  })

  it('splits by plan adherence, exit reason and side, with equity curve and drawdown', () => {
    n = 0
    const entries = [
      entry(2, { exitReason: 'TARGET' }),
      entry(-1, { exitReason: 'STOP' }),
      entry(-1.5, { exitReason: 'MANUAL', followedPlan: false, side: 'SHORT' }),
      entry(0.5, { exitReason: 'MANUAL', followedPlan: false }),
      entry(null), // open scenario: excluded from closed metrics
    ]
    const a = analyzeDecisions(entries)
    expect(a.window).toMatchObject({ requested: null, closed: 4, scenarios: 5, from: '2026-02-01T00:00:00.000Z', to: '2026-02-04T00:00:00.000Z' })
    expect(a.overview).toEqual({ count: 4, totalR: 0, averageR: 0, winRate: 0.5, maxDrawdownR: 2.5, lossBeyondStop: 1 })
    expect(a.byPlan.followed).toEqual({ count: 2, totalR: 1, averageR: 0.5, winRate: 0.5 })
    expect(a.byPlan.deviated).toEqual({ count: 2, totalR: -1, averageR: -0.5, winRate: 0.5 })
    expect(a.byExitReason.TARGET.averageR).toBe(2)
    expect(a.byExitReason.INVALIDATED).toEqual({ count: 0, totalR: 0, averageR: null, winRate: null })
    expect(a.bySide.SHORT).toMatchObject({ count: 1, totalR: -1.5 })
    expect(a.equity.map((p) => p.cumulativeR)).toEqual([2, 1, -0.5, 0])
  })

  it('compares paper exits with the reference CSV path', () => {
    n = 0
    const entries = [
      entry(0.8, { path: { outcome: 'TARGET_FIRST', referenceR: 2 } }), // missed 1.2R
      entry(2, { path: { outcome: 'TARGET_FIRST', referenceR: 2 } }), // matched
      entry(-0.4, { path: { outcome: 'STOP_FIRST', referenceR: -1 } }), // saved 0.6R
      entry(-1.3, { path: { outcome: 'STOP_FIRST', referenceR: -1 } }), // 0.3R worse than stop
      entry(1, { path: { outcome: 'AMBIGUOUS', referenceR: null } }),
      entry(1, { path: { outcome: 'OPEN', referenceR: 0.4 } }),
      entry(1, { path: { outcome: 'NO_DATA', referenceR: null } }),
      entry(1), // unlinked
    ]
    const pc = analyzeDecisions(entries).pathComparison
    expect(pc).toEqual({
      compared: 4,
      averageGapR: -0.225, // (-1.2 + 0 + 0.6 - 0.3) / 4
      missedTarget: { count: 1, totalR: 1.2 },
      savedFromStop: { count: 1, totalR: 0.6 },
      worseThanStop: { count: 1, totalR: 0.3 },
      matched: 1,
      excluded: { unlinked: 1, noData: 1, open: 1, ambiguous: 1 },
    })
  })

  it('limits the window to the most recent closed records', () => {
    n = 0
    const entries = [entry(-1), entry(-1), entry(2), entry(2)]
    const a = analyzeDecisions(entries, 2)
    expect(a.window).toMatchObject({ requested: 2, closed: 2, from: '2026-02-03T00:00:00.000Z' })
    expect(a.overview).toMatchObject({ count: 2, totalR: 4, winRate: 1 })
  })
})

describe('suggestVerdictFromPath', () => {
  it('maps the path outcome to BULL/BEAR, or null when undecided', () => {
    expect(suggestVerdictFromPath('BULL', 'TARGET_FIRST')).toBe('HIT')
    expect(suggestVerdictFromPath('BEAR', 'TARGET_FIRST')).toBe('MISS')
    expect(suggestVerdictFromPath('BEAR', 'STOP_FIRST')).toBe('HIT')
    expect(suggestVerdictFromPath('BULL', 'AMBIGUOUS')).toBeNull()
    expect(suggestVerdictFromPath('BULL', 'OPEN')).toBeNull()
  })
})

describe('CSV export helpers', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(-1.5)).toBe('-1.5')
    expect(csvCell(true)).toBe('true')
  })

  it('neutralises spreadsheet formulas in text cells', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 1], ['b', null]])).toBe('a,1\r\nb,\r\n')
  })
})
