# Preparación del layout analógico

No se incluye GDS ficticio: esta etapa necesita topología a transistores y PDK.
Para su circuito final documente pares que requieren matching, simetría,
common-centroid, dummies, distancia a bordes, guard rings y retornos de masa.
Separe señales pequeñas de salidas con grandes swings; evite rutas de reloj
por encima de entradas sensibles. Registre área, rutas críticas y estrategia
de alimentación. DRC/LVS y PEX deben usar decks correctos de {{PDK}}.
