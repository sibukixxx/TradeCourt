// Minimal D1Database-compatible shim over Node's built-in node:sqlite, for unit tests only.
// It applies the real migration files so tests exercise the same schema as local Wrangler D1.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type Value = string | number | null | bigint | Uint8Array

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: Value[] = []) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : (p ?? null)) as Value))
  }
  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined
    if (!row) return null
    return (column ? row[column] : { ...row }) as T
  }
  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...this.params) as Record<string, unknown>[]
    return { success: true, results: rows.map((r) => ({ ...r })) as T[], meta: {} }
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.params)
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
  }
}

export function createTestD1(options: { migrate?: boolean } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  if (options.migrate !== false) {
    const dir = join(import.meta.dirname, '..', 'migrations')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(dir, file), 'utf8'))
    }
  }
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => Promise.all(statements.map((s) => s.run())),
    exec: async (sql: string) => { db.exec(sql); return { count: 1, duration: 0 } },
  }
  return { d1: d1 as unknown as D1Database, raw: db }
}
