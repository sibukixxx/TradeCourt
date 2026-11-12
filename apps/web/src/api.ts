import type {
  PaperOutcome,
  Review,
  ReviewInput,
  Scenario,
  ScenarioDetail,
  ScenarioInput,
} from '@tradecourt/core'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result &&
      typeof result.error === 'string' ? result.error : `API HTTP ${response.status}`
    throw new Error(message)
  }
  return result as T
}

export const api = {
  health: () => request<{ status: string; mode: string }>('/api/health'),
  list: () => request<{ scenarios: Scenario[] }>('/api/scenarios'),
  create: (input: ScenarioInput) => request<{ scenario: Scenario }>('/api/scenarios', {
    method: 'POST', body: JSON.stringify(input),
  }),
  detail: (id: string) => request<ScenarioDetail>(`/api/scenarios/${encodeURIComponent(id)}`),
  review: (id: string, input: ReviewInput) => request<{ review: Review }>(
    `/api/scenarios/${encodeURIComponent(id)}/reviews`,
    { method: 'POST', body: JSON.stringify(input) },
  ),
  paperOutcome: (id: string, exitPrice: number, note: string) =>
    request<{ outcome: PaperOutcome }>(
      `/api/scenarios/${encodeURIComponent(id)}/paper-outcome`,
      { method: 'POST', body: JSON.stringify({ exitPrice, note }) },
    ),
}
