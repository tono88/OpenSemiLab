`timescale 1ns/1ps
// Regresion autocheck: reset, escritura, lectura, timer, watchdog y bus idle.
// Estimulos en negedge; verificaciones despues de la actualizacion NBA.
module tb_top;
  logic clk = 0, rst_n = 0, bus_valid = 0, bus_write = 0;
  logic [7:0] bus_addr = 0, gpio_in = 8'hA5, gpio_out;
  logic [31:0] bus_wdata = 0, bus_rdata;
  logic bus_ready, timer_irq, watchdog_irq;
  top dut (.*);
  always #5 clk = ~clk;
  task automatic write_register(input logic [7:0] address, input logic [31:0] data);
    @(negedge clk); bus_valid = 1; bus_write = 1; bus_addr = address; bus_wdata = data;
    @(posedge clk); #1;
    if (!bus_ready) $fatal(1, "No bus acknowledgement");
    @(negedge clk); bus_valid = 0; bus_write = 0;
  endtask
  initial begin
    $dumpfile("waveform.vcd"); $dumpvars(0, tb_top);
    repeat (2) @(negedge clk);
    if (gpio_out !== 0 || watchdog_irq !== 0) $fatal(1, "Reset outputs");
    rst_n = 1;
    write_register(8'h00, 32'h0000005A);
    if (gpio_out !== 8'h5A) $fatal(1, "GPIO write mismatch");
    bus_addr = 8'h00; #1;
    if (bus_rdata[15:0] !== 16'hA55A) $fatal(1, "GPIO read mismatch");
    write_register(8'h04, 32'd4);
    repeat (3) @(negedge clk);
    if (timer_irq !== 0) $fatal(1, "Timer fired too early");
    @(negedge clk);
    if (timer_irq !== 1) $fatal(1, "Timer period mismatch");
    @(negedge clk);
    if (timer_irq !== 0) $fatal(1, "Timer pulse wider than one clock");
    write_register(8'h0C, 32'd1);
    repeat (63) @(negedge clk);
    if (watchdog_irq !== 0) $fatal(1, "Watchdog fired too early");
    @(negedge clk);
    if (watchdog_irq !== 1) $fatal(1, "Watchdog failed to expire");
    repeat (5) @(negedge clk);
    if (watchdog_irq !== 1) $fatal(1, "Watchdog IRQ is not sticky");
    write_register(8'h0C, 32'd1);
    if (watchdog_irq !== 0) $fatal(1, "Watchdog service did not clear IRQ");
    write_register(8'h04, 32'd0);
    repeat (2) @(negedge clk);
    if (timer_irq !== 1) $fatal(1, "Zero period must tick every cycle");
    bus_addr = 8'hFC; #1;
    if (bus_rdata !== 0 || bus_ready !== 0) $fatal(1, "Idle/unmapped bus");
    rst_n = 0; #1;
    if (gpio_out !== 0 || watchdog_irq !== 0) $fatal(1, "Mid-run reset");
    $display("PASS MCU registers, timer, watchdog and reset");
    $finish;
  end
  initial begin #100000; $fatal(1, "Simulation timeout"); end
endmodule
