# Integración con la placa

| Dato | Valor de referencia | Acción antes de programar |
|---|---|---|
| FPGA | iCE40 UP5K | Confirmar modelo exacto |
| Encapsulado | SG48 | Confirmar package y pines |
| Oscilador | 12 MHz | Medir/consultar esquemático |
| Reset | Activo bajo | Liberar sincronizado |
| Botón | Activo alto | Adaptar pull-up/pull-down y polaridad |
| LEDs | Activos altos | Usar wrapper si son activos bajos |
| I/O | Sin tensión definida | Revisar bancos y tensión de la placa |

No se inventan pines para una placa desconocida. Guarde la revisión del esquema,
el archivo PCF y los reportes de temporización junto con la configuración usada.
El filtro es un ejemplo de entrada humana; no reemplaza un CDC de datos multibit.
