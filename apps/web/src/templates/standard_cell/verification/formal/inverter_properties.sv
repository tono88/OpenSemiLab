module inverter_properties (input logic A);
  logic Y;
  inverter dut (.*);
`ifdef FORMAL
  // Formal usa estados binarios, no X/Z del banco de simulacion.
  always @* assert (Y == !A);
`endif
endmodule
