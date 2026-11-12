import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aiProviders,
  buildReviewPrompt,
  calculateRiskReward,
  scenarioInputSchema,
  type Scenario,
  type ScenarioDetail,
} from '@tradecourt/core'
import { api } from './api'
import { chartPoints, parseOhlcCsv, type Candle } from './market'

type Page = 'market' | 'scenario' | 'court' | 'journal'
type Provider = keyof typeof aiProviders
type Draft = {
  symbol: 'USDJPY'
  timeframe: '1h' | '4h' | '1d'
  side: 'LONG' | 'SHORT'
  entry: string
  stop: string
  target: string
  thesis: string
  invalidation: string
}
const blankDraft: Draft = {
  symbol: 'USDJPY',
  timeframe: '4h',
  side: 'LONG',
  entry: '', stop: '', target: '', thesis: '', invalidation: '',
}
const price = (value: number) => value.toFixed(3)
const timestamp = (value: string) => new Date(value).toLocaleString('ja-JP')

function getError(error: unknown): string {
  return error instanceof Error ? error.message : '予期しないエラーが発生しました'
}

function MarketPanel() {
  const [candles, setCandles] = useState<Candle[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const latest = candles.at(-1)
  const first = candles[0]
  const delta = latest && first ? latest.close - first.close : 0
  async function importCsv(file: File | undefined) {
    if (!file) return
    setError('')
    if (file.size > 2 * 1024 * 1024) {
      setError('CSVファイルは2MB以下にしてください')
      return
    }
    try {
      const result = parseOhlcCsv(await file.text())
      setCandles(result)
      setFileName(file.name)
    } catch (e) {
      setError(getError(e))
    }
  }
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">01 / MARKET EVIDENCE</span>
          <h2>Market Lens</h2>
          <p>OHLCを手元のCSVから読み込んで確認します。リアルタイム配信はありません。</p>
        </div>
        <span className="tag">ローカルのみ</span>
      </div>
      <label className="dropzone">
        <strong>OHLC CSVを読み込む</strong>
        <span>date,open,high,low,close の5列 / 最大5,000行 / 2MB</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => void importCsv(e.target.files?.[0])} />
      </label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {latest && first ? (
        <div className="market-data">
          <div className="stat-grid">
            <div className="mini-stat"><span>最新終値（CSV）</span><strong>{price(latest.close)}</strong></div>
            <div className="mini-stat"><span>期間変化</span><strong className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{price(delta)}</strong></div>
            <div className="mini-stat"><span>データ本数</span><strong>{candles.length}</strong></div>
          </div>
          <div className="chart-wrap">
            <svg viewBox="0 0 640 180" role="img" aria-label="インポートしたCSVの終値推移">
              <line x1="0" y1="90" x2="640" y2="90" className="chart-grid" />
              <polyline points={chartPoints(candles)} fill="none" stroke="#6bceb6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
          <p className="muted small">出典: 手動インポート「{fileName}」 / 最終行: {latest.date}。価格の真偽・時刻・並び順は未検証です。</p>
        </div>
      ) : (
        <div className="empty short">価格の推移は、CSVを読み込むまで表示されません。値動きを捏造しないため、デモチャートはありません。</div>
      )}
    </section>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('scenario')
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ScenarioDetail | null>(null)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [provider, setProvider] = useState<Provider>('chatgpt')
  const [role, setRole] = useState<'BULL' | 'BEAR'>('BEAR')
  const [reviewText, setReviewText] = useState('')
  const [exitPrice, setExitPrice] = useState('')
  const [outcomeNote, setOutcomeNote] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const parsed = useMemo(() => scenarioInputSchema.safeParse({
    ...draft,
    entry: Number(draft.entry),
    stop: Number(draft.stop),
    target: Number(draft.target),
  }), [draft])
  const ratio = parsed.success ? calculateRiskReward(parsed.data) : null

  useEffect(() => {
    let mounted = true
    Promise.all([api.health(), api.list()]).then(([health, list]) => {
      if (!mounted) return
      setReady(health.status === 'ok')
      setScenarios(list.scenarios)
      if (list.scenarios[0]) {
        setSelectedId(list.scenarios[0].id)
        void api.detail(list.scenarios[0].id).then((found) => {
          if (mounted) setDetail(found)
        }).catch((e: unknown) => {
          if (mounted) setError(getError(e))
        })
      }
    }).catch((e: unknown) => {
      if (mounted) setError(getError(e) + '。未初期化なら pnpm db:migrate:local を実行してください。')
    })
    return () => { mounted = false }
  }, [])

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((old) => ({ ...old, [key]: value }))
  }
  function message(text: string) { setError(''); setNotice(text) }

  async function selectScenario(id: string, nextPage: Page = 'court') {
    setSelectedId(id)
    setPage(nextPage)
    setError('')
    try {
      setDetail(await api.detail(id))
    } catch (e) { setError(getError(e)) }
  }

  async function createScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || '入力値を確認してください')
      return
    }
    setBusy(true)
    try {
      const { scenario } = await api.create(parsed.data)
      setScenarios((items) => [scenario, ...items])
      setDraft(blankDraft)
      await selectScenario(scenario.id)
      message('シナリオを保存しました。AI審査を開始できます。')
    } catch (e) { setError(getError(e)) }
    finally { setBusy(false) }
  }

  const selected = detail?.scenario
  const prompt = selected ? buildReviewPrompt(selected, role) : ''

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      message('プロンプトをコピーしました。契約中のAIサービスへ貼り付けてください。')
    } catch {
      setError('クリップボードにコピーできません。下のテキスト欄を選択して手動コピーしてください。')
    }
  }

  async function saveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api.review(selected.id, { provider, role, content: reviewText })
      setReviewText('')
      setDetail(await api.detail(selected.id))
      message('AIの回答を「手動貼付レビュー」として保存しました。')
    } catch (e) { setError(getError(e)) }
    finally { setBusy(false) }
  }

  async function saveOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const exit = Number(exitPrice)
    if (!Number.isFinite(exit) || exit <= 0) { setError('正の終了価格を入力してください'); return }
    setBusy(true); setError('')
    try {
      await api.paperOutcome(selected.id, exit, outcomeNote)
      setDetail(await api.detail(selected.id))
      message('仮想取引の結果を保存しました。これは実際の約定記録ではありません。')
    } catch (e) { setError(getError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">TC</span><div><strong>TradeCourt</strong><span>DECISION INTELLIGENCE</span></div></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav">
          <button className={page === 'market' ? 'active' : ''} onClick={() => setPage('market')}><span>01</span> Market Lens</button>
          <button className={page === 'scenario' ? 'active' : ''} onClick={() => setPage('scenario')}><span>02</span> Scenario</button>
          <button className={page === 'court' ? 'active' : ''} onClick={() => setPage('court')}><span>03</span> AI Court</button>
          <button className={page === 'journal' ? 'active' : ''} onClick={() => setPage('journal')}><span>04</span> Journal</button>
        </nav>
        <div className="nav-label history-label">SCENARIO HISTORY</div>
        <div className="history">
          {scenarios.length === 0 && <p className="muted small">まだシナリオがありません</p>}
          {scenarios.map((s) => (
            <button key={s.id} className={'history-item ' + (selectedId === s.id ? 'selected' : '')} onClick={() => void selectScenario(s.id)}>
              <span className="history-top"><strong>{s.symbol} / {s.timeframe}</strong><span className={'side ' + (s.side === 'LONG' ? 'long' : 'short-side')}>{s.side}</span></span>
              <span>{price(s.entry)} → {price(s.target)}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">LOCAL FIRST <span>·</span> NO AUTO TRADING</div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">TRADE DECISION WORKSPACE</span><h1>Assess. Challenge. Learn.</h1></div>
          <div className="top-status"><span className={'status-dot ' + (ready ? 'on' : '')} />{ready ? 'LOCAL D1 READY' : 'CHECK API SETUP'}</div>
        </header>

        <div className="hero-stats">
          <div><span>Saved scenarios</span><strong>{scenarios.length}</strong></div>
          <div><span>Selected R:R</span><strong>{selected ? '1 : ' + selected.riskReward.toFixed(2) : '—'}</strong></div>
          <div><span>AI review records</span><strong>{detail?.reviews.length ?? '—'}</strong></div>
          <div><span>Execution</span><strong className="negative">DISABLED</strong></div>
        </div>

        {error && <div role="alert" className="alert error"><strong>確認が必要です</strong><span>{error}</span><button onClick={() => setError('')} aria-label="閉じる">×</button></div>}
        {notice && <div role="status" className="alert success"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="閉じる">×</button></div>}

        {page === 'market' && <MarketPanel />}

        {page === 'scenario' && (
          <section className="panel">
            <div className="section-head">
              <div><span className="eyebrow">02 / STRUCTURE THE THESIS</span><h2>New Scenario</h2><p>判断前の仮説を固定します。価格は手動入力です。現在値ではありません。</p></div>
              <span className="tag">USD/JPY · INITIAL SCOPE</span>
            </div>
            <form onSubmit={(e) => void createScenario(e)} className="scenario-form">
              <div className="form-grid">
                <label>通貨ペア<input value="USD/JPY" readOnly /></label>
                <label>時間足<select value={draft.timeframe} onChange={(e) => patch('timeframe', e.target.value as Draft['timeframe'])}>
                  <option value="1h">1時間</option><option value="4h">4時間</option><option value="1d">日足</option>
                </select></label>
                <label>方向<select value={draft.side} onChange={(e) => patch('side', e.target.value as Draft['side'])}>
                  <option value="LONG">LONG / 買い</option><option value="SHORT">SHORT / 売り</option>
                </select></label>
              </div>
              <div className="form-grid price-grid">
                <label>Entry / 仮説価格<input type="number" inputMode="decimal" step="any" min="0.001" placeholder="150.200" required value={draft.entry} onChange={(e) => patch('entry', e.target.value)} /></label>
                <label>Stop / 損切り<input type="number" inputMode="decimal" step="any" min="0.001" placeholder="149.600" required value={draft.stop} onChange={(e) => patch('stop', e.target.value)} /></label>
                <label>Target / 利確<input type="number" inputMode="decimal" step="any" min="0.001" placeholder="151.400" required value={draft.target} onChange={(e) => patch('target', e.target.value)} /></label>
              </div>
              <div className="ratio-preview">
                <span>想定リスクリワード</span>
                <strong>{ratio === null ? '入力待ち' : '1 : ' + ratio.toFixed(2)}</strong>
                <span>LONG: Stop &lt; Entry &lt; Target / SHORT: Target &lt; Entry &lt; Stop</span>
              </div>
              <label>エントリーの根拠<textarea required minLength={12} rows={3} placeholder="具体的な根拠。現時点で確認できていない点も書いてください。" value={draft.thesis} onChange={(e) => patch('thesis', e.target.value)} /></label>
              <label>この仮説が無効になる条件<textarea required minLength={5} rows={2} placeholder="例：特定価格を終値で割った場合" value={draft.invalidation} onChange={(e) => patch('invalidation', e.target.value)} /></label>
              <div className="form-footer"><span>発注は行いません。保存後、AIに反証を依頼できます。</span><button className="primary" type="submit" disabled={busy}>Save &amp; challenge →</button></div>
            </form>
          </section>
        )}

        {page === 'court' && (
          <section className="panel">
            <div className="section-head">
              <div><span className="eyebrow">03 / ADVERSARIAL REVIEW</span><h2>AI Court</h2><p>AIサブスクを開き、生成したプロンプトを手動で貼り付けます。</p></div>
              <span className="tag">NO AI API KEYS</span>
            </div>
            {!selected ? <div className="empty">最初にScenario画面で仮説を保存してください。</div> : (
              <div className="court-grid">
                <div className="court-main">
                  <div className="case-summary">
                    <div className="case-title"><strong>{selected.symbol} · {selected.side}</strong><span>{selected.timeframe}</span></div>
                    <div className="case-prices"><span>ENTRY <strong>{price(selected.entry)}</strong></span><span>STOP <strong>{price(selected.stop)}</strong></span><span>TARGET <strong>{price(selected.target)}</strong></span></div>
                    <p>{selected.thesis}</p>
                    <div className="muted small">無効化条件: {selected.invalidation}</div>
                  </div>
                  <h3>AIに渡す反証プロンプト</h3>
                  <div className="role-switch">
                    <button className={role === 'BULL' ? 'selected' : ''} onClick={() => setRole('BULL')}>賛成側 / BULL</button>
                    <button className={role === 'BEAR' ? 'selected' : ''} onClick={() => setRole('BEAR')}>反対側 / BEAR</button>
                  </div>
                  <textarea className="prompt-preview" readOnly value={prompt} rows={12} aria-label="生成したAI審査プロンプト" />
                  <div className="prompt-controls">
                    <select aria-label="AIサービス" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
                      {Object.entries(aiProviders).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                    </select>
                    <button className="primary" type="button" onClick={() => void copyPrompt()}>プロンプトをコピー</button>
                    <a className="external-button" target="_blank" rel="noopener noreferrer" href={aiProviders[provider].url}>公式AIを開く ↗</a>
                  </div>
                  <p className="muted small">外部AIへの送信や回答取得は自動化しません。サブスクリプションはAPI利用権ではありません。</p>
                </div>
                <div className="review-panel">
                  <h3>回答を手動で保存</h3>
                  <form onSubmit={(e) => void saveReview(e)}>
                    <label>AIの回答<textarea required minLength={10} rows={8} placeholder="契約中のAIからの回答をコピーして貼り付ける..." value={reviewText} onChange={(e) => setReviewText(e.target.value)} /></label>
                    <button className="primary full" disabled={busy} type="submit">審査記録を保存</button>
                  </form>
                  <div className="divider" />
                  <h3>保存済みレビュー <span className="muted">{detail?.reviews.length ?? 0}</span></h3>
                  {detail?.reviews.length ? detail.reviews.map((review) => (
                    <article key={review.id} className="review-card">
                      <div><strong>{review.provider.toUpperCase()}</strong><span className={'side ' + (review.role === 'BULL' ? 'long' : 'short-side')}>{review.role}</span></div>
                      <p>{review.content}</p>
                      <small>{timestamp(review.createdAt)} · 手動貼付</small>
                    </article>
                  )) : <p className="muted small">まだ保存された回答はありません。</p>}
                </div>
              </div>
            )}
          </section>
        )}

        {page === 'journal' && (
          <section className="panel">
            <div className="section-head">
              <div><span className="eyebrow">04 / LEARN FROM THE RECORD</span><h2>Journal</h2><p>当初の仮説と、手動入力の仮想決済結果を比較します。</p></div>
              <span className="tag">PAPER ONLY</span>
            </div>
            {!selected ? <div className="empty">保存済みのシナリオを左の履歴から選択してください。</div> : (
              <div className="journal-layout">
                <div className="case-summary">
                  <span className="eyebrow">IMMUTABLE SNAPSHOT</span>
                  <h3>{selected.symbol} / {selected.side} / {selected.timeframe}</h3>
                  <p>{selected.thesis}</p>
                  <p className="muted">停止条件: {selected.invalidation}</p>
                  <div className="case-prices"><span>ENTRY <strong>{price(selected.entry)}</strong></span><span>STOP <strong>{price(selected.stop)}</strong></span><span>TARGET <strong>{price(selected.target)}</strong></span></div>
                  <small>記録日: {timestamp(selected.createdAt)}</small>
                </div>
                <div className="outcome-box">
                  <h3>仮想取引の終了を記録</h3>
                  {detail?.outcome ? (
                    <>
                      <div className="outcome-value"><span>記録したR倍率</span><strong className={detail.outcome.rMultiple >= 0 ? 'positive' : 'negative'}>{detail.outcome.rMultiple > 0 ? '+' : ''}{detail.outcome.rMultiple.toFixed(2)}R</strong></div>
                      <p>終了価格: {price(detail.outcome.exitPrice)}</p>
                      <p>{detail.outcome.note || 'メモなし'}</p>
                      <p className="muted small">手動入力 / {timestamp(detail.outcome.recordedAt)}。実際の約定・スプレッド・手数料は未検証です。</p>
                    </>
                  ) : (
                    <form onSubmit={(e) => void saveOutcome(e)}>
                      <label>仮想終了価格<input type="number" required step="any" min="0.001" placeholder="例: 151.400" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} /></label>
                      <label>結果の振り返り<textarea rows={5} placeholder="事前ルールに従えたか、想定外は何か..." value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} /></label>
                      <button className="primary full" type="submit" disabled={busy}>仮想結果を保存</button>
                      <p className="muted small">1シナリオにつき1回だけ保存できます。R倍率は値幅のみで算出します。</p>
                    </form>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="footer">TRADECOURT · LOCAL-FIRST PROTOTYPE <span>相場データ・AI回答・仮想取引は実績や投資助言ではありません。自動発注はありません。</span></footer>
      </main>
    </div>
  )
}
