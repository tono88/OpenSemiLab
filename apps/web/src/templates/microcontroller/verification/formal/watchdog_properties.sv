// Propiedades del watchdog pequeno. No se mezcla con los testbenches.
module watchdog_properties (
  input logic clk,
  input logic rst_n,
  input logic kick
);
  logic timeout_irq;
  logic past_valid = 0;
  watchdog_timer #(.LIMIT(4)) dut (.*);
`ifdef FORMAL
  always @(posedge clk) begin
    past_valid <= 1;
    if (!past_valid) assume (!rst_n);
    if (past_valid && rst_n && $past(rst_n)) begin
      if ($past(kick)) assert (!timeout_irq);
      if ($past(timeout_irq) && !$past(kick)) assert (timeout_irq);
    end
  end
`endif
endmodule
