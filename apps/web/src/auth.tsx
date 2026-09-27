import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type AuthUser = { id: string; email: string; name: string; role: string }
type AuthState = {
  token: string | null
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)
const KEY = 'opensemilab.token'

export async function authFetch(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem(KEY)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Request failed' }))
    const detail = Array.isArray(body.detail) ? body.detail.map((d: { msg: string }) => d.msg).join(' · ') : body.detail
    throw new Error(detail ?? 'Request failed')
  }
  return res.json()
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(KEY))
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    const t = localStorage.getItem(KEY)
    if (!t) { setUser(null); setReady(true); return }
    try {
      const me = await authFetch('/api/v1/auth/me')
      setUser(me); setToken(t)
    } catch { localStorage.removeItem(KEY); setToken(null); setUser(null) }
    setReady(true)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const data = await authFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    localStorage.setItem(KEY, data.token)
    setToken(data.token)
    await refresh()
  }, [refresh])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const data = await authFetch('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) })
    localStorage.setItem(KEY, data.token)
    setToken(data.token)
    await refresh()
  }, [refresh])

  const logout = useCallback(() => { localStorage.removeItem(KEY); setToken(null); setUser(null); location.hash = '#/' }, [])

  const value = useMemo(() => ({ token, user, ready, login, register, logout, refresh }), [token, user, ready, login, register, logout, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}

export function useLocale(): ['es' | 'en', (l: 'es' | 'en') => void] {
  const [locale, setLocale] = useState<'es' | 'en'>(() => localStorage.getItem('opensemilab.locale') === 'en' ? 'en' : 'es')
  const change = (l: 'es' | 'en') => { setLocale(l); localStorage.setItem('opensemilab.locale', l) }
  return [locale, change]
}
