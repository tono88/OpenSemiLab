# Laboratorio de dispositivos y fabricación

El apartado **Laboratorio de dispositivos** contiene 33 dispositivos y módulos,
63 prácticas guiadas y cinco niveles de profundidad. Los modelos del catálogo
se ejecutan en un Web Worker del navegador; las animaciones usan Canvas en ese
mismo equipo. La unión PN también permite usar el companion DEVSIM instalado
en el computador del cliente.

El catálogo entrega referencias analíticas y modelos compactos con ecuaciones,
unidades, supuestos y fuentes visibles. No presenta esas curvas como mediciones
ni como una simulación TCAD de todos los dispositivos. La investigación puede
usar las referencias para construir hipótesis, comparar datos y documentar
experimentos, conservando el alcance de cada modelo.

## Empezar

1. Abra el laboratorio y seleccione **Laboratorio de dispositivos** en el menú
   superior. El **Estudio de diseño** conserva sus proyectos, editor y consola.
2. Busque un dispositivo o filtre por familia. La selección ejecuta su
   configuración inicial en el cliente.
3. Lea las unidades, formule una hipótesis y pulse **Guardar referencia**.
4. Cambie una variable y pulse **Ejecutar experimento**. Mientras la entrada
   esté modificada, las gráficas y exportaciones conservan la última ejecución.
5. Compare curvas, revise comprobaciones y escriba observaciones/conclusiones.
6. Exporte el JSON para conservar los parámetros, datos y cuaderno fuera del
   navegador. Exporte cada curva en CSV y cada figura en SVG.

Las entradas aceptan notación científica, por ejemplo `1e16`. Los rangos se
validan antes de ejecutar; un campo inválido bloquea el cálculo. Algunas
combinaciones requieren restricciones físicas adicionales y muestran una
explicación. **Restaurar parámetros iniciales** recupera una ejecución válida.
El muestreo ofrece 101, 201, 501 o 1001 puntos.

## Profundidad

| Nivel | Uso principal | Contenido |
| --- | --- | --- |
| Explorar | Primera aproximación, con acompañamiento para niños | Analogías, controles principales, dibujos, animaciones, primeras prácticas y unidades |
| Aprender | Fundamentos de electrónica | Prácticas adicionales de portadores, barreras, luz y constantes de tiempo |
| Diseñar | Ingeniería y comparación paramétrica | Todos los parámetros, barridos de cinco valores y Monte Carlo de 10/20/40 muestras |
| Avanzado | Caracterización | Mediciones CSV, residuos, regresión y TCAD local de la unión PN |
| Investigación | Trabajo reproducible | Extracción de idealidad/C–V, conservación de dosis, configuración exacta y todos los experimentos |

Las ecuaciones, límites y comprobaciones están disponibles desde el inicio.
Cambiar el nivel mantiene el dispositivo y la entrada; seleccionar otra
práctica carga su configuración y su cuaderno particular.

## Catálogo implementado

| Familia | Dispositivo o módulo | Curvas y magnitudes | Modelo y límite principal |
| --- | --- | --- | --- |
| Materia | Silicio y dopaje | n(T), p(T), conductividad, Eg y resistividad | Neutralidad, np = ni², Varshni y movilidad térmica ilustrativa; estadística no degenerada |
| Materia | Deriva y difusión | Densidad espacial, Jn de deriva/difusión/total, longitud de difusión | Perfil lineal prescrito y relación de Einstein; no resuelve continuidad espacial |
| Materia | Resistor semiconductor | I–V, potencia y resistencia geométrica | Región N uniforme, conducción óhmica sin autocalentamiento |
| Materia | Efecto Hall | VH(B), coeficiente y sensibilidad | Un portador electrónico, factor Hall = 1 |
| Diodos | Unión PN | Potencial, campo, carga, n/p, Ec/Ev, I–V y C–V | Agotamiento abrupto; Shockley usa Is y n independientes de los perfiles |
| Diodos | PIN | Curvas PN, capacitancia y tránsito estimado | Capa I agotada; tránsito con velocidad supuesta, sin modulación de conductividad |
| Diodos | Zener/avalancha | I–V, potencia y conductancia diferencial | Rama de ruptura lineal parametrizada; no calcula ionización por impacto |
| Diodos | Schottky | I–V, conductancia e Is(T,ΦB) | Emisión termoiónica; sin resistencia serie ni reducción de barrera |
| Diodos | Varactor | C(VR) y 1/C² | Unión abrupta inversa; no incluye ruptura ni resistencia serie |
| Diodos | Túnel | I–V y conductancia negativa | Forma fenomenológica, sin cálculo de transmisión cuántica |
| Luz | LED | I–V con Rs, potencia óptica/eléctrica y longitud de onda | Ecuación implícita; EQE/energía independientes con comprobación de balance energético |
| Luz | Fotodiodo | I–V iluminada/oscura, respuesta RC y responsividad | EQE fija; ancho de banda RC sin tiempo de tránsito |
| Luz | Celda solar | I–V, potencia, Voc, MPP, FF y eficiencia | Diodo ideal; MPP por raíz de d(VI)/dV, con revisión de energía incidente |
| Transistores | BJT NPN | IC/IB/IE frente a VCE, Gummel, β y gm | Ebers–Moll, reciprocidad y KCL; Early aplicado en activa |
| Transistores | BJT PNP | Curvas BJT con signos invertidos | Corrientes positivas entrando al terminal; magnitudes editables en controles |
| Transistores | MOSFET NMOS | Familia ID–VDS, transferencia, gm y Cox | Canal largo, transición subumbral suavizada y λ; sin DIBL ni efectos cuánticos |
| Transistores | MOSFET PMOS | Curvas MOS con tensiones/corrientes negativas | Misma referencia de canal largo, controles de magnitud |
| Transistores | JFET N | Transferencia y salida | Parábola de Shockley y continuidad entre región óhmica y saturación |
| Transistores | Capacitor MOS | C–V LF/HF, ψs, Qs y Vth | Poisson–Boltzmann superficial; HF por agotamiento máximo, sin frecuencia explícita |
| Transistores | IGBT | IC–VCE y pérdidas de conducción | Equivalente estático habilitado por puerta, sin plasma ni conmutación |
| Transistores | SCR/tiristor | Rampas ascendente/descendente e histéresis | Circuito con carga, pulso y corriente de mantenimiento; no es una I–V intrínseca |
| Circuitos | Inversor CMOS | Vout(Vin), corriente estática, ganancia y conmutación | Equilibrio numérico de corrientes NMOS/PMOS; sin transitorio ni proceso calibrado |
| Circuitos | RC | Carga, corriente, Bode y fase | Solución exacta del circuito ideal de primer orden |
| Circuitos | RLC serie | Amplitud, fase, f0, Q y ancho de banda | Impedancia ideal; un pico muy estrecho requiere mayor muestreo |
| Circuitos | Rectificador de puente | Entrada AC, rectificación, filtrado y rizado | Dos caídas fijas; descarga exponencial entre muestras y revisión de paso temporal |
| Portadores | Recombinación SRH | Transitorio RK4, límite exponencial, U y vida efectiva | Trampa a mitad de banda, τn = τp; sin Auger ni recombinación radiativa |
| Fabricación | Difusión | Predeposición erfc, redistribución gaussiana y dosis | D constante, medio semiinfinito; distingue dosis total de dosis en la ventana |
| Fabricación | Implantación/recocido | Gaussiana inicial/final, dispersión y dosis visible | Línea infinita, σ² = σ0² + 2Dt; informa masa en x < 0, sin activación eléctrica |
| Fabricación | Oxidación | Espesor, Si adicional consumido y x² + Ax | Deal–Grove con óxido inicial; A/B editables del proceso y límite ultradelgado |
| Fabricación | Fotolitografía | CDmin(NA), DOF(NA) e intensidad conceptual | Rayleigh; imagen sinusoidal prescrita, sin difracción ni resist |
| Fabricación | Grabado | Profundidad, máscara restante y socavado | Velocidad/selectividad fijas; detiene el régimen protegido al agotar máscara |
| Fabricación | Deposición | Espesor temporal/radial y resistencia de hoja | Perfil radial prescrito, Rs = ρ/h; sin nucleación ni dependencia de ρ con h |
| Fabricación | Rendimiento de oblea | Rendimiento contra área y defectos esperados | Poisson y binomial negativo; no predice el yield de una fundición concreta |

La referencia de silicio usa ni(300 K) = 10¹⁰ cm⁻³, εSi = 11.7 ε0,
εSiO₂ = 3.9 ε0 y una ley térmica explícita de movilidad. Las constantes q,
kB, h y c siguen las definiciones SI. Una concentración de dopaje elevada,
la aproximación de banda plana, un Q alto o una entrada de luz incompatible
activan avisos específicos. Los exponentes que exceden el rango numérico
rechazan la ejecución, evitando una meseta artificial de corriente.

## Prácticas y recorrido de fabricación

Cada módulo tiene una práctica inicial con cuatro pasos. Las treinta prácticas
adicionales recorren acción de masas, Einstein, polarización, neutralidad
asimétrica, idealidad, C–V, capacidad/tránsito, ruptura/potencia, óptica, MPP,
regiones BJT, gm, capacitor MOS, pinzamiento, inversor, RC, RLC, rizado,
vida media, dosis, recocido, oxidación, litografía, máscara, resistencia de
hoja y rendimiento.

El recorrido de fabricación muestra doce etapas seleccionables, desde cristal
y oblea hasta encapsulado. Cada etapa puede abrir el experimento relacionado.
Los cortes SVG describen un transistor planar de forma didáctica. No son una
receta de proceso, un dibujo a escala ni una animación de un solver de fabricación.

Para una primera clase, una secuencia corta es **Silicio y dopaje → Unión PN →
LED → RC**. Para una práctica de ingeniería, use **Varactor → BJT → MOSFET →
CMOS**. Para caracterización, utilice los niveles Avanzado/Investigación y
conserve temperatura, geometría, unidades e incertidumbres de las mediciones.

## Gráficas y comparación

Las figuras permiten cursor, zoom y desplazamiento horizontal. Algunas curvas
añaden automáticamente una comparación pertinente: Ec/Ev, capacitor MOS LF/HF,
familia de salida MOS, recombinación SRH/límite exponencial y subida/bajada SCR.
**Guardar referencia** conserva una ejecución previa para superponerla después
de variar la entrada.

Los ejes logarítmicos sólo incluyen valores positivos. La interfaz informa cuántos
puntos nominales omite; las exportaciones CSV/JSON mantienen ceros, negativos y
todos los valores originales. La escala de frecuencia comienza en log X.

El SVG conserva el zoom/desplazamiento actual y resuelve los estilos en el
archivo. Sus metadatos indican modelo, revisión, entrada, escalas y clases de
datos de las superposiciones. El CSV entrega la curva seleccionada completa
con unidades en el encabezado. Son formatos editables para preparar una figura;
el usuario debe documentar origen, condiciones y límites al compartirla.

## Barridos y Monte Carlo

Un barrido usa cinco valores: nominal multiplicado por 1 + {-1, -0.5, 0, 0.5, 1}
por la variación porcentual. Monte Carlo usa una distribución normal con
desviación estándar σ = |nominal| por la variación porcentual y una semilla
uint32 reproducible. La implementación conserva la semilla y cada configuración.

Seleccione un parámetro nominal distinto de cero. No se recortan muestras a los
límites: una distribución fuera de rango obliga a reducir σ o cambiar el
nominal. Las restricciones acopladas de los modelos también pueden rechazar una
muestra. Las estadísticas describen las ejecuciones aceptadas de un estudio
completo, no una distribución truncada silenciosamente.

La gráfica muestra hasta ocho ejecuciones para mantener la lectura. El
histograma, media, desviación estándar muestral y percentiles P05/P50/P95 incluyen
todas las muestras, al igual que el JSON. Estos percentiles no son intervalos de
confianza ni incertidumbres instrumentales; los parámetros estadísticos son
supuestos del usuario, no tolerancias de un proceso certificado.

## Mediciones y extracción

En Avanzado/Investigación, seleccione la curva y confirme las unidades antes de
importar. El CSV admite dos o tres columnas numéricas, un encabezado opcional,
punto decimal, separador coma/punto y coma/tabulador y líneas de comentario #.
Los límites son 2 MB y 10 000 puntos. Ejemplo de formato:

```csv
Voltage,Current,Sigma
0.20,0.000001,0.00000001
0.30,0.000010,0.00000010
0.40,0.000100,0.00000100
```

Este ejemplo describe columnas, **no una medición real**. σy, cuando existe,
debe ser positiva en todas las filas y representa incertidumbre estándar
absoluta de y, en sus unidades originales. No se ajusta incertidumbre en x.

El modelo se interpola linealmente en el dominio de la curva; los puntos fuera
quedan excluidos de RMSE, MAE, R² y residuos. Se necesitan al menos tres puntos
comparables. Se muestran hasta 500 marcas para mantener el rendimiento, y se
exportan todas las mediciones.

El ajuste y = ax + b admite límites de x. Con σy utiliza pesos 1/σy² y
covarianza de incertidumbre absoluta; sin σy estima varianza residual. Los
errores de pendiente/intercepto son estándar 1σ. En una rama I–V positiva
puede extraer n e Is de ln(I) frente a V:

- pendiente = 1/(n VT), intercepto = ln(Is);
- σln(I) ≈ σI/I cuando la incertidumbre relativa es pequeña;
- la interpretación requiere región exponencial, I mucho mayor que Is y
  contribuciones serie/alta inyección despreciables.

Un buen R² no identifica por sí solo un mecanismo ni calibra un dispositivo.
El JSON conserva el archivo importado, sus puntos, σy, ajuste y cuaderno. Para
extraer dopaje a partir de C–V recuerde que 1/C² se grafica en pF⁻² y que la
fórmula física requiere F y área en cm².

## Cuaderno y reproducibilidad

El cuaderno guarda hipótesis, observaciones, conclusión y marca de completado
por práctica en localStorage. Es local a ese navegador; exporte antes de cambiar
de equipo o borrar datos. Si no hay espacio disponible, la interfaz indica que
debe exportar para conservarlo.

El JSON `opensemilab.device-lab/1` incluye:

- SHA-256 de la revisión y configuración realmente ejecutada;
- entrada completa, modelo, revisión, curvas, métricas y comprobaciones;
- constantes SI, supuestos, ecuaciones y referencias;
- cuaderno, mediciones/ajustes asociados y estudio con todas las muestras;
- clasificación de ejecución `client-browser`, `authoritative: false` y
  `measured: false` para el resultado analítico.

La huella de entrada identifica condiciones y revisión; **no es una firma del
contenido completo ni una certificación de resultados**. La descarga con
SHA-256 requiere el contexto seguro HTTPS o localhost del navegador.
Las mediciones importadas se conservan por separado del resultado calculado.

## Animaciones y carga del cliente

Las animaciones de electrones/huecos/fotones se generan localmente. Comienzan
pausadas, ofrecen 20/40/80 partículas y 0.5/1/2× de velocidad visual. El máximo
es 30 fps y resolución Canvas limitada a 2×. Un IntersectionObserver y la
visibilidad de la pestaña suspenden requestAnimationFrame fuera de pantalla;
no se envían solicitudes de simulación por animar.

Los controles visuales no cambian las curvas. Posiciones, cantidades, velocidad
y eventos de fotones son conceptuales, no muestras de TCAD. Los ejemplos de
unión separan deriva, difusión y movimiento neto; MOS/BJT usan su representación
propia. CMOS, SCR y JFET conservan sus curvas y explicaciones sin mostrar un
dibujo genérico incorrecto de una unión PN.

El cálculo analítico y los estudios corren en un Worker separado del hilo de
interfaz. **Cancelar cálculo** termina ese Worker. Cambiar de experimento
termina el anterior y rechaza respuestas antiguas. El laboratorio se carga
por separado al abrirlo; no se incluye un motor de animación en el servidor.

## DEVSIM en el computador del cliente

Para la **Unión PN**, abra Avanzado o Investigación y pulse **Abrir DEVSIM
local y validación de malla**. Desde una copia del repositorio en su equipo:

```bash
./scripts/install-devsim-local.sh
```

En Windows:

```powershell
.\scripts\install-devsim-local.ps1
```

Autorice `https://opensemilab.tecnodyne.com` mediante
`OPENSEMILAB_ALLOWED_ORIGINS` al iniciar el companion. El navegador llama
directamente a `http://127.0.0.1:8787`; no envía esta simulación al servidor
Azure/B4. La configuración de URL local existente sigue disponible mediante
`VITE_DEVSIM_LOCAL_URL`.

Puede cambiar longitud y malla, ejecutar TCAD, validar mallas 51/101/201,
exportar resultado/validación y comparar un paquete TCAD anterior. Las curvas
locales son independientes de las del catálogo y advierten si la entrada cambió.
Los umbrales y alcance se documentan en
[devsim-validation.md](devsim-validation.md). La convergencia numérica tampoco
sustituye una comparación calibrada con hardware.

## Verificación del código

```bash
cd apps/web
npm test
npm run build
npm run test:browser
```

Las pruebas numéricas ejecutan los 33 valores iniciales y las 63 configuraciones
de guía. Contrastan referencias PN, neutralidad/acción de masas, Einstein,
signos/KCL, MOS y raíces de puerta, óptica/MPP/energía, SCR, RC/RLC, SRH,
dosis, oxidación, máscara, uniformidad, rendimiento y Monte Carlo reproducible.
La importación/estadística se verifica con datos sintéticos identificados como
fixtures, con incertidumbres y sin extrapolación.

Las pruebas Chromium recorren los módulos reales, referencias/exportaciones,
Monte Carlo, cuaderno persistente, mediciones/ajustes, pausa de animaciones,
fabricación, traducciones y vista móvil. El companion conserva además su suite
de integración DEVSIM y las comprobaciones documentadas de malla.

## Referencias

- [MIT 6.012, Microelectronic Devices and Circuits](https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-spring-2009/pages/lecture-notes/)
- [MIT 6.774, Physics of Microfabrication](https://ocw.mit.edu/courses/6-774-physics-of-microfabrication-front-end-processing-fall-2004/)
- [PVEducation, Solar cell operation](https://www.pveducation.org/pvcdrom/solar-cell-operation/solar-cell-operation)
- [NIST, SI and fundamental constants](https://physics.nist.gov/cuu/Constants/)
- [Deal y Grove, General Relationship for the Thermal Oxidation of Silicon, 1965](https://doi.org/10.1063/1.1713945)
- [DEVSIM](https://devsim.org/)
