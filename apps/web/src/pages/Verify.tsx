import { useEffect, useState } from 'react'
import { apiFetch, useAuth, useLocale } from '../auth'
import { PublicShell, go } from './shell'

function tokenFromHash(): string {
  const q = location.hash.split('?')[1] ?? ''
  return new URLSearchParams(q).get('token') ?? ''
}

export function Verify() {
  const { refresh } = useAuth()
  const [locale] = useLocale()
  const es = locale === 'es'
  const [state, setState] = useState<'busy' | 'ok' | 'bad'>('busy')
  useEffect(() => {
    const token = tokenFromHash()
    if (!token) { setState('bad'); return }
    apiFetch(`/api/v1/auth/verify?token=${encodeURIComponent(token)}`)
      .then(async res => {
        if (!res.ok) { setState('bad'); return }
        await res.json()
        await refresh()
        setState('ok')
        setTimeout(() => go('#/lab'), 1200)
      })
      .catch(() => setState('bad'))
  }, [refresh])
  return <PublicShell><section className="auth-card">
    <h1>{es ? 'Verificando correo' : 'Verifying email'}</h1>
    {state === 'busy' && <p>…</p>}
    {state === 'ok' && <p>{es ? 'Correo verificado. Entrando al Lab…' : 'Email verified. Entering the Lab…'}</p>}
    {state === 'bad' && <><p className="error">{es ? 'Link inválido o vencido. Pide uno nuevo desde el login.' : 'Invalid or expired link. Request a new one from login.'}</p><p className="auth-alt"><a href="#/login">{es ? 'Ir al login' : 'Go to login'}</a></p></>}
  </section></PublicShell>
}
