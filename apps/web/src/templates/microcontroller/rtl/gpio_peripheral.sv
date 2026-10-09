// GPIO de salida con escritura sincrona. No infiere latches.
// La lectura y la sincronizacion de GPIO de entrada se realizan en top.sv.
module gpio_peripheral (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       write_en,
  input  logic [7:0] write_data,
  output logic [7:0] gpio_out
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) gpio_out <= 8'h00;
    else if (write_en) gpio_out <= write_data;
  end
endmodule
