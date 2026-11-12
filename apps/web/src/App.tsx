import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { JournalResponse, Scenario, ScenarioDetail } from '@tradecourt/core'
import { api } from './api'
import { getError, price, timestamp } from './format'
import { MarketPanel } from './panels/MarketPanel'
import { ScenarioPanel } from './panels/ScenarioPanel'
import { CourtPanel } from './panels/CourtPanel'
import { JournalPanel } from './panels/JournalPanel'

type Page = 'market' | 'scenario' | 'court' | 'journal'
const pages: { id: Page; label: string }[] = [
  { id: 'market', label: 'Market Lens' },
  { id: 'scenario', label: 'Scenario' },
  { id: 'court', label: 'AI Court' },
  { id: 'journal', label: 'Journal' },
]

// Route state lives in the URL hash (#/court/<scenarioId>) so a reload restores the same view.
function readHash(): { page: Page; id: string | null } {
  const [, rawPage, rawId] = window.location.hash.split('/')
  const page = pages.some((p) => p.id === rawPage) ? rawPage as Page : 'scenario'
  return { page, id: rawId ? decodeURIComponent(rawId) : null }
}
function writeHash(page: Page, id: string | null) {
  const next = `#/${page}${id ? '/' + encodeURIComponent(id) : ''}`
  if (window.location.hash !== next) window.history.replaceState(null, '', next)
}

export default function App() {
  const initial = readHash()
  const [page, setPage] = useState<Page>(initial.page)
  const [selectedId, setSelectedId] = useState<string | null>(initial.id)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [detail, setDetail] = useState<ScenarioDetail | null>(null)
  const [journal, setJournal] = useState<JournalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [ready, setReady] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const showError = useCallback((text: string) => { setNotice(''); setError(text) }, [])
  const showNotice = useCallback((text: string) => { setError(''); setNotice(text) }, [])

  const selectedIdRef = useRef(selectedId)
  useEffect(() => { selectedIdRef.current = selectedId; writeHash(page, selectedId) }, [page, selectedId])

  const refreshLists = useCallback(async () => {
    const [list, j] = await Promise.all([api.list(), api.journal()])
    setScenarios(list.scenarios)
    setJournal(j)
    return list.scenarios
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      setDetail(await api.detail(id))
    } catch (e) {
      setDetail(null)
      showError(getError(e))
    } finally { setDetailLoading(false) }
  }, [showError])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const health = await api.health().catch((e: unknown) => {
          throw new Error(getError(e) + '。未初期化なら pnpm db:migrate:local を実行してください。')
        })
        if (!mounted) return
        setReady(health.status === 'ok')
        const list = await refreshLists()
        if (!mounted) return
        const id = initial.id && list.some((s) => s.id === initial.id) ? initial.id : list[0]?.id ?? null
        if (initial.id && id !== initial.id) showError('URLのシナリオが見つかりません。最新のシナリオを表示します。')
        setSelectedId(id)
        if (id) await loadDetail(id)
      } catch (e) {
        if (mounted) { setReady(false); showError(getError(e)) }
      } finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow manual URL edits / back-forward between screens.
  useEffect(() => {
    const onHash = () => {
      const next = readHash()
      setPage(next.page)
      if (next.id && next.id !== selectedIdRef.current) {
        setSelectedId(next.id)
        void loadDetail(next.id)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [loadDetail])

  async function openScenario(id: string, nextPage: Page = 'court') {
    setSelectedId(id)
    setPage(nextPage)
    setError('')
    await loadDetail(id)
  }

  async function afterWrite() {
    if (selectedId) await loadDetail(selectedId)
    await refreshLists().catch((e: unknown) => showError(getError(e)))
  }

  const selected = detail?.scenario
  // Show a loading state only while switching scenarios; refreshing the same scenario after a
  // write keeps the current view mounted (no flash, no scroll jump on phones).
  const switching = detailLoading && detail?.scenario.id !== selectedId

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">TC</span><div><strong>TradeCourt</strong><span>DECISION REVIEW · LOCAL</span></div></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav" aria-label="画面">
          {pages.map((p, i) => (
            <button key={p.id} type="button" aria-current={page === p.id ? 'page' : undefined} className={page === p.id ? 'active' : ''} onClick={() => { setPage(p.id); setError('') }}>
              <span>0{i + 1}</span> {p.label}
            </button>
          ))}
        </nav>
        <div className="nav-label history-label">SCENARIO HISTORY</div>
        <div className="history">
          {loading ? <p className="muted small">読み込み中…</p> : scenarios.length === 0 && <p className="muted small">まだシナリオがありません</p>}
          {scenarios.map((s) => (
            <button key={s.id} type="button" className={'history-item ' + (selectedId === s.id ? 'selected' : '')} onClick={() => void openScenario(s.id, page === 'journal' ? 'journal' : 'court')}>
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
          <div className="top-status" data-testid="api-status"><span className={'status-dot ' + (ready ? 'on' : '')} />{ready === null ? 'CONNECTING…' : ready ? 'LOCAL D1 READY' : 'CHECK API SETUP'}</div>
        </header>

        <div className="hero-stats">
          <div><span>Saved scenarios</span><strong>{loading ? '…' : scenarios.length}</strong></div>
          <div><span>Selected R:R</span><strong>{selected ? '1 : ' + selected.riskReward.toFixed(2) : '—'}</strong></div>
          <div><span>AI review records</span><strong>{detail ? detail.reviews.length : '—'}</strong></div>
          <div><span>Execution</span><strong className="negative">DISABLED</strong></div>
        </div>

        {error && <div role="alert" className="alert error"><strong>確認が必要です</strong><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="閉じる">×</button></div>}
        {notice && <div role="status" className="alert success"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="閉じる">×</button></div>}

        {(page === 'court' || page === 'journal') && scenarios.length > 0 && (
          <label className="scenario-picker mobile-only">
            対象シナリオ
            <select data-testid="mobile-scenario-picker" value={selectedId ?? ''} onChange={(e) => void openScenario(e.currentTarget.value, page)}>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.side} {s.timeframe} · {price(s.entry)}→{price(s.target)} · {timestamp(s.createdAt)}</option>
              ))}
            </select>
          </label>
        )}

        {page === 'market' && <MarketPanel />}
        {page === 'scenario' && (
          <ScenarioPanel
            scenarios={scenarios}
            loading={loading}
            onError={showError}
            onOpen={(id) => void openScenario(id)}
            onCreated={(scenario) => {
              setScenarios((items) => [scenario, ...items.filter((s) => s.id !== scenario.id)])
              void openScenario(scenario.id).then(() => refreshLists())
              showNotice('シナリオを保存しました。AI Courtで反証を依頼できます。')
            }}
          />
        )}
        {page === 'court' && (
          <CourtPanel detail={detail} loading={loading || switching} onSaved={afterWrite} onError={showError} onNotice={showNotice} />
        )}
        {page === 'journal' && (
          <JournalPanel
            key={selectedId ?? 'none'}
            detail={detail}
            entries={journal?.entries ?? []}
            summary={journal?.summary ?? null}
            scorecard={journal?.scorecard ?? null}
            loading={loading || switching}
            onSaved={afterWrite}
            onOpen={(id) => void openScenario(id, 'journal')}
            onError={showError}
            onNotice={showNotice}
          />
        )}

        <footer className="footer">TRADECOURT · LOCAL-FIRST MVP <span>相場データ・AI回答・仮想取引は実績や投資助言ではありません。自動発注・ブローカー連携はありません。</span></footer>
      </main>
    </div>
  )
}
