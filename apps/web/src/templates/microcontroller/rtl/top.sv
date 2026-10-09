// Subsistema de perifericos funcional, NO una CPU RISC-V.
// Bus local de un ciclo: mantener valid/address/data hasta el flanco positivo.
// bus_ready confirma toda transferencia; direcciones desconocidas devuelven 0.
// Direcciones y efectos de escritura: docs/registers.md.
module top (
  input logic clk,
  input logic rst_n,
  input logic bus_valid,
  input logic bus_write,
  input logic [7:0] bus_addr,
  input logic [31:0] bus_wdata,
  output logic bus_ready,
  output logic [31:0] bus_rdata,
  input logic [7:0] gpio_in,
  output logic [7:0] gpio_out,
  output logic timer_irq,
  output logic watchdog_irq
);
  logic [7:0] gpio_meta, gpio_sync;
  logic [15:0] timer_period, timer_count;
  logic write_cycle, gpio_write, timer_write, watchdog_kick;
  assign bus_ready = bus_valid;
  assign write_cycle = bus_valid && bus_write;
  assign gpio_write = write_cycle && bus_addr == 8'h00;
  assign timer_write = write_cycle && bus_addr == 8'h04;
  assign watchdog_kick = write_cycle && bus_addr == 8'h0C;

  // Doble sincronizador para entradas lentas independientes.
  // No es un CDC coherente para palabras que cambian simultaneamente.
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      gpio_meta <= '0;
      gpio_sync <= '0;
      timer_period <= 16'd100;
    end else begin
      gpio_meta <= gpio_in;
      gpio_sync <= gpio_meta;
      if (timer_write) timer_period <= bus_wdata[15:0];
    end
  end
  gpio_peripheral gpio (.clk, .rst_n, .write_en(gpio_write), .write_data(bus_wdata[7:0]), .gpio_out);
  tick_timer timer (.clk, .rst_n, .reconfigure(timer_write), .period(timer_period), .count(timer_count), .tick(timer_irq));
  watchdog_timer #(.LIMIT(64)) watchdog (.clk, .rst_n, .kick(watchdog_kick), .timeout_irq(watchdog_irq));

  // Valores por defecto en toda ruta: decodificador combinacional sin latches.
  always_comb begin
    bus_rdata = 32'h00000000;
    case (bus_addr)
      8'h00: bus_rdata = {16'd0, gpio_sync, gpio_out};
      8'h04: bus_rdata = {16'd0, timer_period};
      8'h08: bus_rdata = {16'd0, timer_count};
      8'h10: bus_rdata = {30'd0, watchdog_irq, timer_irq};
      default: bus_rdata = 32'h00000000;
    endcase
  end
endmodule
