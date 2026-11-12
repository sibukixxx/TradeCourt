#!/usr/bin/env node
// TradeCourt local process / database control, used by the Makefile. LOCAL ONLY (macOS / Linux).
//
//   node scripts/devctl.mjs start | stop | restart | status
//   node scripts/devctl.mjs db-backup | db-restore <file.sql> | db-reset
//
// `start` runs `pnpm dev` (Worker :8787 + Vite :5173) in the background, writes its PID to
// .run/dev.pid and its output to .run/dev.log, and waits until both health checks pass.
// Nothing here talks to a remote Cloudflare account, AI service or broker.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const runDir = join(root, '.run')
const pidFile = join(runDir, 'dev.pid')
const logFile = join(runDir, 'dev.log')
const apiDir = join(root, 'apps/api')
const stateDir = join(apiDir, '.wrangler/state')
const backupDir = join(root, 'backups')
const wrangler = join(apiDir, 'node_modules/.bin/wrangler')
const DB = 'trade-court-local'
const API = { name: 'API (Worker + local D1)', port: 8787, health: 'http://127.0.0.1:8787/api/health' }
const WEB = { name: 'Web (Vite)', port: 5173, health: 'http://127.0.0.1:5173/api/health', url: 'http://127.0.0.1:5173' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = (message) => { console.error(`✗ ${message}`); process.exit(1) }

function readPid() {
  if (!existsSync(pidFile)) return null
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  return Number.isInteger(pid) && pid > 0 ? pid : null
}
function alive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}
function portOpen(port) {
  return new Promise((ok) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(500)
    socket.once('connect', () => { socket.destroy(); ok(true) })
    socket.once('timeout', () => { socket.destroy(); ok(false) })
    socket.once('error', () => ok(false))
  })
}
async function health(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    const body = await res.json().catch(() => ({}))
    return { http: res.status, status: body.status ?? null }
  } catch {
    return { http: 0, status: null }
  }
}
function tailLog(lines = 30) {
  if (!existsSync(logFile)) return ''
  return readFileSync(logFile, 'utf8').split('\n').slice(-lines).join('\n')
}
function ensureInstalled() {
  if (!existsSync(wrangler)) fail('Dependencies are missing. Run `make install` (or `make setup`) first.')
}
function running() {
  const pid = readPid()
  if (pid && alive(pid)) return pid
  if (pid) unlinkSync(pidFile) // stale
  return null
}

async function start() {
  ensureInstalled()
  const existing = running()
  if (existing) { console.log(`• Already running (PID ${existing}). ${WEB.url}`); return }
  for (const svc of [API, WEB]) {
    if (await portOpen(svc.port)) {
      fail(`Port ${svc.port} is already in use (${svc.name}). Another \`pnpm dev\` may be running in a terminal; stop it first.`)
    }
  }
  mkdirSync(runDir, { recursive: true })
  const out = openSync(logFile, 'w')
  // detached => own process group, so `stop` can terminate pnpm, concurrently, wrangler, workerd and vite together.
  const child = spawn('corepack', ['pnpm', 'dev'], { cwd: root, detached: true, stdio: ['ignore', out, out] })
  closeSync(out)
  child.unref()
  writeFileSync(pidFile, String(child.pid))
  process.stdout.write(`• Starting TradeCourt (PID ${child.pid}) `)

  const until = Date.now() + 90_000
  while (Date.now() < until) {
    if (!alive(child.pid)) { console.log(''); fail(`Dev server exited during startup. Log (.run/dev.log):\n${tailLog()}`) }
    const [api, web] = await Promise.all([health(API.health), health(WEB.health)])
    if (api.status === 'setup_required') {
      console.log('')
      await stop({ quiet: true })
      fail('Local database migrations are pending. Run `make migrate`, then `make start`.')
    }
    if (api.status === 'ok' && web.status === 'ok') {
      console.log('✓')
      console.log(`  Web : ${WEB.url}`)
      console.log(`  API : ${API.health}`)
      console.log('  Logs: make logs   Stop: make stop')
      return
    }
    process.stdout.write('.')
    await sleep(1000)
  }
  console.log('')
  await stop({ quiet: true })
  fail(`Timed out waiting for health checks. Log (.run/dev.log):\n${tailLog()}`)
}

async function stop({ quiet = false } = {}) {
  const pid = readPid()
  if (!pid || !alive(pid)) {
    if (existsSync(pidFile)) unlinkSync(pidFile)
    if (!quiet) {
      const busy = (await Promise.all([API, WEB].map((s) => portOpen(s.port)))).some(Boolean)
      console.log(busy
        ? '• Not started by `make start`, but ports 8787/5173 are in use (a foreground `make dev`?). Stop that terminal with Ctrl+C.'
        : '• Not running.')
    }
    return
  }
  const group = (signal) => { try { process.kill(-pid, signal) } catch { /* already gone */ } }
  group('SIGTERM')
  for (let i = 0; i < 40; i++) {
    const open = await Promise.all([API, WEB].map((s) => portOpen(s.port)))
    if (!alive(pid) && !open.some(Boolean)) break
    await sleep(250)
  }
  group('SIGKILL') // make sure workerd / vite children do not linger
  if (existsSync(pidFile)) unlinkSync(pidFile)
  if (!quiet) console.log(`✓ Stopped (PID ${pid}).`)
}

async function status() {
  const pid = running()
  console.log(`Process : ${pid ? `running (PID ${pid}, started by make start)` : 'not started by make start'}`)
  for (const svc of [API, WEB]) {
    const h = await health(svc.health)
    const state = h.status === 'ok' ? '✓ healthy' : h.status === 'setup_required' ? '! needs `make migrate`' : h.http ? `✗ HTTP ${h.http}` : '✗ down'
    console.log(`${svc.name.padEnd(24)} :${svc.port}  ${state}`)
  }
  if (pid) console.log(`Open    : ${WEB.url}`)
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

function backup({ label = 'backup' } = {}) {
  ensureInstalled()
  if (!existsSync(stateDir)) { console.log('• No local database yet; nothing to back up.'); return null }
  mkdirSync(backupDir, { recursive: true })
  const file = join(backupDir, `tradecourt-${label}-${timestampName()}.sql`)
  const r = spawnSync(wrangler, ['d1', 'export', DB, '--local', '--output', file], { cwd: apiDir, encoding: 'utf8' })
  if (r.status !== 0 || !existsSync(file)) fail(`Backup failed:\n${r.stdout}\n${r.stderr}`)
  console.log(`✓ Backup written: ${file.replace(root + '/', '')}`)
  return file
}

async function requireStopped(action) {
  if (running() || (await Promise.all([API, WEB].map((s) => portOpen(s.port)))).some(Boolean)) {
    fail(`Stop the dev server before ${action} (\`make stop\`, or Ctrl+C in the \`make dev\` terminal).`)
  }
}

function migrate() {
  const r = spawnSync(wrangler, ['d1', 'migrations', 'apply', DB, '--local'], { cwd: apiDir, stdio: 'inherit', env: { ...process.env, CI: '1' } })
  if (r.status !== 0) fail('Migration failed.')
}

async function reset() {
  ensureInstalled()
  await requireStopped('resetting the database')
  backup({ label: 'before-reset' })
  rmSync(stateDir, { recursive: true, force: true })
  console.log('✓ Local database removed. Re-applying migrations…')
  migrate()
  console.log('✓ Empty local database ready.')
}

async function restore(file) {
  ensureInstalled()
  if (!file) {
    const latest = existsSync(backupDir) ? readdirSync(backupDir).filter((f) => f.endsWith('.sql')).sort().at(-1) : null
    fail(`Usage: make db-restore FILE=backups/<file>.sql${latest ? `\n  latest: backups/${latest}` : ''}`)
  }
  const path = resolve(root, file)
  if (!existsSync(path)) fail(`Backup file not found: ${file}`)
  await requireStopped('restoring the database')
  backup({ label: 'before-restore' })
  rmSync(stateDir, { recursive: true, force: true })
  const r = spawnSync(wrangler, ['d1', 'execute', DB, '--local', '--file', path, '--yes'], { cwd: apiDir, encoding: 'utf8', env: { ...process.env, CI: '1' } })
  if (r.status !== 0) fail(`Restore failed:\n${r.stdout}\n${r.stderr}`)
  console.log(`✓ Restored from ${file}. Applying any newer migrations…`)
  migrate()
}

const [command, arg] = process.argv.slice(2)
const commands = {
  start, stop, status,
  // Exit 0 when the background app is running (used by the Makefile to skip migrations then).
  running: async () => { process.exit(running() ? 0 : 1) },
  restart: async () => { await stop(); await start() },
  'db-backup': async () => { backup() },
  'db-reset': reset,
  'db-restore': () => restore(arg),
}
if (!commands[command]) fail(`Unknown command "${command ?? ''}". Use: ${Object.keys(commands).join(' | ')}`)
await commands[command]()
