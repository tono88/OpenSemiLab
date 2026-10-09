# {{NAME}} — proyecto estructurado en blanco

Espacio de trabajo sin circuito impuesto. Incluye manifiesto verificable,
guías de diseño, plan de pruebas y criterios de aceptación. `make test` valida
la estructura, **no un diseño que todavía no existe**.

## Elegir un flujo

Para comenzar con un ejemplo funcional ya probado, cree otra instancia de
Microcontrolador, FPGA, Sensor, Analógico, RF o Celda estándar. Esta plantilla
permanece vacía intencionadamente para no mezclar un ejemplo con su diseño.

Para su propio RTL:

1. Cree `rtl/top.sv` con rol source y `tb/tb_top.sv` con rol testbench.
2. En project.json agregue `execution.rtl_top="top"` y
   `execution.testbench_top="tb_top"`.
3. Añada estímulos, comprobaciones y límite de tiempo al banco.
4. Configure Makefile según los comandos de docs/workflows.md.
5. Ejecute análisis, simulación y síntesis antes de implementar.

Para analógico/RF agregue un netlist con .end y .print, un modelo y la ruta
`execution.spice_entry`. No coloque `.end` dentro de subcircuitos incluidos.

PDK asociado: {{PDK}}. Elegirlo no instala modelos ni acredita fabricación.
