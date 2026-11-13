import { describe, expect, it } from 'vitest'
import { CsvParseError, marketDatasetInputSchema, parseOhlcCsv, summarizeCandles } from './market'

// All fixtures below are SYNTHETIC values for tests only; they are not real USD/JPY quotes.
const csv = [
  'date,open,high,low,close',
  '2026-01-05,150.00,150.80,149.70,150.50',
  '2026-01-06,150.50,151.20,150.10,151.00',
  '2026-01-07,151.00,151.10,149.50,149.90',
].join('\n')

describe('OHLC CSV import', () => {
  it('parses a valid synthetic file, tolerating BOM, CRLF and column order', () => {
    expect(parseOhlcCsv(csv)).toHaveLength(3)
    const reordered = '﻿close,date,low,high,open,volume\r\n150.5,2026-01-05,149.7,150.8,150,1\r\n151,2026-01-06T00:00:00Z,150.1,151.2,150.5,2\r\n'
    expect(parseOhlcCsv(reordered)[1]).toEqual({ date: '2026-01-06T00:00:00Z', open: 150.5, high: 151.2, low: 150.1, close: 151 })
  })

  it.each([
    ['missing column', 'date,open,high,close\n2026-01-01,1,2,1.5\n2026-01-02,1,2,1.5', 'MISSING_COLUMNS', 1],
    ['header only', 'date,open,high,low,close\n', 'TOO_FEW_ROWS', null],
    ['high below close', 'date,open,high,low,close\n2026-01-01,150,150.1,149,151\n2026-01-02,150,151,149,150', 'INVALID_ROW', 2],
    ['negative / text number', 'date,open,high,low,close\n2026-01-01,150,151,149,150\n2026-01-02,-1,151,149,150', 'INVALID_ROW', 3],
    ['locale number', 'date,open,high,low,close\n2026-01-01,150,151,149,150\n2026-01-02,"1,50",151,149,150', 'COLUMN_COUNT', 3],
    ['impossible date', 'date,open,high,low,close\n2026-02-31,150,151,149,150\n2026-03-01,150,151,149,150', 'INVALID_ROW', 2],
    ['unsorted', 'date,open,high,low,close\n2026-01-02,150,151,149,150\n2026-01-01,150,151,149,150', 'NOT_ASCENDING', 3],
    ['duplicate date', 'date,open,high,low,close\n2026-01-02,150,151,149,150\n2026-01-02,150,151,149,150', 'NOT_ASCENDING', 3],
    ['ragged row', 'date,open,high,low,close\n2026-01-01,150,151,149,150\n2026-01-02,150,151,149', 'COLUMN_COUNT', 3],
  ])('rejects %s with a stable code and line', (_label, source, code, line) => {
    let error: unknown
    try { parseOhlcCsv(source) } catch (e) { error = e }
    expect(error).toBeInstanceOf(CsvParseError)
    expect(error).toMatchObject({ code, line })
  })

  it('rejects more than 5,000 candles', () => {
    const rows = Array.from({ length: 5001 }, (_, i) => {
      const d = new Date(Date.UTC(2000, 0, 1) + i * 86400000).toISOString().slice(0, 10)
      return `${d},150,151,149,150`
    })
    expect(() => parseOhlcCsv(['date,open,high,low,close', ...rows].join('\n'))).toThrow(/5,000/)
  })

  it('computes high, low, absolute and percentage change from the file only', () => {
    const stats = summarizeCandles(parseOhlcCsv(csv))
    expect(stats).toEqual({
      count: 3, firstDate: '2026-01-05', lastDate: '2026-01-07', firstClose: 150.5, lastClose: 149.9,
      high: 151.2, highDate: '2026-01-06', low: 149.5, lowDate: '2026-01-07', change: -0.6, changePct: -0.399,
    })
  })

  it('re-validates datasets on the server-side schema', () => {
    const candles = parseOhlcCsv(csv)
    const base = { symbol: 'USDJPY', timeframe: '1d', sourceName: 'synthetic.csv', candles }
    expect(marketDatasetInputSchema.safeParse(base).success).toBe(true)
    expect(marketDatasetInputSchema.safeParse({ ...base, symbol: 'EURUSD' }).success).toBe(false)
    expect(marketDatasetInputSchema.safeParse({ ...base, candles: [...candles].reverse() }).success).toBe(false)
    expect(marketDatasetInputSchema.safeParse({ ...base, candles: [{ ...candles[0], high: 1 }, candles[1]] }).success).toBe(false)
  })
})
