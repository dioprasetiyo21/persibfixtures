'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'persib-theme'

interface ThemeContextValue {
  /** The user's stored preference: light, dark, or system. */
  theme: ThemeMode
  /** The theme actually painted right now (system resolves to light/dark). */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// `useLayoutEffect` warns during SSR, so fall back to `useEffect` on the server
// where it never runs anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage can be unavailable (private browsing, blocked storage).
  }
  return 'system'
}

/** Applies the resolved theme to <html> so CSS tokens and Tailwind `dark:` switch. */
function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.classList.toggle('light', resolved === 'light')
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')

  // Runs before paint on the client. Reading here (rather than in a lazy state
  // initializer) keeps the server and first client render identical, so there is
  // no hydration mismatch. It also re-applies the theme after React Strict
  // Mode's development remount, which resets the attributes on <html>.
  useIsomorphicLayoutEffect(() => {
    const stored = readStoredTheme()
    const resolved = stored === 'system' ? systemTheme() : stored
    setThemeState(stored)
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  // Follow the operating system while in "system" mode.
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const resolved: ResolvedTheme = media.matches ? 'dark' : 'light'
      setResolvedTheme(resolved)
      applyTheme(resolved)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Ignore storage failures; the in-memory preference still applies.
    }
    const resolved: ResolvedTheme = next === 'system' ? systemTheme() : next
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

/**
 * Blocking script that restores the saved theme before the browser paints.
 * Injected into <head> in the root layout; see the Next.js guide
 * "How to prevent flash before hydration".
 */
export const themeInitScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);var m=(s==='light'||s==='dark'||s==='system')?s:'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.classList.toggle('light',!d);r.dataset.theme=d?'dark':'light';r.style.colorScheme=d?'dark':'light';}catch(e){}})();`
