# {{NAME}} — red de adaptación RF

Base ejecutable de una red LC pasiva, con respuesta AC SPICE, análisis ABCD,
parámetros S y exportación Touchstone. No se hace pasar una fuente ideal por
un LNA ni se promete figura de ruido de un transistor inexistente.

## Ejecutar

En **Simulación → Simular SPICE**, observe respuesta de voltaje y fase.
En una copia ZIP:

```sh
make test
python3 scripts/rf_network.py --l-nh 4.7 --c-pf 1.0 --points 121
```

El análisis RF genera `build/matching.s2p` y `build/sparameters.csv` y comprueba
reciprocidad y conservación de potencia en ambos puertos.
`make test` valida también las medidas del netlist nominal.

## Qué se mide

La fuente SPICE es Thevenin con 50 ohmios: Vout/Vsource tiende a 0.5 en baja
frecuencia (-6.02 dB). El S21 de una red adaptada ideal tiende a 1 (0 dB).
No confunda estas dos normalizaciones. ABCD usa S11,S21,S12,S22 en ese orden
Touchstone, con referencia real de 50 ohmios.

## Extensión

Cambie L/C en `schematic/matching.spice` y los argumentos del script analítico.
Añada resistencias de pérdida y modifique ABCD antes de exigir conservación
lossless. Un LNA real necesita modelos {{PDK}}, bias, estabilidad K/μ, NF,
compresión y linealidad. La ruta EM se documenta en `em/README.md`;
no contiene un XML vacío que parezca producir S-parámetros de un layout.
