# {{NAME}} — adquisición y acondicionamiento de sensor

Dos bloques ejecutables: frente analógico con ganancia y filtro RC, y controlador
digital con promedio de cuatro muestras, calibración signed y saturación.
**Las pruebas analógica y digital son independientes**; no hay ADC físico ni
co-simulación conectada automáticamente entre ambas.

## Primera ejecución

- **Simular RTL**: `PASS sensor averaging, calibration, backpressure and saturation`.
- **Simular SPICE**: transitorio sensor/ADC y barrido AC del filtro.
- ZIP local: `make test` ejecuta ambas regresiones, `make synth` verifica RTL.

## Referencias numéricas

| Prueba | Entrada | Resultado |
|---|---|---|
| Promedio + offset | 100,200,300,400; offset 10 | 260 |
| Signed | -100,-200,-300,-400; offset 10 | -240 |
| Saturación alta | cuatro 32760; offset 20 | 32767 |
| Saturación baja | cuatro -32760; offset -20 | -32768 |
| AFE estable | 0.65 / 0.85 V | 1.45 / 1.85 V, ±0.03 V |
| Ganancia AC baja frecuencia | señal pequeña | ~6.02 dB |

## Modificar

`LOG2_SAMPLES` fija promedio de 2^N muestras; mayor N reduce ancho de banda y
aumenta latencia. El promedio signed trunca hacia menos infinito.
El offset se toma al completar el bloque: manténgalo estable durante el bloque.
Con `out_valid=1 && out_ready=0`, la salida queda estable y se detiene la entrada.
Todo está en un reloj; para ADC con otro reloj utilice FIFO/handshake CDC.

Cambie R/C y ganancia en `analog/afe.spice`; actualice los límites en
`verification/spice_checks.json` y el presupuesto de error en docs.
Para hardware real añada ADC, escala voltaje→código, interfaz SPI y modelo
de ruido. El PDK {{PDK}} no convierte el modelo ideal en un AFE fabricable.
