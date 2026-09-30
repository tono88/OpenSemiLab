import { useState } from 'react'
import { authFetch, useAuth, useLocale } from '../auth'
import { PublicShell, go } from './shell'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="auth-card"><h1>{title}</h1>{children}</section>
}

export function Login() {
  const { login } = useAuth()
  const [locale] = useLocale()
  const es = locale === 'es'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [resent, setResent] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try { await login(email.trim(), password); go('#/lab') }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed') }
    finally { setBusy(false) }
  }
  async function resend() {
    setError('')
    try { await authFetch('/api/v1/auth/resend', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }); setResent(true) }
    catch (err) { setError(err instanceof Error ? err.message : 'Request failed') }
  }
  return <PublicShell><Card title={es ? 'Entrar' : 'Sign in'}>
    <form onSubmit={submit}>
      <label>{es ? 'EMAIL INSTITUCIONAL' : 'INSTITUTIONAL EMAIL'}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@universidad.edu" /></label>
      <label>{es ? 'CONTRASEÑA' : 'PASSWORD'}<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      {error.includes('Verifica') && <p className="auth-alt"><button className="btn-ghost" type="button" onClick={() => void resend()}>{resent ? (es ? 'Link reenviado, revisa tu inbox' : 'Link resent, check your inbox') : (es ? 'Reenviar link de verificación' : 'Resend verification link')}</button></p>}
      {error.includes('inválidos') && <p className="auth-alt">¿Primera vez por aquí? <a href="#/registro">Crea tu cuenta .edu</a>.</p>}
      <button className="btn-primary block" disabled={busy}>{busy ? '…' : (es ? 'Entrar' : 'Sign in')}</button>
    </form>
    <p className="auth-alt"><a href="#/recuperar">{es ? 'Olvidé mi contraseña' : 'Forgot password'}</a> · <a href="#/registro">{es ? 'Crear cuenta' : 'Create account'}</a></p>
  </Card></PublicShell>
}

export function Register() {
  const { register } = useAuth()
  const [locale] = useLocale()
  const es = locale === 'es'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const data = await register(name.trim(), email.trim(), password)
      if (data.token) { go('#/lab'); return }
      setSent(true)
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Register failed') }
    finally { setBusy(false) }
  }
  if (sent) return <PublicShell><Card title={es ? 'Revisa tu correo' : 'Check your inbox'}>
    <p>{es
      ? `Mandamos un link de verificación a ${email.trim()}. Haz click para activar tu cuenta (válido 48 h). Sin ese click no hay entrada — así verificamos que el correo institucional .edu te pertenece.`
      : `We sent a verification link to ${email.trim()}. Click it to activate your account (valid 48 h). No click, no entry — that's how we verify the .edu institutional email belongs to you.`}</p>
    <p className="auth-alt"><a href="#/login">{es ? 'Ir al login' : 'Go to login'}</a></p>
  </Card></PublicShell>
  return <PublicShell><Card title={es ? 'Crear cuenta' : 'Create account'}>
    <form onSubmit={submit}>
      <label>{es ? 'NOMBRE' : 'NAME'}<input required value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{es ? 'EMAIL INSTITUCIONAL' : 'INSTITUTIONAL EMAIL'}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@universidad.edu" /></label>
      <label>{es ? 'CONTRASEÑA (MÍN. 8)' : 'PASSWORD (MIN. 8)'}<input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary block" disabled={busy}>{busy ? '…' : (es ? 'Registrarme' : 'Sign up')}</button>
    </form>
    <p className="auth-alt">{es ? 'Aceptamos cualquier correo .edu (.edu, .edu.gt, .edu.mx, .edu.sv, entre otros). Al registrarte aceptas los ' : 'We accept any .edu email (.edu, .edu.gt, .edu.mx, .edu.sv, among others). By signing up you accept the '}<a href="#/terminos">{es ? 'Términos' : 'Terms'}</a>.</p>
  </Card></PublicShell>
}

export function Forgot() {
  const [locale] = useLocale()
  const es = locale === 'es'
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    try { await authFetch('/api/v1/auth/forgot', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }); setDone(true) }
    catch (err) { setError(err instanceof Error ? err.message : 'Request failed') }
  }
  return <PublicShell><Card title={es ? 'Recuperar contraseña' : 'Reset password'}>
    {done ? <p>{es ? 'Si el correo existe, enviamos instrucciones (en el LAB por email; en dev revisa el log del API).' : 'If the email exists, we sent instructions (via email in LAB; check API log in dev).'}</p> : <form onSubmit={submit}>
      <label>{es ? 'EMAIL INSTITUCIONAL' : 'INSTITUTIONAL EMAIL'}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary block">{es ? 'Enviar instrucciones' : 'Send instructions'}</button>
    </form>}
  </Card></PublicShell>
}
