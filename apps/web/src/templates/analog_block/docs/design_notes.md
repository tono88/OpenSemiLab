# Cálculos de partida y límites

Ganancia cerrada ideal: Av = 1+RF/RG = 5.
Con A0=10000 y FP=100 Hz, GBW aproximado=1 MHz y ancho de banda cerrado≈200 kHz.
Ganancia en dB=20*log10(5)=13.98 dB. La entrada está centrada en 0.92 V; con
referencia de 0.9 V, la salida nominal es 0.9+5*(0.92-0.9)=1.0 V.

El modelo usa una resistencia de salida de 20 ohmios y una carga nominal de
1 pF. No tiene límites de rails, corriente, slew ni segundo polo; por eso no
sirve para demostrar margen de fase de un opamp real ni ruido equivalente.

## Extensión profesional

1. Describa corriente máxima, carga y rango de entrada/salida del circuito real.
2. Seleccione topología y calcule gm, overdrive, compensación y bias.
3. Incluya modelos PDK y esquinas TT/FF/SS autorizadas.
4. Mida estabilidad del lazo, CMRR, PSRR, ruido y slew de subida/bajada.
5. Ejecute mismatch con modelos estadísticos; no varíe números sin distribución documentada.
6. Realice extracción y repita los criterios numéricos post-layout.
