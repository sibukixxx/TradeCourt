export const price = (value: number) => value.toFixed(3)
export const timestamp = (value: string) => new Date(value).toLocaleString('ja-JP')
export const signed = (value: number, digits = 2) => (value > 0 ? '+' : '') + value.toFixed(digits)
export function getError(error: unknown): string {
  return error instanceof Error ? error.message : '予期しないエラーが発生しました'
}
/** datetime-local value (local time, minutes) for "now". */
export function localDateTimeNow(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
