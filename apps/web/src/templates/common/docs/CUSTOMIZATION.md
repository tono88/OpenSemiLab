# Cómo modificar el proyecto

## Método recomendado

1. Exporte un respaldo o cree un proyecto nuevo antes de cambiar interfaces.
2. Describa la nueva función y un resultado numérico verificable.
3. Cambie primero los parámetros documentados; conserve el caso de referencia.
4. Agregue un caso al banco de pruebas que falle con el comportamiento anterior.
5. Implemente el cambio, ejecute todas las pruebas y compruebe reset y límites.
6. Actualice puertos, mapa de registros, medidas y restricciones afectados.
7. Revise síntesis, temporización y consumo antes de llevar el cambio a hardware.

## Archivos y roles

- `source`: HDL sintetizable. No coloque retardos `#`, estímulos ni `$finish`.
- `testbench`: estímulos, comprobaciones, simulaciones y medidas.
- `constraint`: temporización o pines; deben corresponder al hardware real.
- `configuration`: manifiestos y recetas. El formal tiene fuentes propias.
- `documentation`: especificaciones, decisiones y scripts auxiliares locales.
- `simulation`: subcircuitos/modelos y entradas analógicas.
- `layout`: notas y archivos de geometría, nunca una certificación automática.

Las pruebas digitales tienen límites de tiempo y usan `$fatal`/`assert` para
fallar de forma explícita. Un mensaje `PASS` se emite solo después de los checks.
Cambie el banco de pruebas si modifica una especificación, no para ocultar fallos.

## Lo que no se debe asumir

- No hay un núcleo RISC-V completo escondido en un ejemplo de periféricos.
- Un macromodelo lineal no predice saturación, ruido, mismatch o PVT real.
- Los modelos MOS genéricos no son modelos calificados de {{PDK}}.
- Las respuestas de una red RF concentrada no son una extracción EM de layout.
- Las asignaciones libres de pines FPGA no sirven para programar una placa.
- Un GDS generado aún requiere revisión DRC/LVS/PEX y aprobación de fundición.
