# Reloj de referencia 40 MHz. Ajuste junto con project.json y la placa real.
create_clock -name clk -period 25.000 [get_ports clk]
set_input_delay 2.0 -clock clk [get_ports {bus_valid bus_write bus_addr* bus_wdata* gpio_in*}]
set_output_delay 2.0 -clock clk [all_outputs]
# Reset asincrono: verificar recuperacion/remocion y liberacion sincronizada.
set_false_path -from [get_ports rst_n]
