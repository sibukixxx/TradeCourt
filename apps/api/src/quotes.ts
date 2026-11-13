// Optional, user-initiated USD/JPY reference quote. Called ONLY when the user presses
// "Get current price"; never on page load or in the background. Not a live/tradeable price feed.
//
// QUOTE_PROVIDER (wrangler vars / --var):
//   frankfurter : European Central Bank daily reference rate via api.frankfurter.dev (no key)
//   off         : external quotes disabled
//   synthetic   : fixed SYNTHETIC value, no network (tests only)
import { frankfurterResponseSchema, type Quote, type QuoteProvider } from '@tradecourt/core'

export class QuoteError extends Error {}

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY'

export async function fetchQuote(provider: QuoteProvider, fetchImpl: typeof fetch = fetch): Promise<Quote> {
  const fetchedAt = new Date().toISOString()
  if (provider === 'off') throw new QuoteError('External quotes are disabled (QUOTE_PROVIDER=off)')
  if (provider === 'synthetic') {
    return {
      symbol: 'USDJPY', price: 150.123, asOf: fetchedAt.slice(0, 10), source: 'SYNTHETIC TEST QUOTE (no network)',
      provider, realtime: false, kind: 'reference', fetchedAt,
    }
  }
  let res: Response
  try {
    // No user data is sent: a plain GET with a generic client identifier.
    res = await fetchImpl(FRANKFURTER_URL, { headers: { Accept: 'application/json', 'User-Agent': 'TradeCourt-local' }, signal: AbortSignal.timeout(5000) })
  } catch {
    throw new QuoteError('Quote provider unreachable')
  }
  if (!res.ok) throw new QuoteError(`Quote provider returned HTTP ${res.status}`)
  const parsed = frankfurterResponseSchema.safeParse(await res.json().catch(() => null))
  if (!parsed.success) throw new QuoteError('Quote provider returned an unexpected response')
  return {
    symbol: 'USDJPY',
    price: parsed.data.rates.JPY,
    asOf: parsed.data.date,
    source: 'European Central Bank daily reference rate via frankfurter.dev',
    provider, realtime: false, kind: 'reference', fetchedAt,
  }
}
