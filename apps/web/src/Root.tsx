import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'
import { AuthProvider, useAuth } from './auth'
import { Landing } from './pages/Landing'
import { Team } from './pages/Team'
import { Privacy, Terms } from './pages/Legal'
import { Forgot, Login, Register, ResetPassword } from './pages/AuthPages'
import { Verify } from './pages/Verify'
import { Admin } from './pages/Admin'
import { Gallery } from './pages/Gallery'
import { syncProjects } from './serverProjects'

const Guide = lazy(() => import('./pages/Guide'))

function route(): string {
  const h = location.hash.replace(/^#/, '') || '/'
  return h.startsWith('/') ? h : `/${h}`
}

function Gate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  const [synced, setSynced] = useState(false)
  useEffect(() => { if (ready && !user) location.hash = '#/login' }, [ready, user])
  useEffect(() => {
    if (!user) return
    setSynced(false)
    const timer = window.setTimeout(() => setSynced(true), 8000)
    void syncProjects().finally(() => { window.clearTimeout(timer); setSynced(true) })
    return () => window.clearTimeout(timer)
  }, [user?.id])
  if (!ready) return <div className="app-shell pub"><main className="pub-main"><p>…</p></main></div>
  if (!user) return <Login />
  if (!synced) return <div className="app-shell pub"><main className="pub-main"><p>Sincronizando proyectos…</p></main></div>
  return <>{children}</>
}

function AdminGate() {
  const { user, ready } = useAuth()
  if (!ready) return <div className="app-shell pub"><main className="pub-main"><p>…</p></main></div>
  if (!user) return <Login />
  if (user.role !== 'admin') return <Login />
  return <Admin />
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
  if (r.startsWith('/guia')) return <Suspense fallback={<p>Cargando guía…</p>}><Guide /></Suspense>
  if (r === '/terminos') return <Terms />
  if (r === '/privacidad') return <Privacy />
  if (r === '/login') return <Login />
  if (r === '/registro') return <Register />
  if (r === '/recuperar') return <Forgot />
  if (r.startsWith('/restablecer')) return <ResetPassword />
  if (r.startsWith('/verificar')) return <Verify />
  if (r === '/galeria') return <Gate><Gallery /></Gate>
  if (r === '/admin') return <AdminGate />
  return <Gate><App /></Gate>
}

export default function Root() {
  return <AuthProvider><Router /></AuthProvider>
}
