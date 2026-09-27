import { useAuth, useLocale } from '../auth'

function TopBar({ onNav }: { onNav: (h: string) => void }) {
  const { user, logout } = useAuth()
  const [locale, setLocale] = useLocale()
  return <header className="pub-top">
    <div className="brand" onClick={() => onNav('#/')} style={{ cursor: 'pointer' }}><div className="mark">OS</div><div><strong>OpenSemiLab</strong><small>UNIS · LAB</small></div></div>
    <nav className="pub-links">
      <button onClick={() => onNav('#/equipo')}>Equipo</button>
      <button onClick={() => onNav('#/terminos')}>Términos</button>
      <button onClick={() => onNav('#/privacidad')}>Privacidad</button>
      {user ? <>
        <button className="cta" onClick={() => onNav('#/lab')}>Entrar al Lab →</button>
        <button onClick={logout} title={user.email}>Salir</button>
      </> : <>
        <button onClick={() => onNav('#/login')}>Login</button>
        <button className="cta" onClick={() => onNav('#/registro')}>Registro →</button>
      </>}
      <span className="lang"><button className={locale === 'es' ? 'active' : ''} onClick={() => setLocale('es')}>ES</button><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button></span>
    </nav>
  </header>
}

export function go(hash: string) { location.hash = hash }

export function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="app-shell pub"><TopBar onNav={go} /><main className="pub-main">{children}</main>
    <footer><span>OPEN SEMILAB · UNIVERSIDAD DEL ISTMO</span><span><a href="#/equipo">Equipo</a> · <a href="#/terminos">Términos</a> · <a href="#/privacidad">Privacidad</a> · <a href="https://github.com/tono88/OpenSemiLab">GitHub ↗</a></span></footer></div>
}

export function usePublicLocale() { return useLocale() }
