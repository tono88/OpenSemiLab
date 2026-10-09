# Primeros pasos

1. Abra `README.md`: contiene el ejemplo, sus puertos y el resultado esperado.
2. Revise `project.json`. `execution` selecciona el módulo RTL, el banco de
   pruebas y/o el netlist SPICE. Cambie esas rutas al renombrar archivos.
3. En **Verificación**, ejecute el análisis y la síntesis cuando haya RTL.
4. En **Simulación**, ejecute el banco digital y/o SPICE. Busque `PASS`,
   compruebe las ondas y revise las medidas; una herramienta que termina sin
   error no demuestra por sí sola que se cumplen las especificaciones.
5. Modifique un parámetro pequeño, vuelva a ejecutar y compare el resultado.
6. Descargue las fuentes ZIP para trabajar fuera del navegador. Extraiga el
   ZIP en una carpeta nueva; allí `make test` ejecuta las pruebas locales.

## Herramientas locales

Para RTL: Icarus Verilog y Yosys. Para SPICE: ngspice. La variante VHDL usa
GHDL con VHDL-2008. Python 3 verifica manifiestos y medidas sin dependencias
adicionales. GNU Make coordina las pruebas. Instale solo lo que use su proyecto.
Los bancos SPICE combinados utilizan el lenguaje `.control` de ngspice para
medir cada análisis con sus propios datos; para otro simulador adapte esas
instrucciones según su sintaxis.

Desde una terminal en la raíz del ZIP extraído:

```sh
make check    # Manifiesto, rutas y archivos de entrada
make test     # Todas las pruebas funcionales de esta plantilla
```

Los comandos específicos de cada plantilla están documentados en su README.
El botón de exportación JSON conserva también los metadatos para reimportar.
Los archivos `build/` son resultados; no son entradas del diseño.

## Ejecución y datos

El flujo EDA utiliza las herramientas configuradas en el laboratorio.
**DEVSIM se instala y ejecuta en el computador cliente**, no en el servidor.
Estas plantillas no cambian esa separación. La configuración SMTP es del portal
y no forma parte de las fuentes de los diseños.
