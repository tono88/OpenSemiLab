# {{NAME}} — prototipo FPGA con PWM

Demo funcional con LED heartbeat, dimmer PWM de 8 bits y botón con sincronizador
y antirrebote. Arranca a duty 64/256; cada pulsación aumenta 16/256 y hace wrap.

## Ejecución

**Simulación → Simular RTL** verifica duty, glitch, pulsación sostenida y reset.
Resultado esperado: `PASS FPGA PWM duty, debounce and reset`.
Fuera del portal: `make test` y `make synth`.

Para **Implementar FPGA**, el adaptador actual usa iCE40 UP5K / SG48 a 12 MHz.
Cambie dispositivo, package y frecuencia al hardware real; el top solo tiene
cinco pines y no desborda el encapsulado. Complete `constraints/pins.pcf`.
El ASC sin pines asignados sirve para ensayo del flujo, no para programar placa.
La conversión a bitstream y la programación necesitan herramientas de placa.

## Parámetros

- `BLINK_BITS=22`: periodo del heartbeat = 2^22 / f_clk.
- `DEBOUNCE_CYCLES=12000`: 1 ms a 12 MHz. Para 10 ms utilice 120000.
- `level`: duty = level/256; 255 aún tiene un ciclo bajo.
- `pwm8`: frecuencia PWM = f_clk/256, unos 46.875 kHz a 12 MHz.

El test reduce los parámetros temporales, no los anchos de PWM. Prueba 256
ciclos por duty y falla si la cuenta no coincide. Para LEDs activos bajos,
invierta salidas en un wrapper de placa, no en el núcleo reutilizable.

No hay PLL ni segundo reloj: todo utiliza clock enable/lógica síncrona. Para
agregar UART/SPI mantenga este principio y verifique CDC de entradas externas.
PDK {{PDK}} identifica el proyecto ASIC alternativo; no determina los pines FPGA.
