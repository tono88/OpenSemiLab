# Revisión antes de entregar

## Función

- [ ] Las pruebas de referencia pasan sin cambiar los criterios para esconder un fallo.
- [ ] Hay pruebas del reset, condiciones nominales y extremos de la interfaz.
- [ ] Las unidades, anchos de palabra, polaridades y dominios de reloj están descritos.
- [ ] Un caso incorrecto produce un error, no únicamente una onda diferente.

## Reproducibilidad

- [ ] `make check` y `make test` pasan desde una carpeta recién extraída.
- [ ] Se guardaron versiones de herramientas y parámetros de las corridas.
- [ ] El JSON y las fuentes ZIP contienen la misma configuración.
- [ ] Los modelos externos y el hardware usados están identificados.

## Implementación real

- [ ] La placa FPGA tiene pines, tensiones y reloj correctos.
- [ ] El PDK real sustituye los modelos genéricos cuando corresponde.
- [ ] Se revisaron tiempos, área, CDC/reset, integridad y márgenes.
- [ ] Hay DRC/LVS/PEX y simulación post-layout si se pretende fabricar.
- [ ] La evidencia de sign-off no se confunde con la prueba de la plantilla.

Estas plantillas son bases funcionales modificables, no IP certificada para producción.
