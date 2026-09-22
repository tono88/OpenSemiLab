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

export function normalizeProjectExecution(project:StoredProject):StoredProject {
  const manifestIndex=project.files.findIndex(file=>file.path==='project.json')
  if(manifestIndex<0)return project
  try {
    const parsed=JSON.parse(project.files[manifestIndex].content)
    const execution=parsed.execution??{}
    const rtlTop=String(execution.rtl_top??'').trim()
    if(!rtlTop)return project
    const preferred=`${rtlTop}_fpga_top`
    const hasPreferredWrapper=project.files.some(file=>file.role==='source'&&Array.from(file.content.matchAll(/\bmodule\s+([A-Za-z_][A-Za-z0-9_$]*)/g)).some(match=>match[1]===preferred))
    if(!hasPreferredWrapper||execution.fpga_top===preferred)return project
    const files=project.files.map((file,index)=>index===manifestIndex?{
      ...file,
      content:JSON.stringify({...parsed,execution:{...execution,fpga_top:preferred}},null,2)+'\n',
    }:file)
    return {...project,files}
  } catch {return project}
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
  sensor_interface:{rtl_top:'sensor_ctrl',testbench_top:'tb_sensor_ctrl',spice_entry:'simulation/afe_transient.cir'},
  analog_block:{spice_entry:'simulation/testbench.spice'},
  rf_frontend:{spice_entry:'schematic/lna.spice'},
  standard_cell:{rtl_top:'inverter',testbench_top:'tb_inverter',spice_entry:'simulation/tb_inverter.spice'},
  blank_project:{},
}

const defaultPhysical={clock_port:'clk',clock_period_ns:25,die_width_um:120,die_height_um:120,core_utilization_pct:40,timing_effort:'balanced'}
const manifestObject = (name:string,kind:string,pdk:string) => ({schema:'opensemilab.project/v3',name,kind,pdk,execution:executionByKind[kind]??{},physical:defaultPhysical})
const manifest = (name:string, kind:string, pdk:string) => JSON.stringify(manifestObject(name,kind,pdk),null,2)+'\n'

const legacyMicroWatchdog = `module watchdog_timer #(
  parameter integer LIMIT = 32
) (
  input  logic clk,
  input  logic rst_n,
  input  logic kick,
  output logic timeout_irq
);
  localparam integer WIDTH = $clog2(LIMIT + 1);
  logic [WIDTH-1:0] count;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n || kick) begin count <= '0; timeout_irq <= 1'b0; end
    else if (count == LIMIT-1) begin count <= count; timeout_irq <= 1'b1; end
    else count <= count + 1'b1;
  end
endmodule
`

const microWatchdog = `module watchdog_timer #(
  parameter integer LIMIT = 32
) (
  input  logic clk,
  input  logic rst_n,
  input  logic kick,
  output logic timeout_irq
);
  localparam integer WIDTH = $clog2(LIMIT + 1);
  logic [WIDTH-1:0] count;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin count <= '0; timeout_irq <= 1'b0; end
    else if (kick) begin count <= '0; timeout_irq <= 1'b0; end
    else if (count == LIMIT-1) begin count <= count; timeout_irq <= 1'b1; end
    else count <= count + 1'b1;
  end
endmodule
`

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
  output logic [7:0] gpio_out,
  output logic       watchdog_irq
);
  logic [7:0] counter;
  logic       gpio_write;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) counter <= '0;
    else counter <= counter + 1'b1;
  end

  assign gpio_write = counter[2:0] == 3'b111;
  gpio_peripheral gpio (
    .clk, .rst_n, .write_en(gpio_write),
    .write_data(counter ^ gpio_in), .gpio_out
  );
  watchdog_timer #(.LIMIT(32)) watchdog (
    .clk, .rst_n, .kick(counter[4]), .timeout_irq(watchdog_irq)
  );
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
      {path:'rtl/watchdog_timer.sv',role:'source',content:microWatchdog},
      {path:'tb/tb_top.sv',role:'testbench',content:`\`timescale 1ns/1ps
module tb_top;
  logic clk = 0;
  logic rst_n = 0;
  logic [7:0] gpio_in = 8'hA5;
  logic [7:0] gpio_out;
  logic watchdog_irq;

  top dut (.*);
  always #5 clk = ~clk;

  initial begin
    $display("OpenSemiLab MCU simulation started");
    #12 rst_n = 1;
    repeat (18) @(posedge clk);
    if (gpio_out === 8'h00) $fatal(1,"GPIO peripheral was not updated");
    if (watchdog_irq !== 1'b0) $fatal(1,"Watchdog fired while it was being serviced");
    $display("PASS gpio_out=%02h watchdog_irq=%b", gpio_out, watchdog_irq);
    $finish;
  end
endmodule
`},
      {path:'constraints/design.sdc',role:'constraint',content:'create_clock -name clk -period 10.000 [get_ports clk]\nset_input_delay 1.0 -clock clk [all_inputs]\nset_output_delay 1.0 -clock clk [all_outputs]\n'},
      {path:'docs/architecture.md',role:'documentation',content:'# Architecture\n\nDefine CPU, memory map, buses, interrupts and peripherals here.\n'},
      {path:'verification/formal-properties.sv',role:'documentation',content:'// Move selected assertions into an RTL source or a custom .sby harness.\n// Suggested properties: reset safety, watchdog liveness and GPIO write stability.\n'},
    ],
    fpga_prototype:[
      {path:'rtl/top.sv',role:'source',content:`module top (input logic clk, input logic rst_n, output logic led, output logic pwm_led);
  logic [23:0] counter;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) counter <= '0;
    else counter <= counter + 1'b1;
  end
  assign led = counter[23];
  pwm8 dimmer(.clk, .rst_n, .level(counter[23:16]), .pwm(pwm_led));
endmodule
`},
      {path:'tb/tb_top.sv',role:'testbench',content:`\`timescale 1ns/1ps
module tb_top;
  logic clk=0, rst_n=0, led, pwm_led;
  top dut(.*);
  always #5 clk=~clk;
  initial begin #12 rst_n=1; repeat(300) @(posedge clk); $display("PASS led=%b pwm_led=%b",led,pwm_led); $finish; end
endmodule
`},
      {path:'rtl/pwm8.sv',role:'source',content:`module pwm8(input logic clk, input logic rst_n, input logic [7:0] level, output logic pwm);
  logic [7:0] phase;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) phase <= '0; else phase <= phase + 1'b1;
  end
  assign pwm = phase < level;
endmodule
`},
      {path:'constraints/pins.pcf',role:'constraint',content:'# Replace with board-specific package pins\n#set_io clk 21\n#set_io led 99\n'},
      {path:'docs/board.md',role:'documentation',content:'# FPGA board\n\nDocument device, package, oscillator frequency and I/O voltage.\n'},
    ],
    sensor_interface:[
      {path:'specs/sensor.yaml',role:'configuration',content:'quantity: temperature\nrange: [-40, 125]\nunit: degC\nbandwidth_hz: 10\nresolution_bits: 12\nsupply_v: 3.3\n'},
      {path:'analog/afe.spice',role:'simulation',content:'* Sensor analog front-end starting point\nVDD vdd 0 3.3\nVIN in 0 DC 0.5\nRIN in sense 10k\nCIN sense 0 10n\n.op\n.end\n'},
      {path:'simulation/afe_transient.cir',role:'testbench',content:`* Resistive sensor bridge, instrumentation gain and anti-alias pole
VDD vdd 0 3.3
VSENSE sensor 0 PULSE(0.3 1.2 1m 10u 10u 4m 10m)
RIN sensor n1 10k
RFB out n1 90k
EAMP out 0 VALUE={1.65 + 10*(V(sensor)-0.75)}
RFILT out adc 2.2k
CFILT adc 0 100n
RLOAD adc 0 100k
.tran 20u 20m
.print tran V(sensor) V(out) V(adc)
.end
`},
      {path:'schematic/afe.sch',role:'simulation',content:`v {xschem version=3.4.6 file_version=1.2}
G {}
K {}
V {}
S {}
E {}
N 180 -220 300 -220 {lab=SENSOR}
N 360 -220 500 -220 {lab=ADC_IN}
N 330 -190 330 -130 {lab=0}
C {devices/vsource.sym} 180 -190 0 0 {name=VSENSE value="pulse(0.3 1.2 1m 10u 10u 4m 10m)"}
C {devices/res.sym} 330 -220 1 0 {name=RFILT value=2.2k}
C {devices/capa.sym} 500 -190 0 0 {name=CFILT value=100n}
C {devices/gnd.sym} 180 -160 0 0 {name=l1 lab=0}
C {devices/gnd.sym} 500 -160 0 0 {name=l2 lab=0}
C {devices/lab_pin.sym} 300 -220 0 0 {name=l3 lab=SENSOR}
C {devices/lab_pin.sym} 500 -220 0 1 {name=l4 lab=ADC_IN}
`},
      {path:'cace/datasheet.yaml',role:'configuration',content:`name: sensor-afe
description: Sensor front-end gain and bandwidth characterization
PDK: ${pdk}
cace_format: 5.2
paths:
  root: ..
  schematic: schematic
  netlist: netlist
  documentation: docs
default_conditions:
  vdd: {display: VDD, unit: V, typical: 3.3}
  temperature: {display: Temperature, unit: °C, typical: 27}
parameters: {}
`},
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
      {path:'schematic/opamp.spice',role:'simulation',content:`* Technology-independent two-pole operational amplifier macromodel
.subckt opamp vinp vinn vout vdd vss
EGAIN n1 vss VALUE={100000*(V(vinp)-V(vinn))}
RDOM n1 n2 1k
CDOM n2 vss 15.9u
EOUT vout vss VALUE={limit(V(n2),V(vss)+0.1,V(vdd)-0.1)}
ROUT vout vss 10Meg
.ends opamp
`},
      {path:'simulation/testbench.spice',role:'testbench',content:`* Closed-loop non-inverting amplifier: DC, AC and transient checks
.include schematic/opamp.spice
VDD vdd 0 1.8
VIN in 0 DC 0.9 AC 1 SIN(0.9 0.05 10k)
XU1 in fb out vdd 0 opamp
RF out fb 90k
RG fb 0 10k
CL out 0 1p
.op
.ac dec 40 10 100Meg
.print ac V(out)
.tran 100n 200u
.print tran V(in) V(out)
.end
`},
      {path:'schematic/opamp.sch',role:'simulation',content:`v {xschem version=3.4.6 file_version=1.2}
G {}
K {}
V {}
S {}
E {}
N 180 -220 300 -220 {lab=VIN}
N 360 -220 500 -220 {lab=VOUT}
C {devices/vsource.sym} 180 -190 0 0 {name=VIN value="sin(0.9 0.05 10k)"}
C {devices/res.sym} 330 -220 1 0 {name=RIN value=10k}
C {devices/capa.sym} 500 -190 0 0 {name=CLOAD value=1p}
C {devices/gnd.sym} 180 -160 0 0 {name=l1 lab=0}
C {devices/gnd.sym} 500 -160 0 0 {name=l2 lab=0}
C {devices/lab_pin.sym} 300 -220 0 0 {name=l3 lab=VIN}
C {devices/lab_pin.sym} 500 -220 0 1 {name=l4 lab=VOUT}
`},
      {path:'cace/datasheet.yaml',role:'configuration',content:`name: opamp
description: Two-pole operational amplifier characterization scaffold
PDK: ${pdk}
cace_format: 5.2
paths:
  root: ..
  schematic: schematic
  netlist: netlist
  documentation: docs
default_conditions:
  vdd: {display: VDD, unit: V, minimum: 1.7, typical: 1.8, maximum: 1.9}
  corner: {display: Corner, typical: tt}
  temperature: {display: Temperature, unit: °C, minimum: -40, typical: 27, maximum: 125}
parameters: {}
`},
      {path:'layout/floorplan.md',role:'layout',content:'# Analog layout plan\n\nDocument matching, symmetry, guard rings, shielding and common-centroid structures.\n'},
      {path:'verification/checklist.md',role:'documentation',content:'# Sign-off checklist\n\n- [ ] Corners\n- [ ] Monte Carlo\n- [ ] DRC\n- [ ] LVS\n- [ ] PEX\n'},
    ],
    rf_frontend:[
      {path:'specs/rf.yaml',role:'configuration',content:'center_frequency_hz: 2.45e9\nbandwidth_hz: 100e6\nnoise_figure_db_max: 3\ngain_db_min: 15\ns11_db_max: -10\npdk: '+pdk+'\n'},
      {path:'schematic/lna.spice',role:'simulation',content:`* 2.45 GHz matched RLC front-end demonstrator
VIN in 0 AC 1
RS in n1 50
LMATCH n1 n2 3.3n
CMATCH n2 0 1.3p
EGAIN out 0 VALUE={5*V(n2)}
ROUT out 0 50
.ac dec 80 100Meg 10Gig
.print ac V(n2) V(out)
.end
`},
      {path:'schematic/lna.sch',role:'simulation',content:`v {xschem version=3.4.6 file_version=1.2}
G {}
K {}
V {}
S {}
E {}
N 160 -220 270 -220 {lab=RF_IN}
N 330 -220 450 -220 {lab=MATCHED}
C {devices/vsource.sym} 160 -190 0 0 {name=VIN value="ac 1"}
C {devices/ind.sym} 300 -220 1 0 {name=LMATCH value=3.3n}
C {devices/capa.sym} 450 -190 0 0 {name=CMATCH value=1.3p}
C {devices/gnd.sym} 160 -160 0 0 {name=l1 lab=0}
C {devices/gnd.sym} 450 -160 0 0 {name=l2 lab=0}
C {devices/lab_pin.sym} 270 -220 0 0 {name=l3 lab=RF_IN}
C {devices/lab_pin.sym} 450 -220 0 1 {name=l4 lab=MATCHED}
`},
      {path:'em/notch_filter.xml',role:'simulation',content:`<?xml version="1.0" encoding="UTF-8"?>
<openEMS>
  <FDTD NumberOfTimesteps="2000" endCriteria="1e-5">
    <Excitation Type="0" f0="2.45e9" fc="1.0e9"/>
    <BoundaryCond xmin="PML_8" xmax="PML_8" ymin="PML_8" ymax="PML_8" zmin="PML_8" zmax="PML_8"/>
  </FDTD>
  <ContinuousStructure CoordSystem="0">
    <RectilinearGrid DeltaUnit="0.001" CoordSystem="0">
      <XLines Qty="7">-30,-20,-10,0,10,20,30</XLines>
      <YLines Qty="7">-20,-10,-5,0,5,10,20</YLines>
      <ZLines Qty="6">-10,-1,0,1.6,5,10</ZLines>
    </RectilinearGrid>
    <Properties/>
  </ContinuousStructure>
</openEMS>
`},
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
      {path:'schematic/inverter.sch',role:'simulation',content:`v {xschem version=3.4.6 file_version=1.2}
G {}
K {}
V {}
S {}
E {}
N 180 -220 300 -220 {lab=A}
N 360 -220 500 -220 {lab=Y}
C {devices/vsource.sym} 180 -190 0 0 {name=VIN value=0}
C {devices/res.sym} 330 -220 1 0 {name=RPATH value=10}
C {devices/capa.sym} 500 -190 0 0 {name=CLOAD value=5f}
C {devices/gnd.sym} 180 -160 0 0 {name=l1 lab=0}
C {devices/gnd.sym} 500 -160 0 0 {name=l2 lab=0}
C {devices/lab_pin.sym} 300 -220 0 0 {name=l3 lab=A}
C {devices/lab_pin.sym} 500 -220 0 1 {name=l4 lab=Y}
`},
      {path:'cace/datasheet.yaml',role:'configuration',content:`name: inverter
description: Inverter timing, transition and energy characterization scaffold
PDK: ${pdk}
cace_format: 5.2
paths:
  root: ..
  schematic: schematic
  netlist: netlist
  documentation: docs
pins:
  A: {type: signal, direction: input}
  Y: {type: signal, direction: output}
  VDD: {type: power, direction: inout}
  VSS: {type: ground, direction: inout}
default_conditions:
  vdd: {display: VDD, unit: V, typical: 1.8}
  corner: {display: Corner, typical: tt}
  temperature: {display: Temperature, unit: °C, typical: 27}
parameters: {}
`},
      {path:'layout/README.md',role:'layout',content:'# Cell layout\n\nTarget a legal cell height and document pin access, rails and well structure.\n'},
      {path:'verification/truth_table.csv',role:'documentation',content:'A,Y\n0,1\n1,0\n'},
    ],
    blank_project:[
      {path:'design/README.md',role:'documentation',content:'# Design inputs\n\nAdd RTL, VHDL, SPICE, Xschem or openEMS sources here.\n'},
      {path:'verification/README.md',role:'documentation',content:'# Verification\n\nAdd testbenches, formal properties, expected results and acceptance criteria here.\n'},
      {path:'simulation/README.md',role:'documentation',content:'# Simulation\n\nAdd executable testbenches, sweeps and corner definitions here.\n'},
      {path:'constraints/README.md',role:'documentation',content:'# Constraints\n\nAdd timing, pin, power and physical constraints here.\n'},
      {path:'layout/README.md',role:'layout',content:'# Layout\n\nStore floorplans, process notes and physical-verification inputs here.\n'},
      {path:'docs/acceptance.md',role:'documentation',content:'# Acceptance criteria\n\n- [ ] Function defined\n- [ ] Verification plan approved\n- [ ] Reproducible run completed\n- [ ] Generated artifacts reviewed\n'},
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
      const watchdogIndex=files.findIndex(file=>file.path==='rtl/watchdog_timer.sv')
      if(project.kind==='microcontroller'&&watchdogIndex>=0&&files[watchdogIndex].content===legacyMicroWatchdog) {
        files[watchdogIndex]={...files[watchdogIndex],content:microWatchdog}
        changed=true
      }
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
      if(!missing.length&&files===project.files) return normalizeProjectExecution(project)
      if(missing.length) changed=true
      const upgradedProject=normalizeProjectExecution({...project,files})
      if(upgradedProject.files!==files)changed=true
      return upgradedProject
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
  let files=starterFiles(input.kind,input.name,input.pdk)
  if(input.language==='vhdl'&&['microcontroller','fpga_prototype'].includes(input.kind)) {
    files=files.filter(file=>!['.sv','.v'].some(extension=>file.path.endsWith(extension)))
    files.push(
      {path:'rtl/top.vhd',role:'source',content:`library ieee;
use ieee.std_logic_1164.all;
entity top is port(clk, rst_n : in std_logic; led : out std_logic); end entity;
architecture rtl of top is
  signal state : std_logic := '0';
begin
  process(clk) begin
    if rising_edge(clk) then
      if rst_n='0' then state <= '0'; else state <= not state; end if;
    end if;
  end process;
  led <= state;
end architecture;
`},
      {path:'tb/tb_top.vhd',role:'testbench',content:`library ieee;
use ieee.std_logic_1164.all;
entity tb_top is end entity;
architecture sim of tb_top is
  signal clk : std_logic := '0'; signal rst_n : std_logic := '0'; signal led : std_logic;
begin
  dut: entity work.top port map(clk=>clk,rst_n=>rst_n,led=>led);
  clk <= not clk after 5 ns;
  process begin wait for 12 ns; rst_n <= '1'; wait for 80 ns; report "PASS VHDL simulation"; wait; end process;
end architecture;
`},
    )
  }
  return {...input,id:crypto.randomUUID(),createdAt:now,updatedAt:now,files}
}
