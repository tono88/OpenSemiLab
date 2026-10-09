// Demo sintetizable: heartbeat + dimmer PWM controlado por boton.
// Baje BLINK_BITS y DEBOUNCE_CYCLES solo en simulacion para pruebas rapidas.
module top #(
  parameter integer BLINK_BITS = 22,
  parameter integer DEBOUNCE_CYCLES = 12000
) (
  input logic clk,
  input logic rst_n,
  input logic button,
  output logic led,
  output logic pwm_led
);
  logic [BLINK_BITS-1:0] blink_count;
  logic [7:0] level;
  logic pressed;
  button_filter #(.STABLE_CYCLES(DEBOUNCE_CYCLES)) filter (.clk, .rst_n, .button, .pressed);
  pwm8 dimmer (.clk, .rst_n, .level, .pwm(pwm_led));
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin blink_count <= '0; level <= 8'd64; end
    else begin
      blink_count <= blink_count + 1'b1;
      if (pressed) level <= level + 8'd16; // Wrap intencionado tras 240.
    end
  end
  assign led = blink_count[BLINK_BITS-1];
endmodule
