# Contrato de la variante VHDL

| Puerto | Tipo | Contrato |
|---|---|---|
| clk | 1 bit | Un único reloj, flanco ascendente |
| rst_n | 1 bit | Activo bajo, reset asíncrono |
| enable | 1 bit | Permite avanzar contador y fase PWM |
| write_en | 1 bit | Captura gpio_data en el flanco, incluso con enable=0 |
| gpio_data | 8 bits | Nivel PWM y dato de salida |
| gpio_out | 8 bits | Registro de nivel, reset 0 |
| count | 8 bits | Ocho bits bajos del contador; extensión cero si BLINK_BITS<8 |
| led | 1 bit | Bit más alto del contador |
| pwm_led | 1 bit | phase < gpio_out, deshabilitado durante reset |

El periodo PWM es 256 ciclos habilitados. Si enable permanece bajo,
la fase se congela: no utilice esa pausa como un control de potencia analógico.
Cambie señales de prueba en el flanco descendente y compruebe después de que
se hayan aplicado las asignaciones síncronas. Registre los nuevos casos de
prueba al cambiar BLINK_BITS o el contrato de enable.
