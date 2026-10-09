// Wrapper de placa: reduce el bus interno de 74+ bits a cuatro pines.
// Un secuenciador autonomo cambia GPIO y atiende al watchdog cada 16 ciclos.
// Use constraints/pins.pcf SOLO despues de completar los pines de su placa.
module top_fpga_top (
  input logic clk,
  input logic rst_n,
  output logic led,
  output logic fault_led
);
  logic [7:0] sequence_count;
  logic [7:0] gpio_out;
  logic bus_ready, timer_irq;
  logic [31:0] bus_rdata;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) sequence_count <= '0;
    else sequence_count <= sequence_count + 8'd1;
  end
  top controller (
    .clk, .rst_n,
    .bus_valid(sequence_count[3:0] == 4'd0 || sequence_count[3:0] == 4'd1),
    .bus_write(1'b1),
    .bus_addr(sequence_count[0] ? 8'h0C : 8'h00),
    .bus_wdata({24'd0, sequence_count}),
    .bus_ready, .bus_rdata, .gpio_in(8'd0), .gpio_out,
    .timer_irq, .watchdog_irq(fault_led)
  );
  assign led = gpio_out[7];
endmodule
