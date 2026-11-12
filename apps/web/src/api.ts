import type {
  DecisionAnalysis,
  JournalResponse,
  MarketDataset,
  MarketDatasetInput,
  MarketDatasetMeta,
  PaperOutcome,
  PaperOutcomeInput,
  PathCheckResponse,
  Review,
  ReviewGradeInput,
  ReviewInput,
  Scenario,
  ScenarioDetail,
  ScenarioInput,
} from '@tradecourt/core'

// Same-origin relative /api only (Vite proxies to the loopback Worker). No external calls.

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues: { path: string; message: string }[] = []) {
    super(message)
  }
}

async function request<T>(path: string, options: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const { idempotencyKey, ...init } = options
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('ローカルAPIに接続できません。pnpm dev が起動しているか確認してください。', 0)
  }
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const obj = (result && typeof result === 'object' ? result : {}) as { error?: unknown; issues?: unknown }
    const issues = Array.isArray(obj.issues) ? obj.issues as { path: string; message: string }[] : []
    const base = typeof obj.error === 'string' ? obj.error : `API HTTP ${response.status}`
    const detail = issues.length ? `: ${issues.slice(0, 3).map((i) => `${i.path || 'body'} — ${i.message}`).join(' / ')}` : ''
    throw new ApiError(base + detail, response.status, issues)
  }
  return result as T
}

export const newRequestKey = () => crypto.randomUUID()

export const api = {
  health: () => request<{ status: string; mode: string }>('/api/health'),
  list: () => request<{ scenarios: Scenario[] }>('/api/scenarios'),
  create: (input: ScenarioInput, idempotencyKey: string) => request<{ scenario: Scenario }>('/api/scenarios', {
    method: 'POST', body: JSON.stringify(input), idempotencyKey,
  }),
  detail: (id: string) => request<ScenarioDetail>(`/api/scenarios/${encodeURIComponent(id)}`),
  review: (id: string, input: ReviewInput, idempotencyKey: string) => request<{ review: Review }>(
    `/api/scenarios/${encodeURIComponent(id)}/reviews`,
    { method: 'POST', body: JSON.stringify(input), idempotencyKey },
  ),
  paperOutcome: (id: string, input: PaperOutcomeInput) => request<{ outcome: PaperOutcome }>(
    `/api/scenarios/${encodeURIComponent(id)}/paper-outcome`,
    { method: 'POST', body: JSON.stringify(input) },
  ),
  gradeReview: (scenarioId: string, reviewId: string, input: ReviewGradeInput) => request<{ review: Review }>(
    `/api/scenarios/${encodeURIComponent(scenarioId)}/reviews/${encodeURIComponent(reviewId)}/grade`,
    { method: 'PUT', body: JSON.stringify(input) },
  ),
  journal: () => request<JournalResponse>('/api/journal'),
  analysis: (limit: number | null) => request<{ analysis: DecisionAnalysis; kind: 'paper' }>(
    `/api/analysis${limit ? `?limit=${limit}` : ''}`,
  ),
  pathCheck: (scenarioId: string, datasetId?: string) => request<PathCheckResponse>(
    `/api/scenarios/${encodeURIComponent(scenarioId)}/path-check${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`,
  ),
  datasets: () => request<{ datasets: MarketDatasetMeta[] }>('/api/market/datasets'),
  dataset: (id: string) => request<{ dataset: MarketDataset }>(`/api/market/datasets/${encodeURIComponent(id)}`),
  importDataset: (input: MarketDatasetInput, idempotencyKey: string) => request<{ dataset: MarketDataset }>(
    '/api/market/datasets', { method: 'POST', body: JSON.stringify(input), idempotencyKey },
  ),
}

/** Same-origin download links (served by the local API through the Vite proxy). */
export const exportUrl = (format: 'csv' | 'json') => `/api/export?format=${format}`
