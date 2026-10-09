// PWM de 8 bits: frecuencia = f_clk / 256; duty = level / 256.
// level=0 apaga; level=255 conserva un ciclo bajo (no equivale al 100%).
module pwm8 (
  input logic clk,
  input logic rst_n,
  input logic [7:0] level,
  output logic pwm
);
  logic [7:0] phase;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) phase <= 8'd0;
    else phase <= phase + 8'd1;
  end
  assign pwm = rst_n && phase < level;
endmodule
