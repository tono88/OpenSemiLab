import { PublicShell, usePublicLocale } from './shell'

export function Terms() {
  const [locale] = usePublicLocale()
  const es = locale === 'es'
  return <PublicShell><article className="pub-doc">
    <p className="eyebrow">{es ? 'TÉRMINOS Y CONDICIONES' : 'TERMS AND CONDITIONS'}</p>
    <h1>OpenSemiLab</h1>
    <ol>
      <li>{es ? 'Acceso con correo institucional .edu. Cada usuario es responsable de su cuenta y de no compartir credenciales.' : 'Access with institutional .edu email. Each user is responsible for their account and for not sharing credentials.'}</li>
      <li>{es ? 'Uso académico: los experimentos y el solver educativo son material de enseñanza, no aptos para sign-off o fabricación sin validación profesional.' : 'Academic use: experiments and the educational solver are teaching material, not fit for sign-off or fabrication without professional validation.'}</li>
      <li>{es ? 'Los PDK privados que suba cada instalación requieren autorización de licencia previa; OpenSemiLab no otorga derechos de uso sobre PDKs comerciales.' : 'Private PDKs uploaded to each installation require prior license authorization; OpenSemiLab grants no usage rights over commercial PDKs.'}</li>
      <li>{es ? 'Datos de uso: registramos eventos de diseño (herramienta, acción, proyecto) para mejorar la plataforma y con fines de investigación educativa. Ver Privacidad.' : 'Usage data: we log design events (tool, action, project) to improve the platform and for educational research. See Privacy.'}</li>
      <li>{es ? 'El código original de OpenSemiLab es Apache-2.0; motores externos y PDKs conservan sus licencias.' : 'OpenSemiLab original code is Apache-2.0; external engines and PDKs keep their own licenses.'}</li>
    </ol>
  </article></PublicShell>
}

export function Privacy() {
  const [locale] = usePublicLocale()
  const es = locale === 'es'
  return <PublicShell><article className="pub-doc">
    <p className="eyebrow">{es ? 'AVISO DE PRIVACIDAD' : 'PRIVACY NOTICE'}</p>
    <h1>{es ? 'Qué datos usamos y para qué' : 'What data we use and why'}</h1>
    <ol>
      <li>{es ? 'Cuenta: correo institucional, nombre y hash de contraseña. Nunca guardamos contraseñas en claro.' : 'Account: institutional email, name and password hash. We never store plain-text passwords.'}</li>
      <li>{es ? 'Proyectos: cada proyecto pertenece a su usuario; nadie más puede verlo salvo administradores del laboratorio con fines de soporte e investigación.' : 'Projects: each project belongs to its user; nobody else can see it except lab admins for support and research.'}</li>
      <li>{es ? 'Analítica educativa: eventos de diseño agregados (qué herramientas se usan, errores frecuentes) para mejorar la enseñanza. No vendemos ni compartimos datos con terceros.' : 'Educational analytics: aggregated design events (which tools are used, frequent errors) to improve teaching. We do not sell or share data with third parties.'}</li>
      <li>{es ? 'Galería abierta: por diseño estilo Tinkercad, tus proyectos son visibles y clonables por cualquier cuenta .edu desde la Galería.' : 'Open gallery: Tinkercad-style, your projects are visible and cloneable by any .edu account from the Gallery.'}</li>
      <li>{es ? 'Puedes pedir la eliminación de tu cuenta y tus datos escribiendo a tu administrador del laboratorio.' : 'You can request deletion of your account and data by writing to your lab administrator.'}</li>
    </ol>
  </article></PublicShell>
}
