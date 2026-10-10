# Cola compartida RTL → GDSII

Los flujos físicos se aceptan de forma asíncrona y esperan su turno en un
ejecutor único. Las comprobaciones breves conservan sus rutas actuales. Los
modelos analíticos, las animaciones y DEVSIM local siguen en el computador
cliente y no ocupan esta cola.

## Comportamiento para el usuario

- El envío devuelve `202` únicamente después de guardar el trabajo en el volumen.
- La tarjeta distingue **En cola**, **En ejecución**, **Cancelando** y estados
  finales. Muestra cuántos trabajos hay antes, posición, espera y tiempo de
  ejecución. La posición incluye flujos ejecutándose y pendientes anteriores.
- El orden de admisión es FIFO. Por defecto se ejecuta **un flujo pesado a la vez**.
  Un período de baja CPU entre etapas no habilita un segundo flujo por sí solo.
- El límite por cuenta evita acumular muchas solicitudes. Un proyecto puede
  tener un solo flujo pendiente/activo. Reintentar un envío con el mismo
  `request_id` devuelve el mismo trabajo, incluso si se perdió la primera respuesta.
- Cancelar un pendiente elimina su turno sin iniciar herramientas. Cancelar
  uno activo detiene el grupo de procesos existente; el turno sigue ocupado
  hasta que las herramientas y la recolección del resultado terminan.
- Cerrar el navegador no cancela el trabajo. Al abrir el proyecto con la misma
  cuenta se recupera mediante el identificador guardado o la lista de trabajos
  activos de esa cuenta.
- Los fallos temporales de conexión mantienen el turno y reintentan la consulta.
  Una cola llena responde `429` con `Retry-After: 30`; el usuario puede reintentar
  después o cancelar un trabajo propio.

La cola reduce competencia por recursos; no acorta el tiempo intrínseco de un
flujo. El portal no inventa una hora de finalización: el tamaño del diseño, el
PDK y las etapas pueden cambiar mucho su duración. Verificar y simular antes
de reservar un turno reduce ejecuciones físicas fallidas evitables.

## CPU, memoria y disco

La admisión comprueba cada dos segundos:

1. CPU del contenedor, medida mediante cgroups v2 o v1 y normalizada por su cuota
   y afinidad. En un contenedor con cuatro CPU, 280 % en la medida por núcleo
   equivale a 70 % de su capacidad. También revisa CPU del host para respetar
   los otros contenedores del servidor.
2. Uso de CPU de cada árbol de procesos físico, normalizado por esa capacidad.
   Una medición superior al umbral del **60 %** bloquea nuevas admisiones.
3. Cantidad máxima de flujos activos, contando también los que se están cancelando.
4. Memoria disponible del host y del contenedor. La caché de archivos inactivos
   puede reclamarse; la admisión reserva margen más una estimación configurable
   de memoria para el nuevo flujo.
5. Espacio libre en el volumen de trabajos.

Si faltan recursos, el trabajo conserva su turno e informa el motivo. Al arrancar
el ejecutor espera una medición de CPU antes de admitir. Los límites Docker
existentes (cuatro CPU y 6 GiB) siguen siendo el límite efectivo del contenedor;
la admisión es una protección adicional, no una predicción del pico de cada
diseño. LibreLane recibe `--jobs` ajustado a la cuota de CPU y a la concurrencia
configurada.

## Configuración del administrador

Valores predeterminados en `docker-compose.yml`; puede sobrescribirlos en `.env`:

| Variable | Predeterminado | Efecto |
|---|---:|---|
| `OPENSEMILAB_PHYSICAL_MAX_RUNNING` | 1 | Máximo de flujos ejecutándose/cancelando |
| `OPENSEMILAB_PHYSICAL_MAX_PENDING` | 20 | Máximo de pendientes aceptados |
| `OPENSEMILAB_PHYSICAL_PER_USER` | 2 | Máximo de pendientes/activos por cuenta |
| `OPENSEMILAB_PHYSICAL_CPU_THRESHOLD` | 60 | Umbral de CPU para nuevas admisiones |
| `OPENSEMILAB_PHYSICAL_MEMORY_RESERVE_MB` | 1024 | Margen de RAM libre |
| `OPENSEMILAB_PHYSICAL_JOB_MEMORY_MB` | 2048 | Estimación de RAM del nuevo flujo |
| `OPENSEMILAB_PHYSICAL_RESULT_RETAIN` | 20 | Máximo de resultados finales guardados |
| `OPENSEMILAB_PHYSICAL_RESULT_RETENTION_DAYS` | 7 | Edad máxima de resultados finales |

Los límites de disco existentes se mantienen: 3072 MB para iniciar un flujo y
512 MB de reserva durante la ejecución. El watchdog de inactividad conserva su
configuración; esperar en cola no consume tiempo de ejecución ni activa ese
watchdog.

Para este servidor con otros contenedores, mantenga concurrencia 1 al empezar.
Mida picos de memoria y CPU con diseños representativos antes de aumentarla.
Una estimación de 2048 MB no garantiza que un diseño grande quepa en 6 GiB.
Si necesita menos espera total, reduzca complejidad de pruebas, elimine fallos
previos y evalúe más recursos; subir la concurrencia sin margen puede empeorar
el tiempo de todos.

## Persistencia y reinicios

El directorio `physical-queue` del volumen `opensemilab-jobs` contiene registros
JSON privados, escritos mediante reemplazo atómico y `fsync`. Incluyen la copia
de fuentes de los pendientes, metadatos del propietario y estados; los resultados
finales se leen desde disco para no mantener grandes paquetes en RAM. El estado
y la última salida se guardan periódicamente durante una ejecución.

Al reiniciar:

- Los pendientes recuperan el orden por fecha de aceptación y se admiten cuando
  hay recursos.
- Los que estaban ejecutándose/cancelando quedan **interrumpidos**, con registro
  y estado de fallo. No se repiten automáticamente; el usuario revisa y reenvía.
- Los ya cancelados no vuelven a la cola.
- Resultados finales se conservan según **ambos** límites de cantidad y edad.

Descargue los artefactos al terminar y conserve fuentes/configuración. El historial
del navegador contiene resúmenes, no un archivo permanente de resultados.
Si la máquina se apaga durante una herramienta, pueden quedar directorios
temporales `job-*` de esa ejecución; el administrador debe revisar y liberar ese
espacio antes de volver a admitir si aparece el aviso de disco.

## Contrato y separación por usuario

La API deriva el propietario de la sesión verificada. Ignora identidades enviadas
en el cuerpo o en cabeceras del navegador y añade su propia cabecera interna al
ejecutor. Este permanece en la red interna Docker; no publique su puerto.

| Ruta pública | Uso |
|---|---|
| `POST /api/v1/eda/jobs` | Aceptar RTL→GDSII; opciones, `project_id` y `request_id` |
| `GET /api/v1/eda/jobs` | Recuperar trabajos activos de la cuenta |
| `GET /api/v1/eda/jobs/{id}` | Estado, turno y resultado del trabajo propio |
| `POST /api/v1/eda/jobs/{id}/cancel` | Cancelación idempotente del trabajo propio |

Consultar o cancelar un identificador ajeno devuelve `404`. La tarjeta solo
muestra cantidades y carga agregada sobre otros trabajos, sin sus identificadores,
nombres, fuentes ni logs. La ruta síncrona `/eda/run` rechaza `physical` para
evitar saltarse la cola. La API y el ejecutor deben actualizarse juntos.

Esta implementación es para **un proceso y una réplica de eda-worker**. No levante
varias réplicas compartiendo los registros: una expansión distribuida requiere
un coordinador transaccional y asignación de recursos entre ejecutores.

## Validación

Las pruebas cubren FIFO, envíos simultáneos, umbral de CPU normalizado, presión
de memoria/disco, capacidad limitada, propietarios, reintentos, cancelación,
recuperación y retención. Las pruebas de navegador comprueban posiciones,
reconexión, recarga, cancelación, saturación y entrega del resultado al historial.

La [guía completa del portal](portal-guide.md) también explica cómo preparar el
diseño para usar esos turnos con evidencia útil.
