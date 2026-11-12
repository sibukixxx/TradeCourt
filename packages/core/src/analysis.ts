// Aggregate "decision habit" analysis over the user's own PAPER records. Pure and deterministic.
// Inputs are user-entered paper outcomes and reference path checks from user-imported CSV;
// nothing here is broker data, live market data or investment advice.
import type { PathOutcome } from './path'

type ExitReason = 'TARGET' | 'STOP' | 'INVALIDATED' | 'MANUAL'
type Side = 'LONG' | 'SHORT'

export type AnalysisEntry = {
  scenario: { id: string; createdAt: string; side: Side; riskReward: number }
  outcome: { rMultiple: number; exitReason: ExitReason; followedPlan: boolean; recordedAt: string } | null
  /** Reference path check from imported CSV; null when the scenario is not linked to market data. */
  path: { outcome: PathOutcome; referenceR: number | null } | null
}

export type Bucket = {
  count: number
  totalR: number
  averageR: number | null
  /** Share of results with R > 0. */
  winRate: number | null
}

export type GapBucket = { count: number; totalR: number }

export type DecisionAnalysis = {
  window: { requested: number | null; closed: number; scenarios: number; from: string | null; to: string | null }
  overview: Bucket & { maxDrawdownR: number; lossBeyondStop: number }
  byPlan: { followed: Bucket; deviated: Bucket }
  byExitReason: Record<ExitReason, Bucket>
  bySide: Record<Side, Bucket>
  pathComparison: {
    /** Closed scenarios whose CSV path decided TARGET_FIRST or STOP_FIRST. */
    compared: number
    /** Mean of (paper R - path R). Negative = your exits did worse than the levels you planned. */
    averageGapR: number | null
    /** Path hit target first but the paper exit captured less: R left on the table. */
    missedTarget: GapBucket
    /** Path hit stop first but the paper exit lost less than -1R: R saved by exiting early. */
    savedFromStop: GapBucket
    /** Path hit stop first and the paper loss was worse than -1R: R lost beyond the plan. */
    worseThanStop: GapBucket
    /** Within ±0.05R of the path result. */
    matched: number
    excluded: { unlinked: number; noData: number; open: number; ambiguous: number }
  }
  /** Chronological (by recordedAt) paper R and cumulative R inside the window. */
  equity: { scenarioId: string; recordedAt: string; r: number; cumulativeR: number }[]
}

const EPS = 0.05
const r3 = (n: number) => Number(n.toFixed(3))

function bucket(rs: number[]): Bucket {
  const totalR = r3(rs.reduce((a, b) => a + b, 0))
  return {
    count: rs.length,
    totalR,
    averageR: rs.length ? r3(totalR / rs.length) : null,
    winRate: rs.length ? r3(rs.filter((r) => r > 0).length / rs.length) : null,
  }
}

const gap = (): GapBucket => ({ count: 0, totalR: 0 })

/**
 * @param limit analyse only the most recent `limit` closed records (by recordedAt); null = all.
 */
export function analyzeDecisions(entries: AnalysisEntry[], limit: number | null = null): DecisionAnalysis {
  const closedAll = entries
    .filter((e): e is AnalysisEntry & { outcome: NonNullable<AnalysisEntry['outcome']> } => e.outcome !== null)
    .sort((a, b) => a.outcome.recordedAt.localeCompare(b.outcome.recordedAt) || a.scenario.id.localeCompare(b.scenario.id))
  const closed = limit === null ? closedAll : closedAll.slice(-limit)
  const rs = closed.map((e) => e.outcome.rMultiple)

  let cumulative = 0
  let peak = 0
  let maxDrawdownR = 0
  const equity = closed.map((e) => {
    cumulative = r3(cumulative + e.outcome.rMultiple)
    peak = Math.max(peak, cumulative)
    maxDrawdownR = Math.max(maxDrawdownR, r3(peak - cumulative))
    return { scenarioId: e.scenario.id, recordedAt: e.outcome.recordedAt, r: e.outcome.rMultiple, cumulativeR: cumulative }
  })

  const reasons: ExitReason[] = ['TARGET', 'STOP', 'INVALIDATED', 'MANUAL']
  const byExitReason = Object.fromEntries(
    reasons.map((reason) => [reason, bucket(closed.filter((e) => e.outcome.exitReason === reason).map((e) => e.outcome.rMultiple))]),
  ) as Record<ExitReason, Bucket>

  const pc: DecisionAnalysis['pathComparison'] = {
    compared: 0, averageGapR: null, missedTarget: gap(), savedFromStop: gap(), worseThanStop: gap(), matched: 0,
    excluded: { unlinked: 0, noData: 0, open: 0, ambiguous: 0 },
  }
  const gaps: number[] = []
  for (const e of closed) {
    const p = e.path
    if (!p) { pc.excluded.unlinked++; continue }
    if (p.outcome === 'NO_DATA') { pc.excluded.noData++; continue }
    if (p.outcome === 'OPEN') { pc.excluded.open++; continue }
    if (p.outcome === 'AMBIGUOUS' || p.referenceR === null) { pc.excluded.ambiguous++; continue }
    pc.compared++
    const g = r3(e.outcome.rMultiple - p.referenceR)
    gaps.push(g)
    if (Math.abs(g) <= EPS) { pc.matched++; continue }
    if (p.outcome === 'TARGET_FIRST' && g < 0) { pc.missedTarget.count++; pc.missedTarget.totalR = r3(pc.missedTarget.totalR - g) }
    if (p.outcome === 'STOP_FIRST' && g > 0) { pc.savedFromStop.count++; pc.savedFromStop.totalR = r3(pc.savedFromStop.totalR + g) }
    if (p.outcome === 'STOP_FIRST' && g < 0) { pc.worseThanStop.count++; pc.worseThanStop.totalR = r3(pc.worseThanStop.totalR - g) }
  }
  pc.averageGapR = gaps.length ? r3(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null

  return {
    window: {
      requested: limit,
      closed: closed.length,
      scenarios: entries.length,
      from: closed[0]?.outcome.recordedAt ?? null,
      to: closed[closed.length - 1]?.outcome.recordedAt ?? null,
    },
    overview: { ...bucket(rs), maxDrawdownR, lossBeyondStop: rs.filter((r) => r < -1 - EPS).length },
    byPlan: {
      followed: bucket(closed.filter((e) => e.outcome.followedPlan).map((e) => e.outcome.rMultiple)),
      deviated: bucket(closed.filter((e) => !e.outcome.followedPlan).map((e) => e.outcome.rMultiple)),
    },
    byExitReason,
    bySide: {
      LONG: bucket(closed.filter((e) => e.scenario.side === 'LONG').map((e) => e.outcome.rMultiple)),
      SHORT: bucket(closed.filter((e) => e.scenario.side === 'SHORT').map((e) => e.outcome.rMultiple)),
    },
    pathComparison: pc,
    equity,
  }
}

// ---- CSV export helpers -----------------------------------------------------------------------

export type CsvCell = string | number | boolean | null | undefined

/**
 * One CSV field. Text that a spreadsheet could treat as a formula (= + - @, tab, CR) is prefixed
 * with an apostrophe (CSV/formula injection guard); numbers are written as numbers.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  let text = value
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
