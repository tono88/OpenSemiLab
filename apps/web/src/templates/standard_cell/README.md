# {{NAME}} — celda inversora CMOS

Base de celda reutilizable con modelo lógico, CMOS transistor-level genérico,
curva de transferencia DC y medidas de retardo sobre una carga de 5 fF.
No depende de {{PDK}} para la primera corrida, pero **no es una celda de esa fundición**.

## Ejecutar

- **Simular RTL**: tabla de verdad 0/1 y comportamiento X/Z.
- **Simular SPICE**: VTC y transitorio con tphl/tplh.
- ZIP: `make test`, `make synth`; `make formal` requiere SymbiYosys y Z3.
- Esperado: `PASS inverter truth table and unknown-state handling` y cuatro
  medidas dentro de `verification/spice_checks.json`.

## Extender

Cambie WN/WP/L en `schematic/inverter.spice` y compare simetría, retardo y carga.
Los anchos están comentados; PMOS es el doble del NMOS en este modelo.
Para NAND/NOR añada RTL, tabla de verdad exhaustiva, esquema transistor-level
y estímulos que ejerciten todos los arcos de temporización.

`characterization/config.yaml` contiene puntos de slew/load para planificar
caracterización. **No se entrega un Liberty ni LEF/GDS inventado**. Para obtenerlos
sustituya modelos genéricos por los de {{PDK}}, cree layout legal, verifique
DRC/LVS/PEX y caracterice cada arco sobre corners reales.
