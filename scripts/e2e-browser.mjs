#!/usr/bin/env node
// TradeCourt browser E2E (Playwright, Chromium). SYNTHETIC data only.
//
// Default: starts an ISOLATED stack (temporary local D1 via --persist-to, API :8798, web :5183),
// so your own local journal is never touched, then deletes the temp state.
// Set TRADECOURT_E2E_BASE_URL=http://127.0.0.1:5173 to run against an already running `pnpm dev`
// instead (synthetic records will then remain in your local D1).
//
// Every non-loopback request is blocked and recorded; the run FAILS if any is attempted.
// External AI sites are never opened, logged into or automated: only link attributes are checked.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, process.env.TRADECOURT_E2E_OUT ?? 'test-results/e2e')
mkdirSync(outDir, { recursive: true })
const LOOPBACK = /^(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/
const children = []
let tempState = null

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  child.getLog = () => log
  return child
}
function exec(cmd, args, opts) {
  return new Promise((ok, fail) => {
    const child = run(cmd, args, { ...opts, detached: false })
    child.on('exit', (code) => (code === 0 ? ok(child.getLog()) : fail(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${child.getLog()}`))))
  })
}
async function waitFor(url, ms = 60_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}
function cleanup() {
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM') } catch { /* gone */ } }
  if (tempState) rmSync(tempState, { recursive: true, force: true })
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })

async function startIsolatedStack() {
  tempState = mkdtempSync(join(tmpdir(), 'tradecourt-e2e-'))
  const apiDir = join(root, 'apps/api')
  const wrangler = join(apiDir, 'node_modules/.bin/wrangler')
  await exec(wrangler, ['d1', 'migrations', 'apply', 'trade-court-local', '--local', '--persist-to', tempState], { cwd: apiDir, env: { ...process.env, CI: '1' } })
  // QUOTE_PROVIDER=synthetic: the 現在値を取得 button returns a labelled fixed value with no network.
  const api = run(wrangler, ['dev', '--local', '--port', '8798', '--ip', '127.0.0.1', '--persist-to', tempState, '--inspector-port', '0', '--var', 'QUOTE_PROVIDER:synthetic'], { cwd: apiDir })
  children.push(api)
  await waitFor('http://127.0.0.1:8798/api/health').catch((e) => { throw new Error(e.message + '\n' + api.getLog()) })
  const webDir = join(root, 'apps/web')
  const web = run(join(webDir, 'node_modules/.bin/vite'), [], {
    cwd: webDir, env: { ...process.env, TRADECOURT_API_ORIGIN: 'http://127.0.0.1:8798', TRADECOURT_WEB_PORT: '5183' },
  })
  children.push(web)
  await waitFor('http://127.0.0.1:5183/api/health').catch((e) => { throw new Error(e.message + '\n' + web.getLog()) })
  return 'http://127.0.0.1:5183'
}

// ---- Synthetic fixtures (clearly NOT real market data) ---------------------------------------
const validCsv = ['date,open,high,low,close',
  '2026-01-05,150.00,150.80,149.70,150.50',
  '2026-01-06,150.50,151.20,150.10,151.00',
  '2026-01-07,151.00,151.10,149.50,149.90',
  '2026-01-08,149.90,150.60,149.80,150.40'].join('\n')
const badCsv = 'date,open,high,low,close\n2026-01-05,150,149,148,150\n2026-01-06,150,151,149,150'
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'

const steps = []
let failureShot = null // set once a page exists; captures the screen when a step fails
async function step(name, fn) {
  const started = Date.now()
  try {
    await fn()
    steps.push({ name, status: 'PASS', ms: Date.now() - started })
    console.log(`PASS  ${name}`)
  } catch (e) {
    steps.push({ name, status: 'FAIL', ms: Date.now() - started, error: e.message })
    await failureShot?.().catch(() => undefined)
    console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`)
    throw e
  }
}

async function main() {
  const external = process.env.TRADECOURT_E2E_BASE_URL
  if (external && !LOOPBACK.test(external)) throw new Error('TRADECOURT_E2E_BASE_URL must be loopback')
  const base = external ?? await startIsolatedStack()
  // Scorecard totals are global; exact values are only asserted on the clean isolated database.
  const isolated = !external
  console.log(`TradeCourt browser E2E against ${base} (${external ? 'existing dev server' : 'isolated temp D1'})`)

  const browser = await chromium.launch()
  const blocked = []
  const newContext = async (opts = {}) => {
    // Japanese browser locale by default (most assertions use the Japanese UI); the i18n step overrides it.
    const ctx = await browser.newContext({ deviceScaleFactor: 1, locale: 'ja-JP', ...opts })
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    await ctx.route('**/*', (route) => {
      const url = route.request().url()
      if (LOOPBACK.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
      blocked.push(url)
      return route.abort('blockedbyclient')
    })
    return ctx
  }
  const ctx = await newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  const dialogs = []
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss() })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })
  failureShot = () => shot('FAILED-step')
  const nav = (label) => page.getByRole('navigation', { name: '画面' }).getByRole('button', { name: label }).click()
  const apiJson = (path, init) => page.evaluate(async ([p, i]) => {
    const r = await fetch(p, i); return { status: r.status, body: await r.json() }
  }, [path, init])
  const thesis = `Synthetic E2E thesis ${Date.now()}: hypothetical pullback, not real data`
  let scenarioId = ''

  try {
    await step('1. App starts and API/D1 is ready', async () => {
      await page.goto(base)
      await page.getByTestId('api-status').getByText('LOCAL D1 READY').waitFor()
      assert.equal(await page.title(), 'TradeCourt — Decision Review')
    })

    await step('2. Market: invalid and oversized CSV are rejected safely', async () => {
      await nav('Market Lens')
      await page.getByRole('heading', { name: /Market Lens/ }).waitFor()
      await page.getByTestId('csv-input').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(badCsv) })
      await page.getByRole('alert').getByText(/2行目の値が不正/).waitFor()
      await page.getByTestId('csv-input').setInputFiles({ name: 'huge.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 'a') })
      await page.getByRole('alert').getByText(/2MB以下/).waitFor()
      assert.equal(await page.getByTestId('csv-preview').count(), 0)
    })

    await step('2b. Market: valid synthetic OHLC CSV imports with chart, high/low/change and provenance', async () => {
      await page.getByTestId('csv-input').setInputFiles({ name: 'synthetic-usdjpy.csv', mimeType: 'text/csv', buffer: Buffer.from(validCsv) })
      await page.getByTestId('csv-preview').waitFor()
      // Timezone of the CSV timestamps is a required, explicit choice.
      await page.getByRole('button', { name: 'ローカルD1に保存' }).click()
      await page.getByRole('alert').getByText(/タイムゾーンを選択/).waitFor()
      await page.getByTestId('tz-select').selectOption('+09:00')
      await page.getByRole('button', { name: 'ローカルD1に保存' }).click()
      const active = page.getByTestId('active-dataset')
      await active.waitFor()
      assert.equal(await active.getByTestId('stat-high').innerText(), '151.200')
      assert.equal(await active.getByTestId('stat-low').innerText(), '149.500')
      assert.equal(await active.getByTestId('stat-change').innerText(), '-0.07%')
      assert.match(await active.getByTestId('dataset-source').innerText(), /synthetic-usdjpy\.csv/)
      assert.match(await active.getByTestId('dataset-tz').innerText(), /UTC\+09:00/)
      assert.equal(await active.getByTestId('close-chart').locator('polyline').count(), 1)
      assert.match(await page.locator('.panel').innerText(), /2026-01-05 → 2026-01-08/)
      await shot('01-market')
    })

    await step('3-4. Scenario: R:R is auto-calculated, direction errors shown, save persists', async () => {
      await nav('Scenario')
      const form = page.getByRole('form', { name: 'シナリオ登録' })
      // Entry defaults to the latest imported CSV close (no network), with its source shown.
      await page.getByTestId('entry-source').getByText(/初期値: 取込CSV/).waitFor()
      if (isolated) {
        assert.equal(await form.locator('input[name=entry]').inputValue(), '150.4')
        assert.match(await page.getByTestId('entry-source').innerText(), /synthetic-usdjpy\.csv」の 2026-01-08 終値（現在値ではありません）/)
        // Optional quote only on click (synthetic provider in the isolated stack: no network).
        await page.getByTestId('fetch-quote').click()
        await page.getByTestId('entry-source').getByText(/SYNTHETIC TEST QUOTE/).waitFor()
        assert.equal(await form.locator('input[name=entry]').inputValue(), '150.123')
      } else {
        assert.notEqual(await form.locator('input[name=entry]').inputValue(), '')
        await page.getByTestId('fetch-quote').waitFor() // present; not clicked against a real provider
      }
      await form.locator('input[name=entry]').fill('150.2')
      await form.locator('input[name=stop]').fill('151')
      await form.locator('input[name=target]').fill('151.4')
      await page.getByTestId('rr-preview').getByText('方向が不正').waitFor()
      await form.locator('input[name=stop]').fill('149.6')
      await page.getByTestId('rr-preview').getByText('1 : 2.00').waitFor()
      await form.locator('textarea[name=thesis]').fill(thesis)
      await form.locator('textarea[name=invalidation]').fill('Synthetic: 4h close below 149.600')
      const before = (await apiJson('/api/scenarios')).body.scenarios.length
      await form.getByRole('button', { name: /Save/ }).dblclick() // double submit must not duplicate
      await page.getByRole('status').getByText('シナリオを保存しました').waitFor()
      await page.getByRole('heading', { name: 'AI Court' }).waitFor()
      const after = (await apiJson('/api/scenarios')).body.scenarios
      assert.equal(after.length, before + 1, 'double click created duplicate scenarios')
      scenarioId = after.find((s) => s.thesis === thesis).id
      assert.ok(page.url().includes(`#/court/${scenarioId}`))
    })

    await step('5-6. AI Court: BULL/BEAR prompts generated from saved scenario and copied to clipboard', async () => {
      const prompt = page.getByTestId('prompt')
      assert.match(await prompt.inputValue(), /役割: 反対側/)
      assert.match(await prompt.inputValue(), new RegExp(thesis.slice(0, 30)))
      await page.getByRole('button', { name: 'プロンプトをコピー' }).click()
      await page.getByRole('button', { name: 'コピー済み ✓' }).waitFor()
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await prompt.inputValue())
      await page.getByRole('button', { name: '賛成側 / BULL' }).click()
      assert.match(await prompt.inputValue(), /役割: 賛成側/)
      await page.getByRole('button', { name: 'プロンプトをコピー' }).click()
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      assert.match(clip, /役割: 賛成側/)
      assert.match(clip, /リスクリワード: 1:2/)
    })

    await step('7. AI Court: official AI links (not opened, not automated)', async () => {
      const expected = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new', gemini: 'https://gemini.google.com/app', grok: 'https://grok.com/' }
      const select = page.getByRole('combobox', { name: '質問するAIサービス' })
      for (const [value, href] of Object.entries(expected)) {
        await select.selectOption(value)
        const link = page.getByTestId('open-ai')
        assert.equal(await link.getAttribute('href'), href)
        assert.equal(await link.getAttribute('target'), '_blank')
        assert.equal(await link.getAttribute('rel'), 'noopener noreferrer')
      }
    })

    await step('8-9. Synthetic AI answers pasted manually, stored with provider/role/time, compared side by side; HTML not executed', async () => {
      const form = page.getByRole('form', { name: 'AI回答の保存' })
      await form.getByRole('combobox', { name: '回答したAIサービス' }).selectOption('claude')
      await form.getByRole('combobox', { name: '役割' }).selectOption('BULL')
      await form.locator('textarea[name=review]').fill('【合成テスト回答 / SYNTHETIC】賛成側: 押し目の仮説は条件付きで成立し得る。')
      await form.getByRole('button', { name: '審査記録を保存' }).click()
      await page.getByRole('status').getByText(/ClaudeのBULL回答/).waitFor()
      await form.getByRole('combobox', { name: '回答したAIサービス' }).selectOption('chatgpt')
      await form.getByRole('combobox', { name: '役割' }).selectOption('BEAR')
      await form.locator('textarea[name=review]').fill(`【合成テスト回答 / SYNTHETIC】反対側: 指標前の逆行リスク。${XSS}`)
      await form.getByRole('button', { name: '審査記録を保存' }).click()
      await page.getByRole('status').getByText(/ChatGPTのBEAR回答/).waitFor()
      const compare = page.getByTestId('review-compare')
      await compare.getByTestId('review-card').nth(1).waitFor()
      const [bullCol, bearCol] = [compare.locator('> div').nth(0), compare.locator('> div').nth(1)]
      assert.equal(await bullCol.getByTestId('review-card').count(), 1)
      assert.equal(await bearCol.getByTestId('review-card').count(), 1)
      assert.match(await bullCol.innerText(), /Claude[\s\S]*回答日時/)
      assert.match(await bearCol.innerText(), /ChatGPT/)
      assert.ok((await bearCol.innerText()).includes('<script>window.__xss=2</script>'), 'HTML should render as literal text')
      assert.equal(await page.evaluate(() => window.__xss), undefined, 'pasted HTML executed!')
      assert.equal(await compare.locator('img, script').count(), 0)
      await shot('02-ai-court')
    })

    await step('10-11. Journal: paper exit recorded, R multiple shown, plan vs decision compared', async () => {
      await nav('Journal')
      await page.getByTestId('grading-locked').waitFor() // grading only after a paper outcome exists
      const form = page.getByRole('form', { name: '仮想結果の記録' })
      await form.locator('input[name=exitPrice]').fill('151.4')
      await page.getByTestId('r-preview').getByText('+2.00R').waitFor()
      await form.getByRole('combobox', { name: '終了理由' }).selectOption('TARGET')
      await form.locator('textarea[name=note]').fill('Synthetic reflection: followed the plan; BEAR risk did not materialize.')
      await form.getByRole('button', { name: '仮想結果を保存' }).click()
      const result = page.getByTestId('outcome-result')
      await result.waitFor()
      assert.equal(await result.getByTestId('r-multiple').innerText(), '+2.00R')
      assert.match(await result.innerText(), /利確価格どおり/)
      assert.match(await result.innerText(), /従った/)
      assert.equal(await page.getByTestId('journal-reviews').locator('li').count(), 2)
      assert.match(await page.getByTestId('journal-table').innerText(), /\+2\.00R/)
      await shot('03-journal')
    })

    await step('14-15. 答え合わせ: grade each AI review against the paper outcome, scorecard updates, re-grade allowed', async () => {
      const grading = page.getByTestId('review-grading')
      const cards = grading.getByTestId('grade-card')
      assert.equal(await cards.count(), 2)
      const claude = grading.getByRole('article', { name: /Claude BULL/ })
      const gpt = grading.getByRole('article', { name: /ChatGPT BEAR/ })
      // +2R paper win: suggestion is BULL=HIT, BEAR=MISS (pre-selected but not saved).
      assert.equal(await claude.getByRole('button', { name: /的中/ }).getAttribute('aria-pressed'), 'true')
      assert.equal(await gpt.getByRole('button', { name: /外れ/ }).getAttribute('aria-pressed'), 'true')
      assert.equal(await claude.getByText('未採点').count(), 1)
      await claude.getByLabel('メモ（任意）').fill('Synthetic: pullback thesis held')
      await claude.getByRole('button', { name: '採点を保存' }).click()
      await page.getByRole('status').getByText(/ClaudeのBULLレビューを「的中」/).waitFor()
      const gpt2 = page.getByTestId('review-grading').getByRole('article', { name: /ChatGPT BEAR/ })
      await gpt2.getByRole('button', { name: /判定不能/ }).click()
      await gpt2.getByRole('button', { name: '採点を保存' }).click()
      await page.getByRole('status').getByText(/ChatGPTのBEARレビューを「判定不能」/).waitFor()
      await page.getByTestId('grading-progress').getByText('採点済み 2 / 2').waitFor()
      const card = page.getByTestId('scorecard')
      if (isolated) {
        assert.equal(await card.getByTestId('overall-hit-rate').innerText(), '100%') // UNCLEAR excluded
        assert.equal(await card.getByTestId('awaiting-grade').innerText(), '0')
      }
      // Re-grade ChatGPT BEAR as MISS.
      const gpt3 = page.getByTestId('review-grading').getByRole('article', { name: /ChatGPT BEAR/ })
      await gpt3.getByRole('button', { name: /外れ/ }).click()
      await gpt3.getByRole('button', { name: '採点を更新' }).click()
      await page.getByRole('status').getByText(/「外れ」/).waitFor()
      if (isolated) {
        await card.getByTestId('overall-hit-rate').getByText('50%').waitFor()
        assert.match(await card.getByTestId('scorecard-table').innerText(), /ChatGPT[\s\S]*BEAR[\s\S]*0%/)
      }
      assert.match(await page.getByTestId('journal-table').innerText(), /2\/2/)
      // The outcome is unaffected by grading.
      assert.equal(await page.getByTestId('r-multiple').innerText(), '+2.00R')
      await nav('AI Court')
      const badges = page.getByTestId('review-compare').getByTestId('verdict-badge')
      assert.deepEqual((await badges.allInnerTexts()).sort(), ['的中', '外れ'].sort())
      await nav('Journal')
      await shot('04-grading')
    })

    await step('Error paths via API: duplicate outcome 409, invalid stop 400, missing id 404, malformed 400, cross-origin 403', async () => {
      const post = (path, body, headers = {}) => apiJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
      assert.equal((await post(`/api/scenarios/${scenarioId}/paper-outcome`, JSON.stringify({ exitPrice: 149.6 }))).status, 409)
      assert.equal((await post('/api/scenarios', JSON.stringify({ symbol: 'USDJPY', timeframe: '4h', side: 'LONG', entry: 150, stop: 151, target: 152, thesis: 'Synthetic invalid stop', invalidation: 'none!' }))).status, 400)
      assert.equal((await post('/api/scenarios', JSON.stringify({ symbol: 'USDJPY' }))).status, 400)
      assert.equal((await apiJson('/api/scenarios/does-not-exist')).status, 404)
      assert.equal((await post('/api/scenarios', '{not json')).status, 400)
      const res = await fetch(`${base}/api/scenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })
      assert.equal(res.status, 403)
      const fresh = (await post('/api/scenarios', JSON.stringify({ symbol: 'USDJPY', timeframe: '1h', side: 'LONG', entry: 150, stop: 149.5, target: 151, thesis: 'Synthetic E2E: ungraded scenario', invalidation: 'Synthetic only' }))).body.scenario
      const rv = (await post(`/api/scenarios/${fresh.id}/reviews`, JSON.stringify({ provider: 'gemini', role: 'BULL', content: 'Synthetic pasted review text' }))).body.review
      const put = (body) => apiJson(`/api/scenarios/${fresh.id}/reviews/${rv.id}/grade`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      assert.equal((await put(JSON.stringify({ verdict: 'HIT' }))).status, 409, 'grading before outcome must be refused')
      await post(`/api/scenarios/${fresh.id}/paper-outcome`, JSON.stringify({ exitPrice: 150.5 }))
      assert.equal((await put(JSON.stringify({ verdict: 'WIN' }))).status, 400)
      assert.equal((await apiJson(`/api/scenarios/${scenarioId}/reviews/${rv.id}/grade`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: 'HIT' }) })).status, 404)
    })

    await step('12-13. Reload: all data persists (market, scenario, reviews, outcome, grades, route)', async () => {
      await page.reload()
      await page.getByTestId('api-status').getByText('LOCAL D1 READY').waitFor()
      assert.ok(page.url().includes(`#/journal/${scenarioId}`))
      assert.equal(await page.getByTestId('outcome-result').getByTestId('r-multiple').innerText(), '+2.00R')
      await page.getByTestId('grading-progress').getByText('採点済み 2 / 2').waitFor()
      assert.deepEqual((await page.getByTestId('review-grading').getByTestId('verdict-badge').allInnerTexts()).sort(), ['的中', '外れ'].sort())
      if (isolated) await page.getByTestId('scorecard').getByTestId('overall-hit-rate').getByText('50%').waitFor()
      await nav('AI Court')
      await page.getByTestId('review-compare').getByTestId('review-card').nth(1).waitFor()
      assert.equal(await page.getByTestId('review-card').count(), 2)
      await nav('Scenario')
      assert.match(await page.getByTestId('scenario-table').innerText(), new RegExp(thesis.slice(0, 30)))
      await nav('Market Lens')
      assert.match(await page.getByTestId('dataset-source').innerText(), /synthetic-usdjpy\.csv/)
    })

    await step('16-17. Link a scenario to an imported candle, then check which level the CSV touched first', async () => {
      // Unlinked scenarios explain why no path check is possible.
      await page.goto(`${base}/#/journal/${scenarioId}`)
      await page.reload()
      await page.getByTestId('path-check-unlinked').waitFor()

      await nav('Scenario')
      const form = page.getByRole('form', { name: 'シナリオ登録' })
      const datasets = (await apiJson('/api/market/datasets')).body.datasets
      const ds = datasets.find((d) => d.sourceName === 'synthetic-usdjpy.csv')
      await form.locator('select[name=datasetId]').selectOption(ds.id)
      await form.locator('select[name=asOfDate]').selectOption('2026-01-06')
      assert.equal(await page.getByTestId('as-of-close').innerText(), '151.000')
      await form.getByRole('button', { name: 'Entryに使う' }).click()
      assert.equal(await form.locator('input[name=entry]').inputValue(), '151')
      await form.locator('input[name=stop]').fill('149.6')
      await form.locator('input[name=target]').fill('152.4')
      await page.getByTestId('rr-preview').getByText('1 : 1.00').waitFor()
      assert.equal(await page.getByTestId('link-chart').locator('line.level').count(), 3)
      await form.locator('textarea[name=thesis]').fill('Synthetic E2E linked thesis: hypothetical breakout after 2026-01-06')
      await form.locator('textarea[name=invalidation]').fill('Synthetic close below 149.6')
      await form.getByRole('button', { name: /Save/ }).click()
      await page.getByRole('status').getByText('シナリオを保存しました').waitFor()
      await page.getByTestId('court-as-of').getByText(/2026-01-06/).waitFor()
      assert.match(await page.getByTestId('prompt').inputValue(), /仮説時点: 2026-01-06/)
      const linkedId = page.url().split('/').pop()
      const detail = (await apiJson(`/api/scenarios/${linkedId}`)).body
      // 2026-01-06 00:00 JST + 1 day = 2026-01-06T15:00Z (as-of close).
      assert.deepEqual(detail.scenario.marketRef, { datasetId: ds.id, asOfDate: '2026-01-06', asOfAt: '2026-01-06T15:00:00.000Z' })

      await nav('Journal')
      const result = page.getByTestId('path-result')
      await result.waitFor()
      // Next candle 2026-01-07 has low 149.5 <= stop 149.6 and high 151.1 < target 152.4.
      assert.equal(await result.getByTestId('path-outcome').innerText(), '損切りに先に到達')
      assert.equal(await result.getByTestId('path-r').innerText(), '-1.00R')
      assert.match(await result.innerText(), /判定足 2026-01-07（1本目）/)
      const chart = page.getByTestId('path-chart')
      assert.equal(await chart.locator('line.level').count(), 3)
      assert.equal(await chart.getByTestId('as-of-marker').count(), 1)
      assert.equal(await chart.getByTestId('decided-marker').count(), 1)
      // Each candle's high-low range is drawn, so the 149.5 low that touched the stop is visible.
      assert.equal(await chart.locator('line.range').count(), 4)
      // Record a paper exit that contradicts the CSV path: exitReason TARGET at 150.5.
      const outcomeForm = page.getByRole('form', { name: '仮想結果の記録' })
      await outcomeForm.locator('input[name=exitPrice]').fill('150.5')
      await outcomeForm.getByRole('combobox', { name: '終了理由' }).selectOption('TARGET')
      await outcomeForm.getByRole('button', { name: '仮想結果を保存' }).click()
      const compare = page.getByTestId('path-compare')
      await compare.waitFor()
      assert.match(await compare.innerText(), /あなたの仮想結果\s*-0\.36R/)
      assert.match(await compare.innerText(), /差\s*\+0\.64R/)
      await compare.getByTestId('path-mismatch').waitFor()
      await shot('05-path-check')
      // Persisted link survives reload; the check is recomputed identically.
      await page.reload()
      assert.equal(await page.getByTestId('path-result').getByTestId('path-outcome').innerText(), '損切りに先に到達')
    })

    await step('18-19. Path-based grading suggestion, Insights aggregation and CSV/JSON export', async () => {
      const post = (path, body) => apiJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const ds = (await apiJson('/api/market/datasets')).body.datasets.find((d) => d.sourceName === 'synthetic-usdjpy.csv')
      // Synthetic: paper exit +0.14R (above entry) but the CSV hit the stop first; rule deviation.
      const sc = (await post('/api/scenarios', { symbol: 'USDJPY', timeframe: '1d', side: 'LONG', entry: 151, stop: 149.6, target: 152.4, thesis: 'Synthetic E2E: paper result and CSV path disagree', invalidation: 'Synthetic only', marketRef: { datasetId: ds.id, asOfDate: '2026-01-06' } })).body.scenario
      await post(`/api/scenarios/${sc.id}/reviews`, { provider: 'gemini', role: 'BULL', content: 'Synthetic BULL answer for the disagreement case' })
      await post(`/api/scenarios/${sc.id}/paper-outcome`, { exitPrice: 151.2, exitReason: 'MANUAL', followedPlan: false })
      await page.goto(`${base}/#/journal/${sc.id}`)
      await page.reload()
      await page.getByTestId('path-result').getByText('損切りに先に到達').waitFor()
      const card = page.getByTestId('review-grading').getByRole('article', { name: /Gemini BULL/ })
      const miss = card.getByRole('button', { name: /外れ/ })
      await miss.getByText('値動きより').waitFor()
      assert.equal(await miss.getAttribute('aria-pressed'), 'true', 'path-based suggestion should be preselected')
      assert.match(await card.getByRole('button', { name: /的中/ }).innerText(), /結果より/)

      await nav('Insights')
      const ins = page.getByTestId('insights')
      await ins.waitFor()
      await page.getByTestId('equity-chart').waitFor()
      if (isolated) {
        // Closed: +2 (s1), +1 (fresh), -0.357 (linked), +0.143 (this one; deviated).
        assert.equal(await page.getByTestId('ins-average').innerText(), '+0.70R')
        assert.equal(await page.getByTestId('ins-winrate').innerText(), '75%')
        assert.equal(await page.getByTestId('ins-drawdown').innerText(), '-0.36R')
        assert.equal(await page.getByTestId('ins-gap').innerText(), '+0.89R')
        assert.match(await page.getByTestId('ins-saved').innerText(), /2回[\s\S]*\+1\.79R 軽減/)
        assert.match(await page.getByTestId('ins-plan-note').innerText(), /破った回は、守った回より平均 -0\.74R/)
        await page.getByRole('button', { name: '直近10件' }).click()
        await page.getByTestId('ins-average').getByText('+0.70R').waitFor()
      }
      await shot('06-insights')

      const download = async (testId) => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()])
        return { name: dl.suggestedFilename(), bytes: readFileSync(await dl.path()) }
      }
      const csv = await download('export-csv')
      assert.match(csv.name, /^tradecourt-export-.*\.csv$/)
      assert.deepEqual([...csv.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
      const lines = csv.bytes.toString('utf8').slice(1).trim().split('\r\n')
      assert.ok(lines[0].startsWith('scenario_id,created_at,symbol'))
      if (isolated) assert.equal(lines.length, 1 + 4)
      assert.ok(csv.bytes.toString('utf8').includes('paper (user-entered, not broker fills)'))
      const json = JSON.parse((await download('export-json')).bytes.toString('utf8'))
      assert.equal(json.kind, 'paper')
      if (isolated) assert.equal(json.scenarios.length, 4)
    })

    await step('20-21. Auto-drafted levels from the CSV, R-multiple target buttons and one-tap paper outcome', async () => {
      await page.goto(`${base}/#/scenario`)
      await page.reload()
      const form = page.getByRole('form', { name: 'シナリオ登録' })
      const ds = (await apiJson('/api/market/datasets')).body.datasets.find((d) => d.sourceName === 'synthetic-usdjpy.csv')
      await form.locator('select[name=datasetId]').selectOption(ds.id)
      await page.getByTestId('as-of-close').getByText('150.400').waitFor() // default as-of = latest candle 2026-01-08
      const levels = page.getByTestId('draft-levels')
      // LONG (user's choice): stop = 20-candle low 149.5 - 0.02, target = 2R.
      assert.equal(await levels.innerText(), 'Entry 150.400 / Stop 149.480 / Target 152.240')
      await page.getByRole('group', { name: '利確の倍率' }).getByRole('button', { name: '3R' }).click()
      assert.match(await levels.innerText(), /Target 153\.160/)
      await page.getByRole('group', { name: '損切りの決め方' }).getByRole('button', { name: 'ATR×1.5' }).click()
      await page.getByTestId('draft-unavailable').getByText(/15本以上/).waitFor() // only 4 synthetic candles
      await page.getByRole('group', { name: '損切りの決め方' }).getByRole('button', { name: /安値の外/ }).click()
      await page.getByRole('button', { name: '下書きを入力' }).click()
      assert.equal(await form.locator('input[name=entry]').inputValue(), '150.4')
      assert.equal(await form.locator('input[name=stop]').inputValue(), '149.48')
      assert.equal(await form.locator('input[name=target]').inputValue(), '153.16')
      assert.match(await form.locator('textarea[name=thesis]').inputValue(), /^【自動下書き・要編集】1d足 2026-01-08 の終値 150\.4/)
      assert.equal(await form.locator('textarea[name=invalidation]').inputValue(), '149.48 を下回ったら仮説は無効')
      await page.getByTestId('rr-preview').getByText('1 : 3.00').waitFor()
      // R buttons work from Entry/Stop alone.
      await page.getByTestId('r-presets').getByRole('button', { name: '2R', exact: true }).click()
      assert.equal(await form.locator('input[name=target]').inputValue(), '152.24')
      await page.getByTestId('rr-preview').getByText('1 : 2.00').waitFor()
      await form.getByRole('button', { name: /Save/ }).click()
      await page.getByRole('status').getByText('シナリオを保存しました').waitFor()
      await shot('07-auto-draft-saved')

      // One-tap outcome: choose, cancel, choose again, confirm.
      await nav('Journal')
      const quick = page.getByTestId('quick-record')
      await quick.getByRole('button', { name: /利確で終了/ }).click()
      await page.getByTestId('quick-confirm').getByText(/152\.240（\+2\.00R）で記録します/).waitFor()
      await page.getByRole('button', { name: 'やめる' }).click()
      assert.equal(await page.getByTestId('quick-confirm').count(), 0)
      await quick.getByRole('button', { name: /利確で終了/ }).click()
      await page.getByRole('button', { name: 'この内容で記録' }).click()
      await page.getByRole('status').getByText(/「利確で終了」として仮想結果を記録しました/).waitFor()
      assert.equal(await page.getByTestId('outcome-result').getByTestId('r-multiple').innerText(), '+2.00R')
      assert.match(await page.getByTestId('outcome-result').innerText(), /利確価格に到達/)

      // Phone, touch: the button matching the CSV path is marked; record by two taps.
      const post = (path, body) => apiJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const sc = (await post('/api/scenarios', { symbol: 'USDJPY', timeframe: '1d', side: 'LONG', entry: 151, stop: 149.6, target: 152.4, thesis: 'Synthetic E2E: one-tap on a phone', invalidation: 'Synthetic only', marketRef: { datasetId: ds.id, asOfDate: '2026-01-06' } })).body.scenario
      const mctx = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const m = await mctx.newPage()
      await m.goto(`${base}/#/journal/${sc.id}`)
      await m.getByTestId('path-result').getByText('損切りに先に到達').waitFor()
      const stopBtn = m.getByTestId('quick-record').getByRole('button', { name: /損切りで終了/ })
      await stopBtn.getByTestId('quick-path-badge').waitFor()
      const box = await stopBtn.boundingBox()
      assert.ok(box && box.height >= 44, `quick button too small: ${box?.height}`)
      await stopBtn.tap()
      await m.getByRole('button', { name: 'この内容で記録' }).tap()
      await m.getByTestId('outcome-result').getByTestId('r-multiple').getByText('-1.00R').waitFor()
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 0, `journal one-tap: horizontal overflow ${overflow}px`)
      await m.screenshot({ path: join(outDir, 'mobile-06-one-tap.png'), fullPage: true })
      await mctx.close()
    })

    await step('Mobile (390x844): all five screens render without horizontal overflow', async () => {
      const mctx = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const m = await mctx.newPage()
      // A second synthetic dataset makes Market Lens render its import-history table on the phone too.
      await apiJson('/api/market/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        symbol: 'USDJPY', timeframe: '4h', sourceName: 'synthetic-second-dataset-with-a-long-file-name.csv', tzOffset: '+00:00',
        candles: [{ date: '2026-01-09 00:00', open: 150, high: 150.5, low: 149.8, close: 150.2 }, { date: '2026-01-09 04:00', open: 150.2, high: 150.6, low: 150, close: 150.4 }],
      }) })
      const headings = { market: /Market Lens/, scenario: /New Scenario/, court: /AI Court/, journal: /Journal/, insights: /Insights/ }
      for (const [i, route] of Object.keys(headings).entries()) {
        await m.goto(`${base}/#/${route}/${scenarioId}`)
        await m.reload() // fresh load per screen: hash-only goto is a same-document navigation
        await m.getByTestId('api-status').getByText('LOCAL D1 READY').waitFor()
        await m.locator('.panel h2').filter({ hasText: headings[route] }).waitFor()
        if (route === 'market') await m.getByTestId('dataset-table').waitFor()
        await m.waitForTimeout(200)
        const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        assert.ok(overflow <= 0, `${route}: horizontal overflow ${overflow}px`)
        // Tables must also stay inside their cards (clipped columns don't show up as page overflow).
        const spill = await m.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.table-wrap')].map((w) => {
          if (getComputedStyle(w).overflowX !== 'visible') return 0 // scrollable on purpose
          const table = w.querySelector('table')
          return table ? Math.round(table.getBoundingClientRect().right - w.getBoundingClientRect().right) : 0
        })))
        assert.ok(spill <= 1, `${route}: a table extends ${spill}px past its container`)
        await m.screenshot({ path: join(outDir, `mobile-0${i + 1}-${route}.png`), fullPage: true })
      }
      await mctx.close()
    })

    await step('Phone (390x844, touch): bottom tab bar, scenario picker, card tables and grading by tap', async () => {
      // Second synthetic scenario: SHORT that lost -1R, with one BEAR review, prepared via the local API.
      const post = (path, body) => apiJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const short = (await post('/api/scenarios', { symbol: 'USDJPY', timeframe: '1d', side: 'SHORT', entry: 152, stop: 153, target: 150, thesis: 'Synthetic E2E phone thesis: hypothetical failed rally', invalidation: 'Synthetic daily close above 153' })).body.scenario
      await post(`/api/scenarios/${short.id}/reviews`, { provider: 'grok', role: 'BEAR', content: 'Synthetic pasted BEAR answer: rally may extend' })
      await post(`/api/scenarios/${short.id}/paper-outcome`, { exitPrice: 153, exitReason: 'STOP' })

      const mctx = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const m = await mctx.newPage()
      await m.goto(`${base}/#/journal/${scenarioId}`)
      await m.getByTestId('api-status').getByText('LOCAL D1 READY').waitFor()
      // Tab bar is pinned to the bottom edge and tappable.
      const navBox = await m.getByRole('navigation', { name: '画面' }).boundingBox()
      assert.ok(navBox && Math.abs(navBox.y + navBox.height - 844) <= 1, `tab bar not at bottom: ${JSON.stringify(navBox)}`)
      await m.mouse.wheel(0, 3000)
      const navAfterScroll = await m.getByRole('navigation', { name: '画面' }).boundingBox()
      assert.ok(navAfterScroll && navAfterScroll.y + navAfterScroll.height <= 845, 'tab bar scrolled away')
      // Select the other scenario with the phone picker.
      await m.getByTestId('mobile-scenario-picker').selectOption(short.id)
      await m.waitForURL(new RegExp(`#/journal/${short.id}`))
      const grading = m.getByTestId('review-grading')
      const card = grading.getByRole('article', { name: /Grok BEAR/ })
      await card.waitFor()
      const hit = card.getByRole('button', { name: /的中/ })
      assert.equal(await hit.getAttribute('aria-pressed'), 'true', 'loss => BEAR HIT suggested')
      const box = await hit.boundingBox()
      assert.ok(box && box.height >= 44, `verdict button too small: ${box?.height}`)
      await hit.tap()
      await card.getByRole('button', { name: '採点を保存' }).tap()
      const status = m.getByRole('status').getByText(/GrokのBEARレビューを「的中」/)
      await status.waitFor()
      assert.ok(await status.isVisible() && (await status.boundingBox()).y >= 0, 'sticky alert not visible')
      if (isolated) await m.getByTestId('scorecard').getByTestId('warned-losses').getByText('1').waitFor()
      // Tables render as stacked cards on phones (no horizontal scrolling table).
      assert.equal(await m.locator('[data-testid=journal-table] thead').isVisible(), false)
      const cell = m.getByTestId('journal-table').locator('tbody tr td').first()
      assert.equal(await cell.evaluate((td) => getComputedStyle(td, '::before').content), '"作成"')
      assert.equal(await cell.evaluate((td) => getComputedStyle(td.parentElement).display), 'block')
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 0, `journal grading: horizontal overflow ${overflow}px`)
      await m.screenshot({ path: join(outDir, 'mobile-05-grading.png'), fullPage: true })
      await m.getByRole('navigation', { name: '画面' }).getByRole('button', { name: 'AI Court' }).tap()
      await m.locator('.panel h2').filter({ hasText: /AI Court/ }).waitFor()
      await m.getByTestId('review-compare').getByTestId('verdict-badge').getByText('的中').waitFor()
      await mctx.close()
    })

    await step('i18n: English UI from the browser locale, English prompt and errors, switch persists', async () => {
      const ectx = await newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } })
      const e = await ectx.newPage()
      e.on('pageerror', (err) => pageErrors.push(err.message))
      await e.goto(`${base}/#/scenario`)
      await e.getByTestId('api-status').getByText('LOCAL D1 READY').waitFor()
      assert.equal(await e.evaluate(() => document.documentElement.lang), 'en')
      await e.getByRole('form', { name: 'New scenario' }).getByText('Entry / hypothesis price').waitFor()
      await e.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /AI Court/ }).click()
      await e.goto(`${base}/#/court/${scenarioId}`)
      await e.reload()
      const prompt = e.getByTestId('prompt')
      await prompt.waitFor()
      assert.match(await prompt.inputValue(), /Role: BEAR \(argue against\)/)
      assert.match(await prompt.inputValue(), /Answer in English/)
      await e.getByText('1. Choose a role to generate the prompt').waitFor()
      // CSV rejection in English
      await e.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name: /Market Lens/ }).click()
      await e.getByTestId('csv-input').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(badCsv) })
      await e.getByRole('alert').getByText(/CSV line 2: invalid values/).waitFor()
      // Switch to Japanese: UI, prompt and <html lang> follow; the choice survives a reload.
      await e.getByRole('group', { name: 'Display language' }).getByRole('button', { name: '日本語' }).click()
      await e.getByRole('heading', { name: /Market Lens/ }).waitFor()
      await e.getByText('OHLC CSVを選択').waitFor()
      assert.equal(await e.evaluate(() => document.documentElement.lang), 'ja')
      await e.reload()
      await e.getByText('OHLC CSVを選択').waitFor()
      await e.getByRole('group', { name: '表示言語' }).getByRole('button', { name: 'EN' }).click()
      await e.getByText('Choose an OHLC CSV').waitFor()
      await e.screenshot({ path: join(outDir, '08-english-market.png'), fullPage: true })
      await ectx.close()

      // English strings are longer: re-check the five phone screens for overflow and table spill.
      const mctx = await newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const m = await mctx.newPage()
      for (const route of ['market', 'scenario', 'court', 'journal', 'insights']) {
        await m.goto(`${base}/#/${route}/${scenarioId}`)
        await m.reload()
        await m.getByTestId('api-status').getByText('LOCAL D1 READY').waitFor()
        await m.locator('.panel h2').first().waitFor()
        await m.waitForTimeout(200)
        const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        assert.ok(overflow <= 0, `en ${route}: horizontal overflow ${overflow}px`)
        const spill = await m.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.table-wrap')].map((w) => {
          if (getComputedStyle(w).overflowX !== 'visible') return 0
          const table = w.querySelector('table')
          return table ? Math.round(table.getBoundingClientRect().right - w.getBoundingClientRect().right) : 0
        })))
        assert.ok(spill <= 1, `en ${route}: a table extends ${spill}px past its container`)
      }
      await m.screenshot({ path: join(outDir, 'mobile-07-english-insights.png'), fullPage: true })
      await mctx.close()
    })

    await step('No external network request, dialog or page error occurred', async () => {
      assert.deepEqual(blocked, [], 'external requests attempted')
      assert.deepEqual(dialogs, [], 'unexpected dialogs')
      assert.deepEqual(pageErrors, [], 'page errors')
    })
  } finally {
    await browser.close()
    console.log(`\nScreenshots: ${outDir}`)
  }
  const failed = steps.filter((s) => s.status !== 'PASS')
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${steps.length - failed.length}/${steps.length} browser E2E steps`)
  if (failed.length) process.exitCode = 1
}

main().catch((e) => { if (!steps.some((s) => s.status === 'FAIL')) console.error(e); process.exitCode = 1 }).finally(cleanup)
