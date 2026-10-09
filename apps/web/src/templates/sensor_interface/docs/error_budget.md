# Presupuesto de error e integración

Modelo de transferencia: Vadc = 1.65 + 2*(Vsensor-0.75), filtrado con RC 220 us.
Frecuencia de corte aproximada: 1/(2*pi*2200*100e-9) = 723 Hz.
El promedio digital de cuatro muestras es un filtro boxcar, no un filtro
antialias suficiente por sí solo. Seleccione frecuencia de muestreo coherente.

Antes de conectar una fuente real registre: impedancia del sensor, sensibilidad,
rango, tolerancia R/C, offset, ruido, cuantización ADC y deriva térmica.
Una conversión ADC de N bits usa q = Vfullscale/(2^N-1).
No mezcle códigos unsigned del ADC con la interfaz signed sin centrar/escalar.

## Pruebas pendientes al extender

- Escala de voltaje→código y recuperación de unidades físicas.
- Interrupción de un bloque incompleto con reset.
- Throughput y cambios de configuración entre bloques.
- ADC fuera de rango y fallo/desconexión del sensor.
- PVT, ruido, saturación y consumo del AFE real.
- DRC/LVS/PEX después de implementar layout.
