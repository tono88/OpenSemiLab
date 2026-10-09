// Sincronizador de dos flancos + filtro por estabilidad + pulso de un ciclo.
// STABLE_CYCLES = frecuencia_clk * tiempo_antirrebote; valor minimo 2.
module button_filter #(
  parameter integer STABLE_CYCLES = 12000
) (
  input logic clk,
  input logic rst_n,
  input logic button,
  output logic pressed
);
  localparam integer WIDTH = (STABLE_CYCLES > 1) ? $clog2(STABLE_CYCLES + 1) : 1;
  logic meta, synced, debounced;
  logic [WIDTH-1:0] stable_count;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      meta <= 0; synced <= 0; debounced <= 0;
      stable_count <= '0; pressed <= 0;
    end else begin
      meta <= button;
      synced <= meta;
      pressed <= 0;
      if (synced == debounced) stable_count <= '0;
      else if (stable_count >= WIDTH'(STABLE_CYCLES - 1)) begin
        debounced <= synced;
        stable_count <= '0;
        pressed <= synced; // Solo el flanco de pulsacion, no la liberacion.
      end else stable_count <= stable_count + 1'b1;
    end
  end
endmodule
