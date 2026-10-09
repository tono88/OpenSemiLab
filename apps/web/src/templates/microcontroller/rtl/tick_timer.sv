// Tick periodico programable. period=0 se interpreta como un ciclo.
// reconfigure evita una espera larga al reducir el periodo en caliente.
module tick_timer (
  input logic clk,
  input logic rst_n,
  input logic reconfigure,
  input logic [15:0] period,
  output logic [15:0] count,
  output logic tick
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= 16'd0;
      tick <= 1'b0;
    end else if (reconfigure) begin
      count <= 16'd0;
      tick <= 1'b0;
    end else if (period <= 16'd1 || count >= period - 16'd1) begin
      count <= 16'd0;
      tick <= 1'b1;
    end else begin
      count <= count + 16'd1;
      tick <= 1'b0;
    end
  end
endmodule
