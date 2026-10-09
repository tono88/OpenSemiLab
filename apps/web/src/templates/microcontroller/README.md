# {{NAME}} — controlador y periféricos

Base funcional de un subsistema digital con GPIO, timer programable y watchdog.
El bus local permite integrar después una CPU o un puente APB/Wishbone.
**No incluye una CPU ni firmware RISC-V**: no se presenta un contador como un SoC completo.

## Primera ejecución

En el portal: **Verificación → Analizar / Sintetizar** y
**Simulación → Simular RTL**. El test esperado termina con:

`PASS MCU registers, timer, watchdog and reset`

Fuera del portal, después de descargar las fuentes ZIP:

```sh
make test    # Prueba funcional completa con Icarus
make synth   # Netlist Yosys de top
make formal  # Watchdog: SymbiYosys + Z3, acotado a 24 pasos
```

## Archivos que conviene leer

- `rtl/top.sv`: interfaz del bus, sincronización GPIO y decodificación.
- `rtl/gpio_peripheral.sv`: registro de salida.
- `rtl/tick_timer.sv`: periodo programable y pulso de interrupción.
- `rtl/watchdog_timer.sv`: IRQ saturante y servicio síncrono.
- `tb/tb_top.sv`: prueba de referencia y temporizador de seguridad.
- `docs/registers.md`: mapa software/hardware y reglas de transferencia.
- `rtl/top_fpga_top.sv`: demo autónoma de cuatro pines para iCE40.

## Modificaciones sugeridas

Agregue un registro PWM en 0x14, conecte UART/SPI o implemente una máscara GPIO.
Para cada registro pruebe reset, lectura, escritura y comportamiento cuando
`bus_valid=0`. Mantenga alineación de palabra y el mapa actualizado.
Un núcleo externo necesita adaptador de bus, memoria, vector de reset y su
propia verificación. La prueba formal actual cubre el watchdog, no todo el SoC.

PDK seleccionado: **{{PDK}}**. El RTL no depende de él; RTL→GDSII necesita la
librería y el adaptador físico instalados. Para FPGA complete primero los pines
y configure el reloj real. El wrapper no produce un parpadeo lento por defecto:
amplíe su contador para un LED visible.
