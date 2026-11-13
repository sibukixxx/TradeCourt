import { z } from 'zod'

// Optional, user-initiated USD/JPY REFERENCE quote contract (not a live or tradeable price).
export type QuoteProvider = 'frankfurter' | 'off' | 'synthetic'

export type Quote = {
  symbol: 'USDJPY'
  price: number
  /** Date (or time) the provider says the value refers to. */
  asOf: string
  source: string
  provider: Exclude<QuoteProvider, 'off'>
  /** Always false: daily reference rates / synthetic values are not live prices. */
  realtime: false
  kind: 'reference'
  fetchedAt: string
}

export function quoteProvider(value: string | undefined): QuoteProvider {
  return value === 'frankfurter' || value === 'synthetic' ? value : 'off'
}

/** api.frankfurter.dev `latest?base=USD&symbols=JPY`; sanity bounds reject garbage values. */
export const frankfurterResponseSchema = z.object({
  base: z.literal('USD'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.object({ JPY: z.number().finite().min(50).max(500) }),
})
