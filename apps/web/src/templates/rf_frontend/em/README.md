# Preparación de simulación electromagnética

La red SPICE y ABCD sí se ejecuta; la extracción EM 3D depende de geometría,
materiales y puertos reales y **no se considera ya validada**.
Use el PDK {{PDK}} para capas/espesores y datos de material, no dimensiones inventadas.

1. Dibuje estructura, planos de referencia y retornos de corriente.
2. Defina materiales, unidades, mallado y dominio con PML suficientemente lejos.
3. Añada puertos de excitación y medida coherentes con Z0 y modos propagantes.
4. Realice convergencia de malla antes de aceptar S11/S21.
5. Exporte un XML openEMS completo, añádalo al proyecto y use el adaptador RF/EM.
6. Postprocese las medidas de puerto con openEMS; un XML que termina no demuestra
   por sí solo que exista un modelo Touchstone válido.
7. Reimporte datos extraídos en circuito y compare con ABCD, incluyendo pérdidas.

Referencias oficiales:

- https://docs.openems.de/en/latest/concepts/ports.html
- https://docs.openems.de/en/latest/python/openEMS/Tutorials/Rect_Waveguide.html

No se necesita DEVSIM para esta red RF; si añade un estudio de dispositivo,
DEVSIM continuará ejecutándose en el computador cliente.
