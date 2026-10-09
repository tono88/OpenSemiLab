// Promedio de 2^LOG2_SAMPLES muestras signed 16-bit, offset y saturacion.
// Contrato ready/valid: datos solo se aceptan con sample_valid && sample_ready.
// La salida permanece estable durante backpressure. LOG2_SAMPLES >= 1.
module sensor_ctrl #(
  parameter integer LOG2_SAMPLES = 2
) (
  input logic clk,
  input logic rst_n,
  input logic sample_valid,
  output logic sample_ready,
  input logic signed [15:0] sample_data,
  input logic signed [15:0] offset,
  output logic out_valid,
  input logic out_ready,
  output logic signed [15:0] out_data
);
  localparam integer WIDTH = 17 + LOG2_SAMPLES;
  logic [LOG2_SAMPLES-1:0] count;
  logic signed [WIDTH-1:0] accumulator, extended_sample, extended_offset;
  logic signed [WIDTH-1:0] total, calibrated;
  assign extended_sample = {{(WIDTH-16){sample_data[15]}}, sample_data};
  assign extended_offset = {{(WIDTH-16){offset[15]}}, offset};
  assign total = accumulator + extended_sample;
  assign calibrated = (total >>> LOG2_SAMPLES) + extended_offset;
  assign sample_ready = !out_valid || out_ready;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= '0; accumulator <= '0; out_valid <= 0; out_data <= '0;
    end else begin
      if (out_valid && out_ready) out_valid <= 0;
      if (sample_valid && sample_ready) begin
        if (&count) begin
          // Comparaciones signed para no convertir negativos a valores enormes.
          if (calibrated > 32767) out_data <= 16'sh7FFF;
          else if (calibrated < -32768) out_data <= 16'sh8000;
          else out_data <= calibrated[15:0];
          out_valid <= 1;
          count <= '0; accumulator <= '0;
        end else begin
          accumulator <= total;
          count <= count + 1'b1;
        end
      end
    end
  end
endmodule
