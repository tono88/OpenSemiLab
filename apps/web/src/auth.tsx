import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type AuthUser = { id: string; email: string; name: string; role: string }
type RegisterResult = { ok?: boolean; verify_required?: boolean; dev_token?: string; token?: string }
type AuthState = {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<RegisterResult>
  logout: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

/** Sesión por cookie httpOnly: el navegador la manda sola (JS no la puede leer). */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (!isForm && init.body !== undefined && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, { credentials: 'include', ...init, headers })
  return res
}

export async function authFetch(path: string, init: RequestInit = {}) {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    if (res.status === 401 && !location.hash.startsWith('#/login')) location.hash = '#/login'
    const body = await res.json().catch(() => ({ detail: 'Request failed' }))
    const detail = Array.isArray(body.detail) ? body.detail.map((d: { msg: string }) => d.msg).join(' · ') : body.detail
    throw new Error(detail ?? 'Request failed')
  }
  return res.json()
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/auth/me')
      if (!res.ok) { setUser(null); return }
      setUser(await res.json())
    } catch { setUser(null) }
    finally { setReady(true) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    await authFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    await refresh()
  }, [refresh])

  const register = useCallback(async (name: string, email: string, password: string): Promise<RegisterResult> => {
    const data = await authFetch('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) })
    if (data.token) await refresh()
    return data
  }, [refresh])

  const logout = useCallback(async () => {
    try { await apiFetch('/api/v1/auth/logout', { method: 'POST' }) } catch { /* sesión ya inválida */ }
    setUser(null)
    location.hash = '#/'
  }, [])

  const value = useMemo(() => ({ user, ready, login, register, logout, refresh }), [user, ready, login, register, logout, refresh])
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
