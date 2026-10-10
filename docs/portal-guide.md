# Guía de uso de OpenSemiLab

Abra **Cómo usar** desde el encabezado del laboratorio o desde la barra pública.
La guía está en `#/guia`; el enlace dentro de un proyecto la abre en otra pestaña
para poder consultar las instrucciones mientras trabaja.

La guía ofrece navegación, búsqueda, ES/EN, instrucciones secuenciales,
comprobaciones antes de continuar y capturas reales del portal señaladas con
números. Las capturas usan datos de demostración, no resultados de fabricación.
Pulse una imagen para abrirla completa y leer los controles.

| Capítulo | Contenido |
|---|---|
| Entrar y orientarse | Registro, correo verificado, sesión y navegación |
| Crear, importar y guardar proyectos | Plantillas, JSON, GitHub y copias de fuentes |
| Por qué trabajar en un flujo continuo | Diseño → verificación → simulación → implementación → evidencia y mejora |
| Editar fuentes y documentación | Editor, roles de archivo, módulos top, consola y copias de ejecución |
| Verificar antes de gastar un turno | Lint, síntesis, formal, FPGA y alcance de las comprobaciones |
| Simular y leer ondas o curvas | Testbenches, VCD, SPICE y adaptadores especializados |
| Generar GDSII y gestionar su turno | PDK, reloj, SDC, floorplan, cola y cancelación |
| Analizar, comparar y descargar evidencia | Temporización, layout, sign-off, artefactos e historial |
| Experimentar en el laboratorio de dispositivos | Profundidad, hipótesis, parámetros, animaciones, mediciones y cuaderno |
| Usar DEVSIM en su computador | Servicio del cliente, permisos de origen y refinamiento de malla |
| PDK, herramientas y archivos privados | Inventario, autorización, adaptadores y preparación por capacidad |
| Administración, correo y comunidad | Rol administrador, SMTP, usuarios, actividad y apartados públicos |

El flujo continuo permite detectar errores con comprobaciones breves antes de
usar un turno físico, relacionar restricciones con resultados y comparar cambios
de forma controlada. Cada proyecto conserva contexto para explicar qué se
ejecutó. Las rutas analógica, FPGA y TCAD tienen objetivos distintos del flujo
ASIC; la guía explica cuándo corresponde cada una.

## Actualizar capturas

El contenido vive en `apps/web/src/pages/guideContent.ts`; las imágenes están en
`apps/web/public/guide`. Para regenerarlas con las pantallas actuales:

```bash
cd apps/web
npx playwright install chromium
UPDATE_GUIDE_SCREENSHOTS=1 npx playwright test tests/browser/capture-guide.spec.ts
```

El generador carga el portal real con fixtures de cuenta/proyecto/herramientas,
opera sus controles y añade recuadros numerados mediante DOM antes de capturar.
No modifica controles ni compone pantallas ficticias. Las imágenes y la guía
declaran que los valores son de demostración. La generación es optativa y no
se repite en CI normal; las pruebas de guía comprueban rutas, búsqueda,
navegación, idioma y disponibilidad de todas las capturas publicadas.

Consulte [la cola física](physical-queue.md), [el laboratorio de dispositivos](device-lab.md)
y [la validación DEVSIM local](devsim-validation.md) para los detalles técnicos.
