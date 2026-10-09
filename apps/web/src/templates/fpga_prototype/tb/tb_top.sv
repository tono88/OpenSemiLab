`timescale 1ns/1ps
// Comprueba duty cuantitativo, antirrebote, una pulsacion larga y reset.
module tb_top;
  logic clk = 0, rst_n = 0, button = 0, led, pwm_led;
  logic previous_led;
  top #(.BLINK_BITS(3), .DEBOUNCE_CYCLES(4)) dut (.*);
  always #5 clk = ~clk;
  task automatic check_duty(input integer expected);
    integer high_cycles;
    high_cycles = 0;
    repeat (256) begin
      @(negedge clk);
      if (pwm_led === 1'b1) high_cycles = high_cycles + 1;
      else if (pwm_led !== 1'b0) $fatal(1, "PWM unknown state");
    end
    if (high_cycles != expected) $fatal(1, "Duty expected %0d/256, got %0d", expected, high_cycles);
  endtask
  initial begin
    $dumpfile("waveform.vcd"); $dumpvars(0, tb_top);
    repeat (2) @(negedge clk);
    if (pwm_led !== 0 || led !== 0) $fatal(1, "Reset outputs");
    rst_n = 1;
    check_duty(64);
    // Glitch de un ciclo: menor al filtro, no cambia el nivel.
    button = 1; @(negedge clk); button = 0;
    repeat (12) @(negedge clk);
    check_duty(64);
    button = 1; repeat (30) @(negedge clk);
    button = 0; repeat (20) @(negedge clk);
    check_duty(80); // Una sola pulsacion, aunque se mantenga el boton.
    previous_led = led;
    repeat (4) @(negedge clk);
    if (led !== !previous_led) $fatal(1, "Heartbeat did not toggle");
    rst_n = 0; #1;
    if (pwm_led !== 0 || led !== 0) $fatal(1, "Mid-run reset");
    @(negedge clk); rst_n = 1;
    check_duty(64);
    $display("PASS FPGA PWM duty, debounce and reset"); $finish;
  end
  initial begin #100000; $fatal(1, "Simulation timeout"); end
endmodule
