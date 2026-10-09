# {{NAME}} — amplificador analógico

Amplificador no inversor de ganancia 5 con macromodelo de un polo. Incluye
operating point, respuesta AC, transitorio, medidas y regresión numérica.
Funciona sin descargar modelos de un PDK. El PDK elegido es {{PDK}}.

## Ejecutar

En **Simulación → Simular SPICE**, revise tablas y gráficas. En una copia ZIP:

```sh
make test
python3 scripts/sweep_macromodel.py
```

La prueba nominal valida ganancia baja frecuencia ~13.98 dB, caída a 10 MHz,
y salida transitoria aproximadamente 0.90..1.10 V. Los límites están en
`verification/spice_checks.json`; se exige que todas las medidas existan.

## Qué modificar

- `RF/RG`: ganancia cerrada; ambos retornan respecto a VREF cuando corresponde.
- `A0`: ganancia de lazo abierto; `FP`: polo dominante; GBW aproximado A0*FP.
- `CL`: carga capacitiva; revise estabilidad al aumentar la carga.
- `VIN`: offset y amplitud, verificando headroom antes de simular un modelo real.

`sweep_macromodel.py` compara tres ganancias idealizadas: **no es PVT real**.
Para obtener consumo, ruido, slew rate, saturación y mismatch sustituya el
macromodelo por un circuito transistor-level de {{PDK}} y añada los corners
de sus modelos. No hay esquemático gráfico generado que represente falsamente
este circuito: el netlist SPICE es la fuente ejecutable de referencia.

Lea `docs/design_notes.md` y `layout/floorplan.md` antes de convertirlo a layout.
