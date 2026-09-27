import { useEffect, useState } from 'react'
import App from './App'
import { AuthProvider, useAuth } from './auth'
import { Landing } from './pages/Landing'
import { Team } from './pages/Team'
import { Privacy, Terms } from './pages/Legal'
import { Forgot, Login, Register } from './pages/AuthPages'
import { Verify } from './pages/Verify'

function route(): string {
  const h = location.hash.replace(/^#/, '') || '/'
  return h.startsWith('/') ? h : `/${h}`
}

function Gate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  useEffect(() => { if (ready && !user) location.hash = '#/login' }, [ready, user])
  if (!ready) return <div className="app-shell pub"><main className="pub-main"><p>…</p></main></div>
  if (!user) return <Login />
  return <>{children}</>
}

function Router() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener('hashchange', bump)
    if (!location.hash) location.hash = '#/'
    return () => window.removeEventListener('hashchange', bump)
  }, [])
  const r = route()
  if (r === '/' || r === '') return <Landing />
  if (r === '/equipo') return <Team />
  if (r === '/terminos') return <Terms />
  if (r === '/privacidad') return <Privacy />
  if (r === '/login') return <Login />
  if (r === '/registro') return <Register />
  if (r === '/recuperar') return <Forgot />
  if (r.startsWith('/verificar')) return <Verify />
  return <Gate><App /></Gate>
}

export default function Root() {
  return <AuthProvider><Router /></AuthProvider>
}
