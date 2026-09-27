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
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try { await login(email.trim(), password); go('#/lab') }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed') }
    finally { setBusy(false) }
  }
  return <PublicShell><Card title={es ? 'Entrar' : 'Sign in'}>
    <form onSubmit={submit}>
      <label>EMAIL UNIS<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@unis.edu.gt" /></label>
      <label>{es ? 'CONTRASEÑA' : 'PASSWORD'}<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
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
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try { await register(name.trim(), email.trim(), password); go('#/lab') }
    catch (err) { setError(err instanceof Error ? err.message : 'Register failed') }
    finally { setBusy(false) }
  }
  return <PublicShell><Card title={es ? 'Crear cuenta' : 'Create account'}>
    <form onSubmit={submit}>
      <label>{es ? 'NOMBRE' : 'NAME'}<input required value={name} onChange={e => setName(e.target.value)} /></label>
      <label>EMAIL UNIS<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@unis.edu.gt" /></label>
      <label>{es ? 'CONTRASEÑA (MÍN. 8)' : 'PASSWORD (MIN. 8)'}<input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary block" disabled={busy}>{busy ? '…' : (es ? 'Registrarme' : 'Sign up')}</button>
    </form>
    <p className="auth-alt">{es ? 'Solo @unis.edu.gt durante el piloto. Al registrarte aceptas los ' : 'Only @unis.edu.gt during pilot. By signing up you accept the '}<a href="#/terminos">{es ? 'Términos' : 'Terms'}</a>.</p>
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
      <label>EMAIL UNIS<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary block">{es ? 'Enviar instrucciones' : 'Send instructions'}</button>
    </form>}
  </Card></PublicShell>
}
