import { CsvParseError } from '@tradecourt/core'
import { locale, t } from './i18n'

export const price = (value: number) => value.toFixed(3)
export const timestamp = (value: string) => new Date(value).toLocaleString(locale())
export const signed = (value: number, digits = 2) => (value > 0 ? '+' : '') + value.toFixed(digits)
export function getError(error: unknown): string {
  // CSV rejections carry a code so they can be shown in the current language.
  if (error instanceof CsvParseError) return t(`csv.${error.code}`, { line: error.line ?? '', detail: error.detail })
  return error instanceof Error ? error.message : t('common.unexpected')
}
/** datetime-local value (local time, minutes) for "now". */
export function localDateTimeNow(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
