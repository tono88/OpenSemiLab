`timescale 1ns/1ps
// Tabla de verdad y propagacion de desconocidos en logica de cuatro estados.
module tb_inverter;
  logic A, Y;
  inverter dut (.*);
  initial begin
    $dumpfile("waveform.vcd"); $dumpvars(0, tb_inverter);
    A = 0; #1; if (Y !== 1) $fatal(1, "A=0 -> Y=1");
    A = 1; #1; if (Y !== 0) $fatal(1, "A=1 -> Y=0");
    A = 1'bx; #1; if (Y !== 1'bx) $fatal(1, "Unknown input must propagate");
    A = 1'bz; #1; if (Y !== 1'bx) $fatal(1, "Floating input is not a valid logic level");
    $display("PASS inverter truth table and unknown-state handling"); $finish;
  end
  initial begin #100; $fatal(1, "Simulation timeout"); end
endmodule
