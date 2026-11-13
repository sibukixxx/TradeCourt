// Minimal i18n without dependencies. The current language is module state; the app root calls
// useLang() so a switch re-renders the whole tree (Preact re-renders children with the parent),
// without remounting components or losing form input.
import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '@tradecourt/core'
import { ja } from './ja'
import { en } from './en'

export type MessageKey = keyof typeof ja
const dictionaries: Record<Lang, Record<MessageKey, string>> = { ja, en }
const STORAGE_KEY = 'tradecourt.lang'

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'ja') return saved
  } catch { /* storage unavailable: fall back to the browser language */ }
  const langs = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language])
  return langs.some((l) => l?.toLowerCase().startsWith('ja')) ? 'ja' : 'en'
}

let current: Lang = detectLang()
const listeners = new Set<(lang: Lang) => void>()

export const getLang = (): Lang => current
/** BCP 47 locale for dates and numbers. */
export const locale = (): string => (current === 'ja' ? 'ja-JP' : 'en-US')

export function setLang(lang: Lang) {
  current = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* not persisted; still switches */ }
  document.documentElement.lang = lang
  listeners.forEach((fn) => fn(lang))
}

export function useLang(): Lang {
  const [lang, setState] = useState(current)
  useEffect(() => {
    listeners.add(setState)
    return () => { listeners.delete(setState) }
  }, [])
  return lang
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = dictionaries[current][key]
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}
