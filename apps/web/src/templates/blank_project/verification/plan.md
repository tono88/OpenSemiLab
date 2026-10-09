# Plan de verificación

| Requisito | Estímulo | Resultado esperado | Evidencia |
|---|---|---|---|
| Reset | Durante idle y durante actividad | Estado definido sin X | Testbench |
| Caso nominal | Entradas típicas | Función y latencia correctas | Assert/medida |
| Límite | Mínimo/máximo/out-of-range | Contrato documentado | Assert/medida |
| Error | Dato inválido/stall | Sin corrupción | Regresión |
| Integración | Modelo/placa/PDK real | Márgenes suficientes | Reporte |

Complete valores numéricos antes de marcar un requisito como verificado.
Una captura de ondas sin comparación no reemplaza la verificación automática.
