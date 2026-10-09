// Watchdog saturante: mantiene la IRQ hasta reset o servicio (kick).
// LIMIT >= 2. Kick es SINCRONO; nunca se incluye en el reset asincrono.
// Para sistemas reales decida si la IRQ provoca interrupcion o reset de CPU.
module watchdog_timer #(
  parameter integer LIMIT = 64
) (
  input logic clk,
  input logic rst_n,
  input logic kick,
  output logic timeout_irq
);
  localparam integer WIDTH = (LIMIT > 1) ? $clog2(LIMIT + 1) : 1;
  logic [WIDTH-1:0] count;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= '0;
      timeout_irq <= 1'b0;
    end else if (kick) begin
      count <= '0;
      timeout_irq <= 1'b0;
    end else if (count >= WIDTH'(LIMIT - 1)) begin
      timeout_irq <= 1'b1;
    end else count <= count + 1'b1;
  end
endmodule
