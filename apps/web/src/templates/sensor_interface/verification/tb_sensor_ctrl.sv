`timescale 1ns/1ps
// Regresion: promedio signed, offset, backpressure y saturacion bilateral.
module tb_sensor_ctrl;
  logic clk = 0, rst_n = 0, sample_valid = 0, sample_ready;
  logic signed [15:0] sample_data = 0, offset = 10, out_data;
  logic out_valid, out_ready = 0;
  sensor_ctrl dut (.*);
  always #5 clk = ~clk;
  task automatic send(input integer value);
    @(negedge clk);
    if (!sample_ready) $fatal(1, "Unexpected backpressure before sample");
    sample_data = 16'(value); sample_valid = 1;
    @(posedge clk); #1;
    @(negedge clk); sample_valid = 0;
  endtask
  task automatic expect_output(input integer value);
    if (!out_valid || out_data !== 16'(value)) $fatal(1, "Expected %0d, got %0d valid=%b", value, out_data, out_valid);
  endtask
  task automatic consume;
    out_ready = 1; @(negedge clk); out_ready = 0;
    if (out_valid) $fatal(1, "Output did not acknowledge");
  endtask
  initial begin
    $dumpfile("waveform.vcd"); $dumpvars(0, tb_sensor_ctrl);
    repeat (2) @(negedge clk);
    if (out_valid !== 0 || out_data !== 0) $fatal(1, "Reset outputs");
    rst_n = 1;
    send(100); send(200); send(300);
    if (out_valid) $fatal(1, "Output before fourth sample");
    send(400); expect_output(260);
    // El productor intenta enviar mientras la salida esta detenida.
    sample_valid = 1; sample_data = 999;
    repeat (5) begin
      @(negedge clk);
      if (sample_ready) $fatal(1, "Input accepted during stall");
      expect_output(260);
    end
    sample_valid = 0; consume();
    send(-100); send(-200); send(-300); send(-400); expect_output(-240); consume();
    offset = 20;
    repeat (4) send(32760);
    expect_output(32767); consume();
    offset = -20;
    repeat (4) send(-32760);
    expect_output(-32768); consume();
    rst_n = 0; #1;
    if (out_valid !== 0 || out_data !== 0) $fatal(1, "Mid-run reset");
    $display("PASS sensor averaging, calibration, backpressure and saturation"); $finish;
  end
  initial begin #100000; $fatal(1, "Simulation timeout"); end
endmodule
