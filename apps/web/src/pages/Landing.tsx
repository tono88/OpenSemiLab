import { PublicShell, go, usePublicLocale } from './shell'

export function Landing() {
  const [locale] = usePublicLocale()
  const es = locale === 'es'
  return <PublicShell>
    <section className="pub-hero">
      <p className="eyebrow">UNIVERSIDAD DEL ISTMO · {es ? 'LABORATORIO DE SEMICONDUCTORES' : 'SEMICONDUCTOR LABORATORY'}</p>
      <h1>{es ? 'Del RTL al silicio,' : 'From RTL to silicon,'}<br /><span>{es ? 'en el navegador.' : 'in the browser.'}</span></h1>
      <p className="lede">{es
        ? 'OpenSemiLab es el laboratorio de semiconductores de la Universidad del Istmo: explore una unión PN desde el navegador o lleve sus diseños hasta implementación RTL-to-GDSII con motores abiertos reales.'
        : 'OpenSemiLab is Universidad del Istmo\u2019s semiconductor laboratory: explore a PN junction from your browser or take your designs all the way to RTL-to-GDSII implementation with real open engines.'}</p>
      <div className="pub-cta-row">
        <button className="btn-primary" onClick={() => go('#/registro')}>{es ? 'Crear cuenta .edu' : 'Create .edu account'}</button>
        <button className="btn-ghost" onClick={() => go('#/login')}>{es ? 'Ya tengo cuenta' : 'I already have an account'}</button>
      </div>
      <small className="pub-note">{es ? 'Acceso con correo institucional .edu (.edu, .edu.gt, .edu.mx, .edu.sv, entre otros).' : 'Access with institutional .edu email (.edu, .edu.gt, .edu.mx, .edu.sv, among others).'}</small>
    </section>
    <section className="pub-grid">
      <div><h3>{es ? 'Device Lab' : 'Device Lab'}</h3><p>{es ? 'Unión PN 1D con solver educativo determinista, curvas I–V, campo y potencial, corners y Monte Carlo reproducible.' : '1D PN junction with deterministic educational solver, I–V curves, field and potential, corners and reproducible Monte Carlo.'}</p></div>
      <div><h3>{es ? 'Design Studio' : 'Design Studio'}</h3><p>{es ? 'Lint, simulación y síntesis SystemVerilog/VHDL, SPICE, formal con SymbiYosys, FPGA iCE40 y flujo físico LibreLane asíncrono hasta GDSII.' : 'SystemVerilog/VHDL lint, simulation and synthesis, SPICE, SymbiYosys formal, iCE40 FPGA and async LibreLane physical flow to GDSII.'}</p></div>
      <div><h3>{es ? 'Progresivo' : 'Progressive'}</h3><p>{es ? 'Cinco modos — Explorar, Aprender, Diseñar, Avanzado, Investigación — sin cambiar el experimento subyacente.' : 'Five modes — Explore, Learn, Design, Advanced, Research — without changing the underlying experiment.'}</p></div>
    </section>
    <section className="pub-stack">
      <p className="eyebrow">{es ? 'CON QUÉ ESTÁ CONSTRUIDO' : 'WHAT IT RUNS ON'}</p>
      <h2>{es ? 'Motores abiertos, resultados verificables.' : 'Open engines, verifiable results.'}</h2>
      <p>{es
        ? 'La ejecución de hardware corre sobre IIC-OSIC-TOOLS (Verible/Verilator, Icarus, GHDL, Yosys, ngspice, Xyce, openEMS, Xschem, CACE, nextpnr, KLayout, Magic, Netgen, OpenROAD/OpenSTA vía LibreLane) con PDKs abiertos SKY130, GF180MCU e IHP. OpenSemiLab orquesta esos motores y normaliza sus resultados — no los reemplaza.'
        : 'Hardware execution runs on IIC-OSIC-TOOLS (Verible/Verilator, Icarus, GHDL, Yosys, ngspice, Xyce, openEMS, Xschem, CACE, nextpnr, KLayout, Magic, Netgen, OpenROAD/OpenSTA via LibreLane) with open SKY130, GF180MCU and IHP PDKs. OpenSemiLab orchestrates those engines and normalizes their results — it does not replace them.'}</p>
      <small>{es ? 'IIC-OSIC-TOOLS es una distribución abierta de herramientas EDA; cada herramienta conserva su propia licencia.' : 'IIC-OSIC-TOOLS is an open distribution of EDA tools; each tool keeps its own license.'}</small>
    </section>
  </PublicShell>
}
