// Modelo logico de la celda. Los retardos pertenecen a Liberty/SDF, no al RTL.
module inverter (input logic A, output logic Y);
  assign Y = ~A;
endmodule
