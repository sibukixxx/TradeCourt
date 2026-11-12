import { useEffect, useState } from 'preact/hooks'
import type { Bucket, DecisionAnalysis } from '@tradecourt/core'
import { api, exportUrl } from '../api'
import { getError, signed, timestamp } from '../format'
import { SeriesChart } from '../components/SeriesChart'

const windows: { value: number | null; label: string }[] = [
  { value: null, label: '全件' },
  { value: 50, label: '直近50件' },
  { value: 20, label: '直近20件' },
  { value: 10, label: '直近10件' },
]
const exitLabels = { TARGET: '利確価格に到達', STOP: '損切り価格に到達', INVALIDATED: '無効化条件が発生', MANUAL: '裁量で手仕舞い' } as const

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const avg = (v: number | null) => (v === null ? '—' : `${signed(v)}R`)
const tone = (v: number | null) => (v === null ? '' : v >= 0 ? 'positive' : 'negative')

function BucketRow({ label, b, testId }: { label: string; b: Bucket; testId?: string }) {
  return (
    <tr className="static" data-testid={testId}>
      <th>{label}</th><td>{b.count}</td>
      <td className={tone(b.averageR)}>{avg(b.averageR)}</td>
      <td className={b.count ? tone(b.totalR) : ''}>{b.count ? `${signed(b.totalR)}R` : '—'}</td>
      <td>{pct(b.winRate)}</td>
    </tr>
  )
}

type Props = { onError: (message: string) => void }

export function InsightsPanel({ onError }: Props) {
  const [limit, setLimit] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<DecisionAnalysis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let current = true
    setLoading(true)
    api.analysis(limit)
      .then((res) => current && setAnalysis(res.analysis))
      .catch((e: unknown) => current && onError(getError(e)))
      .finally(() => current && setLoading(false))
    return () => { current = false }
  }, [limit, onError])

  const a = analysis
  const pc = a?.pathComparison
  const planInsight = a && a.byPlan.followed.averageR !== null && a.byPlan.deviated.averageR !== null
    ? a.byPlan.deviated.averageR < a.byPlan.followed.averageR
      ? `ルールを破った回は、守った回より平均 ${signed(a.byPlan.deviated.averageR - a.byPlan.followed.averageR)}R 悪い結果です。`
      : `ルールを破った回の方が平均 ${signed(a.byPlan.deviated.averageR - a.byPlan.followed.averageR)}R 良い結果です（件数が少ないうちは偶然の可能性があります）。`
    : null

  return (
    <section className="panel" aria-labelledby="insights-title">
      <div className="section-head">
        <div><span className="eyebrow">05 / DECISION HABITS</span><h2 id="insights-title">Insights</h2><p>仮想取引の記録と、取込CSVから計算した参考値を集計して、自分の判断のクセを確認します。投資助言や実際の運用成績ではありません。</p></div>
        <span className="tag">PAPER · REFERENCE</span>
      </div>

      <div className="insights-toolbar">
        <div className="segmented" role="group" aria-label="集計範囲">
          {windows.map((w) => (
            <button key={w.label} type="button" aria-pressed={limit === w.value} className={limit === w.value ? 'selected' : ''} onClick={() => setLimit(w.value)}>{w.label}</button>
          ))}
        </div>
        <div className="export-links">
          <a className="secondary" href={exportUrl('csv')} download data-testid="export-csv">CSVでエクスポート</a>
          <a className="secondary" href={exportUrl('json')} download data-testid="export-json">JSONでエクスポート</a>
        </div>
      </div>

      {loading && !a ? <div className="empty" aria-busy="true">集計中…</div>
        : !a || a.window.closed === 0 ? (
          <div className="empty" data-testid="insights-empty">仮想結果が記録されたシナリオがまだありません。Journalで結果を記録すると、ここに傾向が表示されます。</div>
        ) : (
          <div data-testid="insights">
            <p className="muted small">対象: 仮想結果 {a.window.closed}件（全シナリオ {a.window.scenarios}件）{a.window.from && ` / 記録日 ${timestamp(a.window.from)} 〜 ${timestamp(a.window.to ?? a.window.from)}`}</p>
            <div className="stat-grid four">
              <div className="mini-stat"><span>平均R / 合計R</span><strong data-testid="ins-average" className={tone(a.overview.averageR)}>{avg(a.overview.averageR)}</strong><small>合計 {signed(a.overview.totalR)}R</small></div>
              <div className="mini-stat"><span>勝率（R &gt; 0）</span><strong data-testid="ins-winrate">{pct(a.overview.winRate)}</strong><small>{a.overview.count}件中</small></div>
              <div className="mini-stat"><span>最大ドローダウン</span><strong data-testid="ins-drawdown" className={a.overview.maxDrawdownR ? 'negative' : ''}>{a.overview.maxDrawdownR ? `-${a.overview.maxDrawdownR.toFixed(2)}R` : '0R'}</strong><small>累積Rの山から谷</small></div>
              <div className="mini-stat"><span>損切り超えの損失</span><strong data-testid="ins-beyond-stop" className={a.overview.lossBeyondStop ? 'negative' : ''}>{a.overview.lossBeyondStop}回</strong><small>-1Rより悪い結果</small></div>
            </div>
            <SeriesChart values={a.equity.map((p) => p.cumulativeR)} label="累積R（仮想・記録順）" testId="equity-chart" />

            <div className="insight-grid">
              <section className="insight-card" data-testid="ins-path">
                <h3>計画した水準との差 <span className="muted">取込CSVの値動き基準</span></h3>
                {!pc || pc.compared === 0 ? (
                  <p className="muted small">比較できる記録がありません。シナリオを相場データに紐付け、その後の足を含むCSVを取り込むと、手仕舞いの判断と値動きを比べられます。</p>
                ) : (
                  <>
                    <div className="gap-figure"><span>平均の差（あなたの仮想R − 値動きの参考R）</span><strong data-testid="ins-gap" className={tone(pc.averageGapR)}>{avg(pc.averageGapR)}</strong><small>{pc.compared}件で比較</small></div>
                    <ul className="gap-list">
                      <li data-testid="ins-missed"><span>利確に届いたのに早く降りた</span><strong>{pc.missedTarget.count}回</strong><em className={pc.missedTarget.count ? 'negative' : ''}>{pc.missedTarget.count ? `-${pc.missedTarget.totalR.toFixed(2)}R 取り逃し` : '—'}</em></li>
                      <li data-testid="ins-saved"><span>損切り前に降りて損失を抑えた</span><strong>{pc.savedFromStop.count}回</strong><em className={pc.savedFromStop.count ? 'positive' : ''}>{pc.savedFromStop.count ? `+${pc.savedFromStop.totalR.toFixed(2)}R 軽減` : '—'}</em></li>
                      <li data-testid="ins-worse"><span>損切りより悪い位置で降りた</span><strong>{pc.worseThanStop.count}回</strong><em className={pc.worseThanStop.count ? 'negative' : ''}>{pc.worseThanStop.count ? `-${pc.worseThanStop.totalR.toFixed(2)}R 超過` : '—'}</em></li>
                      <li><span>値動きどおり（±0.05R）</span><strong>{pc.matched}回</strong><em /></li>
                    </ul>
                  </>
                )}
                {pc && <p className="muted small">比較対象外: 未紐付け {pc.excluded.unlinked} / 後のデータなし {pc.excluded.noData} / 未決着 {pc.excluded.open} / 判定不能 {pc.excluded.ambiguous}</p>}
              </section>

              <section className="insight-card" data-testid="ins-plan">
                <h3>ルール遵守と結果</h3>
                <div className="table-wrap"><table className="compare-table">
                  <thead><tr><th></th><th>件数</th><th>平均R</th><th>合計R</th><th>勝率</th></tr></thead>
                  <tbody>
                    <BucketRow label="守った" b={a.byPlan.followed} testId="ins-followed" />
                    <BucketRow label="破った" b={a.byPlan.deviated} testId="ins-deviated" />
                  </tbody>
                </table></div>
                {planInsight && <p className="small insight-note" data-testid="ins-plan-note">{planInsight}</p>}
              </section>

              <section className="insight-card" data-testid="ins-exit">
                <h3>終了理由・方向別</h3>
                <div className="table-wrap"><table className="compare-table">
                  <thead><tr><th></th><th>件数</th><th>平均R</th><th>合計R</th><th>勝率</th></tr></thead>
                  <tbody>
                    {(Object.keys(exitLabels) as (keyof typeof exitLabels)[]).map((k) => <BucketRow key={k} label={exitLabels[k]} b={a.byExitReason[k]} />)}
                    <BucketRow label="LONG" b={a.bySide.LONG} />
                    <BucketRow label="SHORT" b={a.bySide.SHORT} />
                  </tbody>
                </table></div>
              </section>
            </div>
            <p className="muted small">すべてユーザーが入力した仮想取引と、ユーザーが取り込んだ未検証CSVからの参考値です。スプレッド・手数料・スワップは含みません。件数が少ないうちは偶然の影響が大きいため、傾向の目安として使ってください。</p>
          </div>
        )}
    </section>
  )
}
