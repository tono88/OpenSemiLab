export interface ProjectFile {
  path: string
  content: string
  role: 'source' | 'testbench' | 'constraint' | 'configuration' | 'documentation' | 'simulation' | 'layout'
}

export interface StoredProject {
  id: string
  name: string
  kind: string
  pdk: string
  level: string
  language: string
  createdAt: string
  updatedAt: string
  files: ProjectFile[]
}

const STORAGE_KEY = 'opensemilab.projects.v1'

const readme = (name:string, kind:string, pdk:string) => `# ${name}

OpenSemiLab project

- Type: ${kind}
- PDK: ${pdk}
- Schema: opensemilab.project/v3

## Structure

Edit the files in this workspace, run the available checks, and export the project JSON for version control or transfer.
`

const executionByKind:Record<string,Record<string,string>>={
  microcontroller:{rtl_top:'top',testbench_top:'tb_top'},
  fpga_prototype:{rtl_top:'top',testbench_top:'tb_top'},
  sensor_interface:{rtl_top:'sensor_ctrl',testbench_top:'tb_sensor_ctrl',spice_entry:'analog/afe.spice'},
  analog_block:{spice_entry:'simulation/testbench.spice'},
  standard_cell:{rtl_top:'inverter',testbench_top:'tb_inverter',spice_entry:'simulation/tb_inverter.spice'},
}

const defaultPhysical={clock_port:'clk',clock_period_ns:10,die_width_um:120,die_height_um:120,core_utilization_pct:40}
const manifestObject = (name:string,kind:string,pdk:string) => ({schema:'opensemilab.project/v3',name,kind,pdk,execution:executionByKind[kind]??{},physical:defaultPhysical})
const manifest = (name:string, kind:string, pdk:string) => JSON.stringify(manifestObject(name,kind,pdk),null,2)+'\n'

export function starterFiles(kind:string,name:string,pdk:string):ProjectFile[] {
  const common:ProjectFile[]=[
    {path:'README.md',role:'documentation',content:readme(name,kind,pdk)},
    {path:'project.json',role:'configuration',content:manifest(name,kind,pdk)},
  ]
  const byKind:Record<string,ProjectFile[]>={
    microcontroller:[
      {path:'rtl/top.sv',role:'source',content:`module top (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [7:0] gpio_in,
  output logic [7:0] gpio_out
);
  logic [7:0] counter;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      counter  <= '0;
      gpio_out <= '0;
    end else begin
      counter  <= counter + 1'b1;
      gpio_out <= counter ^ gpio_in;
    end
  end
endmodule
`},
      {path:'rtl/gpio_peripheral.sv',role:'source',content:`module gpio_peripheral (
  input  logic       clk,
  input  logic       rst_n,
  input  logic       write_en,
  input  logic [7:0] write_data,
  output logic [7:0] gpio_out
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) gpio_out <= '0;
    else if (write_en) gpio_out <= write_data;
  end
endmodule
`},
      {path:'tb/tb_top.sv',role:'testbench',content:`\`timescale 1ns/1ps
module tb_top;
  logic clk = 0;
  logic rst_n = 0;
  logic [7:0] gpio_in = 8'hA5;
  logic [7:0] gpio_out;

  top dut (.*);
  always #5 clk = ~clk;

  initial begin
    $display("OpenSemiLab MCU simulation started");
    #12 rst_n = 1;
    repeat (8) @(posedge clk);
    $display("PASS gpio_out=%02h", gpio_out);
    $finish;
  end
endmodule
`},
      {path:'constraints/design.sdc',role:'constraint',content:'create_clock -name clk -period 10.000 [get_ports clk]\nset_input_delay 1.0 -clock clk [all_inputs]\nset_output_delay 1.0 -clock clk [all_outputs]\n'},
      {path:'docs/architecture.md',role:'documentation',content:'# Architecture\n\nDefine CPU, memory map, buses, interrupts and peripherals here.\n'},
    ],
    fpga_prototype:[
      {path:'rtl/top.sv',role:'source',content:`module top (input logic clk, input logic rst_n, output logic led);
  logic [23:0] counter;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) counter <= '0;
    else counter <= counter + 1'b1;
  end
  assign led = counter[23];
endmodule
`},
      {path:'tb/tb_top.sv',role:'testbench',content:`\`timescale 1ns/1ps
module tb_top;
  logic clk=0, rst_n=0, led;
  top dut(.*);
  always #5 clk=~clk;
  initial begin #12 rst_n=1; repeat(20) @(posedge clk); $display("PASS led=%b",led); $finish; end
endmodule
`},
      {path:'constraints/pins.pcf',role:'constraint',content:'# Replace with board-specific package pins\n#set_io clk 21\n#set_io led 99\n'},
      {path:'docs/board.md',role:'documentation',content:'# FPGA board\n\nDocument device, package, oscillator frequency and I/O voltage.\n'},
    ],
    sensor_interface:[
      {path:'specs/sensor.yaml',role:'configuration',content:'quantity: temperature\nrange: [-40, 125]\nunit: degC\nbandwidth_hz: 10\nresolution_bits: 12\nsupply_v: 3.3\n'},
      {path:'analog/afe.spice',role:'simulation',content:'* Sensor analog front-end starting point\nVDD vdd 0 3.3\nVIN in 0 DC 0.5\nRIN in sense 10k\nCIN sense 0 10n\n.op\n.end\n'},
      {path:'digital/sensor_ctrl.sv',role:'source',content:`module sensor_ctrl(input logic clk, input logic rst_n, input logic sample_ready, output logic sample_ack);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) sample_ack <= 1'b0;
    else sample_ack <= sample_ready;
  end
endmodule
`},
      {path:'verification/tb_sensor_ctrl.sv',role:'testbench',content:`\`timescale 1ns/1ps
module tb_sensor_ctrl;
  logic clk=0, rst_n=0, sample_ready=0, sample_ack;
  sensor_ctrl dut(.*);
  always #5 clk=~clk;
  initial begin
    $display("OpenSemiLab sensor controller simulation started");
    #12 rst_n=1;
    @(negedge clk) sample_ready=1;
    @(posedge clk); #1;
    if (sample_ack !== 1'b1) $fatal(1,"sample_ack did not follow sample_ready");
    @(negedge clk) sample_ready=0;
    @(posedge clk); #1;
    if (sample_ack !== 1'b0) $fatal(1,"sample_ack did not clear");
    $display("PASS sensor_ctrl handshake");
    $finish;
  end
endmodule
`},
      {path:'verification/plan.md',role:'documentation',content:'# Verification plan\n\n- DC operating point\n- Noise and bandwidth\n- ADC range\n- Digital calibration\n- Process, voltage and temperature corners\n'},
      {path:'layout/README.md',role:'layout',content:'# Layout\n\nFloorplan the analog front-end, ADC interface and digital control macro.\n'},
    ],
    analog_block:[
      {path:'specs/specifications.yaml',role:'configuration',content:'topology: operational_amplifier\nsupply_v: 1.8\ndc_gain_db_min: 60\ngbw_hz_min: 10e6\nphase_margin_deg_min: 60\nload_f: 1e-12\n'},
      {path:'schematic/opamp.spice',role:'simulation',content:'* Two-stage op-amp design placeholder\n* Replace generic devices with PDK models\n.subckt opamp vinp vinn vout vdd vss\n* M1 ...\n.ends opamp\n'},
      {path:'simulation/testbench.spice',role:'testbench',content:'* AC/DC/transient testbench\n.include ../schematic/opamp.spice\nVDD vdd 0 1.8\n.ac dec 20 1 1G\n.end\n'},
      {path:'layout/floorplan.md',role:'layout',content:'# Analog layout plan\n\nDocument matching, symmetry, guard rings, shielding and common-centroid structures.\n'},
      {path:'verification/checklist.md',role:'documentation',content:'# Sign-off checklist\n\n- [ ] Corners\n- [ ] Monte Carlo\n- [ ] DRC\n- [ ] LVS\n- [ ] PEX\n'},
    ],
    rf_frontend:[
      {path:'specs/rf.yaml',role:'configuration',content:'center_frequency_hz: 2.45e9\nbandwidth_hz: 100e6\nnoise_figure_db_max: 3\ngain_db_min: 15\ns11_db_max: -10\npdk: '+pdk+'\n'},
      {path:'schematic/lna.spice',role:'simulation',content:'* Low-noise amplifier starting point\n* Add '+pdk+' compact-model devices and bias network.\n'},
      {path:'em/structures.py',role:'simulation',content:'# Generate passive RF geometry for openEMS/gdsfactory.\n'},
      {path:'simulation/sparameters.md',role:'documentation',content:'# S-parameter plan\n\nSweep frequency, bias and process corners. Export Touchstone data.\n'},
      {path:'layout/stackup.yaml',role:'layout',content:'metals: []\nsubstrate: silicon\nreference_impedance_ohm: 50\n'},
    ],
    standard_cell:[
      {path:'rtl/inverter.sv',role:'source',content:'module inverter(input logic A, output logic Y);\n  assign Y = ~A;\nendmodule\n'},
      {path:'schematic/inverter.spice',role:'simulation',content:'* CMOS inverter\n.subckt inverter A Y VDD VSS\n* MP Y A VDD VDD pmos\n* MN Y A VSS VSS nmos\n.ends inverter\n'},
      {path:'verification/tb_inverter.sv',role:'testbench',content:`\`timescale 1ns/1ps
module tb_inverter;
  logic A, Y;
  inverter dut(.*);
  initial begin
    A=0; #1; if(Y!==1) $fatal(1,"Y must be 1 when A is 0");
    A=1; #1; if(Y!==0) $fatal(1,"Y must be 0 when A is 1");
    $display("PASS inverter truth table");
    $finish;
  end
endmodule
`},
      {path:'simulation/tb_inverter.spice',role:'testbench',content:`* Technology-independent inverter transfer example
VDD vdd 0 1.8
VIN a 0 0
RPU vdd y 10k
S1 y 0 a 0 SWMOD
.model SWMOD SW(Ron=10 Roff=1G Vt=0.9 Vh=0.05)
.dc VIN 0 1.8 0.1
.print dc v(a) v(y)
.end
`},
      {path:'characterization/config.yaml',role:'configuration',content:'cell: inverter\nslew_points: [0.01, 0.05, 0.1]\nload_points_f: [1e-15, 5e-15, 1e-14]\n'},
      {path:'layout/README.md',role:'layout',content:'# Cell layout\n\nTarget a legal cell height and document pin access, rails and well structure.\n'},
      {path:'verification/truth_table.csv',role:'documentation',content:'A,Y\n0,1\n1,0\n'},
    ],
  }
  return [...common,...(byKind[kind]??[])]
}

export function loadProjects():StoredProject[] {
  try {
    const projects=JSON.parse(localStorage.getItem(STORAGE_KEY)??'[]') as StoredProject[]
    let changed=false
    const upgraded=projects.map(project=>{
      const starters=starterFiles(project.kind,project.name,project.pdk)
      const missing=starters.filter(file=>!project.files.some(existing=>existing.path===file.path))
      let files=[...project.files,...missing]
      const manifestIndex=files.findIndex(file=>file.path==='project.json')
      if(manifestIndex>=0) {
        try {
          const parsed=JSON.parse(files[manifestIndex].content)
          if(parsed.schema!=='opensemilab.project/v3'||!parsed.execution||!parsed.physical) {
            const baseline=manifestObject(project.name,project.kind,project.pdk)
            files[manifestIndex]={...files[manifestIndex],content:JSON.stringify({...baseline,...parsed,schema:baseline.schema,execution:parsed.execution??baseline.execution,physical:parsed.physical??baseline.physical},null,2)+'\n'}
            changed=true
          }
        } catch { /* Preserve a user-edited non-JSON manifest. */ }
      }
      if(!missing.length&&files===project.files) return project
      if(missing.length) changed=true
      return {...project,files}
    })
    if(changed) saveProjects(upgraded)
    return upgraded
  }
  catch { return [] }
}

export function saveProjects(projects:StoredProject[]):void {
  localStorage.setItem(STORAGE_KEY,JSON.stringify(projects))
}

export function createProject(input:Pick<StoredProject,'name'|'kind'|'pdk'|'level'|'language'>):StoredProject {
  const now=new Date().toISOString()
  return {...input,id:crypto.randomUUID(),createdAt:now,updatedAt:now,files:starterFiles(input.kind,input.name,input.pdk)}
}
