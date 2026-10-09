# {{NAME}} — variante VHDL-2008

Base funcional alternativa: contador con enable, GPIO de salida y PWM 8-bit.
No contiene módulos SystemVerilog mezclados ni testbench de otra arquitectura.
No es una traducción automática del bus/watchdog o del antirrebote de la variante SV.

En el portal use **Simular VHDL**. En el ZIP: `make test` con GHDL.
Resultado esperado: `PASS VHDL GPIO, counter enable, PWM duty and reset`.

Puertos: `clk`, reset activo bajo `rst_n`, `enable` para contar, `write_en` para
cargar `gpio_data`, salida `gpio_out`, cuenta baja `count`, heartbeat `led` y PWM.
La escritura GPIO se acepta incluso con enable=0; enable pausa contador y phase.

`BLINK_BITS=22` controla periodo heartbeat; el test lo reduce a 4.
Duty = valor GPIO/256: 0 apaga y 255 aún tiene un ciclo bajo.
El test comprueba reset, escritura, duty numérico y pausa del contador.
Use numeric_std y conversiones explícitas, no bibliotecas aritméticas no estándar.

PDK asociado: {{PDK}}. La ruta web actual de síntesis/FPGA/ASIC acepta SV/Verilog;
la variante VHDL se valida con GHDL y requiere una ruta de síntesis adicional
antes de programar/fabricar. DEVSIM sigue en el computador cliente.
