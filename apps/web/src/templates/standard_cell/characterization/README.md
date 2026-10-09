# De la simulación a una librería de celdas

La referencia mide VTC, VOH, VOL, tphl y tplh. El retardo depende de la carga
y del slew de entrada, por eso una medición de un único punto no es Liberty.

1. Sustituya NMOS_DEMO/PMOS_DEMO por modelos y geometrías legales de {{PDK}}.
2. Barra slew y capacitancia según config.yaml para cada corner PVT.
3. Mida rise/fall delay, transition, energía y leakage con unidades explícitas.
4. Genere tablas Liberty sin interpolar fuera del rango medido.
5. Verifique función, convenciones de umbrales, rails y nombres de pins.
6. Cree LEF/GDS con altura, pitch y acceso a pines adecuados; luego DRC/LVS/PEX.
7. Compare el modelo post-layout contra las tablas y versione modelos/decks.

No ejecute RTL→GDSII como si `inverter` fuera un bloque con reloj `clk`:
es una celda combinacional y requiere un flujo de librería/custom layout.
Prueba formal: función binaria solamente; no prueba niveles analógicos.
