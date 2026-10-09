# Arquitectura e integración

Un reloj alimenta periféricos y bus. El reset es activo bajo y asíncrono en la
plantilla; para silicio real sincronice su liberación en cada dominio.
El bloque principal tiene direccionamiento de 8 bits y datos de 32 bits.
GPIO tiene ocho salidas; timer tiene 16 bits; watchdog usa un límite fijo.

## Plan de extensión

1. Especifique nuevas direcciones, ancho y valores de reset.
2. Añada el periférico sin incluir bancos de pruebas en las fuentes sintetizables.
3. Pruebe escrituras consecutivas, direcciones reservadas y reset a mitad de operación.
4. Si agrega una CPU, primero valide bus y memoria con un agente de pruebas.
5. Añada assertions para cada contrato y conserve la regresión del watchdog.
6. Actualice restricciones de temporización y revise fan-out de bus/reset.

No hay DMA, memoria de instrucciones, ISA implementada ni interrupciones
priorizadas. Son decisiones de arquitectura explícitas que el desarrollador
puede añadir sobre esta base probada.
