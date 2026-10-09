# Recetas de ejecución

Estas recetas se habilitan cuando agregue entradas, no contienen un diseño.

```sh
# SystemVerilog: adapte la lista de fuentes
iverilog -g2012 -s tb_top -o build/test.vvp rtl/top.sv tb/tb_top.sv
vvp build/test.vvp
yosys -p 'read_verilog -sv rtl/top.sv; hierarchy -check -top top; proc; opt; check -assert; stat'

# VHDL-2008: fuente antes del testbench
ghdl -a --std=08 rtl/top.vhd tb/tb_top.vhd
ghdl -r --std=08 tb_top --assert-level=error

# SPICE: las rutas .include son relativas a la raiz del proyecto
ngspice -b -o build/spice.log simulation/testbench.spice
```

Cree `build/` antes de ejecutar. Si incluye formal, defina propiedades reales y
suposiciones explícitas: un PASS sin assertions no prueba nada. Para FPGA use
un wrapper con pines físicos; para ASIC revise reloj, SDC y adaptador PDK.
