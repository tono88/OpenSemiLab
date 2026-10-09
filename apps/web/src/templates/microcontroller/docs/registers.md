# Mapa de registros del bus local

Direcciones byte, ancho de datos 32 bits. Una transferencia se acepta en el
flanco positivo cuando `bus_valid && bus_ready`. Las escrituras requieren
`bus_write=1`. No hay wait states, arbitraje, byte enables ni respuesta de error.

| Dirección | Nombre | Lectura | Escritura | Reset |
|---|---|---|---|---|
| 0x00 | GPIO | [15:8] entrada sincronizada; [7:0] salida | [7:0] nueva salida | salida 0 |
| 0x04 | PERIOD | periodo del timer [15:0] | reinicia la cuenta; 0/1 = tick cada ciclo | 100 |
| 0x08 | COUNT | cuenta actual del timer | ignorada | 0 |
| 0x0C | WD_KICK | 0 | cualquier escritura atiende watchdog | — |
| 0x10 | STATUS | bit 1 watchdog; bit 0 pulso timer | ignorada | 0 |
| Otra | Reservado | 0 | ignorada | — |

El timer genera pulsos de un ciclo, no IRQ almacenada. Si el software debe
sondear eventos, agregue un registro sticky y borrado W1C. El watchdog vence
tras 64 ciclos sin servicio y mantiene la IRQ hasta kick/reset.

La entrada GPIO tarda dos flancos en sincronizarse. Los sincronizadores son
para señales lentas independientes: un bus externo requiere handshake o FIFO.
