import { useEffect, useState } from 'preact/hooks'
import type { PathCheckResponse, PathOutcome, ScenarioDetail } from '@tradecourt/core'
import { api } from '../api'
import { getError, signed, timestamp } from '../format'
import { PriceChart } from '../components/PriceChart'

export const pathOutcomeLabels: Record<PathOutcome, string> = {
  TARGET_FIRST: '利確に先に到達',
  STOP_FIRST: '損切りに先に到達',
  AMBIGUOUS: '判定不能（同じ足で両方に到達）',
  OPEN: '未決着（どちらにも未到達）',
  NO_DATA: '仮説時点より後のデータなし',
}

type Props = {
  detail: ScenarioDetail
  onError: (message: string) => void
  /** Reports the evaluated path outcome so grading can suggest verdicts from price action. */
  onResult?: (outcome: PathOutcome | null) => void
}

export function PathCheck({ detail, onError, onResult }: Props) {
  const { scenario, outcome } = detail
  const [datasetId, setDatasetId] = useState<string | undefined>(undefined)
  const [data, setData] = useState<PathCheckResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!scenario.marketRef) return
    let current = true
    setLoading(true)
    api.pathCheck(scenario.id, datasetId)
      .then((res) => { if (current) { setData(res); onResult?.(res.evaluation.outcome) } })
      .catch((e: unknown) => current && onError(getError(e)))
      .finally(() => current && setLoading(false))
    return () => { current = false }
  }, [scenario.id, scenario.marketRef, datasetId, onError, onResult])

  if (!scenario.marketRef) {
    return (
      <section className="path-check" data-testid="path-check">
        <h3>値動きとの照合 <span className="muted">参考</span></h3>
        <p className="muted small" data-testid="path-check-unlinked">このシナリオは相場データ（CSV）に紐付いていないため照合できません。シナリオ作成時に取込済みCSVの足を選ぶと、後から取り込んだCSVで「損切りと利確のどちらに先に届いたか」を確認できます。</p>
      </section>
    )
  }

  const ev = data?.evaluation
  const options = data ? [data.dataset, ...data.candidates.filter((d) => d.id !== data.dataset.id)] : []
  const diff = ev && outcome && ev.referenceR !== null && ev.outcome !== 'OPEN' ? outcome.rMultiple - ev.referenceR : null
  const reasonMismatch = ev && outcome && (
    (ev.outcome === 'TARGET_FIRST' && outcome.exitReason === 'STOP') ||
    (ev.outcome === 'STOP_FIRST' && outcome.exitReason === 'TARGET')
  )

  return (
    <section className="path-check" aria-labelledby="path-check-title" data-testid="path-check">
      <div className="grading-head">
        <h3 id="path-check-title">値動きとの照合 <span className="muted">参考・取込CSVから算出</span></h3>
        <span className="muted small">仮説時点: {scenario.marketRef.asOfDate} の足の終値（端末の時刻で {timestamp(scenario.marketRef.asOfAt)}）</span>
      </div>
      {options.length > 0 && (
        <label className="path-dataset">照合に使うCSV
          <select data-testid="path-dataset" value={data?.dataset.id ?? ''} onChange={(e) => setDatasetId(e.currentTarget.value)}>
            {options.map((d) => <option key={d.id} value={d.id}>{d.sourceName} · {d.timeframe} · {d.firstDate}→{d.lastDate}{d.tzOffset ? ` · UTC${d.tzOffset}` : ' · TZ未指定'}</option>)}
          </select>
        </label>
      )}
      {loading && !data ? <p className="muted small" aria-busy="true">照合中…</p> : ev && data && (
        <>
          <div className={'path-result ' + ev.outcome.toLowerCase()} data-testid="path-result">
            <strong data-testid="path-outcome">{pathOutcomeLabels[ev.outcome]}</strong>
            {ev.referenceR !== null && <span data-testid="path-r" className={ev.referenceR >= 0 ? 'positive' : 'negative'}>{signed(ev.referenceR)}R{ev.outcome === 'OPEN' ? '（最終足の終値で評価）' : ''}</span>}
            {ev.decidedDate && ev.outcome !== 'OPEN' && <span>判定足 {ev.decidedDate}（{ev.barsChecked}本目）</span>}
            {ev.outcome === 'OPEN' && <span>{ev.barsChecked}本を確認（〜{ev.decidedDate}）</span>}
          </div>
          {ev.gap && <p className="warn small" data-testid="path-gap">判定足の始値が既に水準を越えていました（窓開け）。始値ベースでは {signed(ev.gapOpenR ?? 0)}R です。</p>}
          {(ev.mfeR !== null || ev.maeR !== null) && (
            <p className="small muted">判定足より前の最大含み益 {ev.mfeR === null ? '—' : signed(ev.mfeR) + 'R'} / 最大含み損 {ev.maeR === null ? '—' : signed(ev.maeR) + 'R'}</p>
          )}
          {ev.outcome === 'NO_DATA' && <p className="muted small">仮説時点より後の足を含むCSVをMarket Lensで取り込むと照合できます。</p>}
          {data.chart.candles.length > 0 && (
            <PriceChart
              candles={data.chart.candles}
              label={`終値（${data.dataset.sourceName}）`}
              levels={{ entry: scenario.entry, stop: scenario.stop, target: scenario.target }}
              asOfIndex={data.chart.firstAfterIndex ?? data.chart.candles.length}
              decidedIndex={ev.outcome === 'OPEN' ? null : data.chart.decidedIndex}
              testId="path-chart"
              ranges
            />
          )}
          {outcome && ev.outcome !== 'NO_DATA' && (
            <div className="path-compare" data-testid="path-compare">
              <span>あなたの仮想結果 <strong className={outcome.rMultiple >= 0 ? 'positive' : 'negative'}>{signed(outcome.rMultiple)}R</strong></span>
              <span>CSV参照 <strong>{ev.referenceR === null ? '—' : signed(ev.referenceR) + 'R'}</strong></span>
              {diff !== null && <span>差 <strong className={diff >= 0 ? 'positive' : 'negative'}>{signed(diff)}R</strong></span>}
              {reasonMismatch && <span className="warn" data-testid="path-mismatch">終了理由がCSVの値動きと一致しません</span>}
            </div>
          )}
          <p className="muted small">前提: 仮説時点の足の終値でEntry価格にて保有開始と仮定し、その後に始まる足だけを使用（先読みなし）。同じ足で両方に触れた場合は順序不明。スプレッド・手数料・スワップは含みません。ユーザーが取り込んだ未検証のCSVに基づく参考値で、約定記録ではありません。</p>
        </>
      )}
    </section>
  )
}
