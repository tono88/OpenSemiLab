from typing import Literal

from pydantic import BaseModel, Field


ProjectKind = Literal[
    "microcontroller", "sensor_interface", "analog_block", "rf_frontend",
    "standard_cell", "fpga_prototype", "blank_project"
]
PdkName = str
ExperienceLevel = Literal["guided", "engineering", "expert"]


class DesignTemplate(BaseModel):
    id: ProjectKind
    title: str
    description: str
    outputs: list[str]
    recommended_pdk: PdkName
    tags: list[str]


class DesignRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: ProjectKind
    pdk: PdkName = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")
    level: ExperienceLevel = "guided"
    language: Literal["systemverilog", "verilog", "vhdl", "schematic"] = "systemverilog"


class DesignStage(BaseModel):
    id: str
    title: str
    purpose: str
    tools: list[str]
    output: str
    status: Literal["ready", "adapter_pending", "optional"]


class DesignPlan(BaseModel):
    project: DesignRequest
    stages: list[DesignStage]
    runner: str
    runner_available: bool
    notice: str


TEMPLATES = [
    DesignTemplate(id="microcontroller", title="Microcontroller / peripheral subsystem", description="Register bus, GPIO, programmable timer, watchdog, self-checking tests and FPGA wrapper. A documented base for integrating a CPU, not a complete RISC-V core.", outputs=["tested RTL", "register map", "formal watchdog", "FPGA wrapper"], recommended_pdk="sky130A", tags=["digital", "peripherals", "ASIC"]),
    DesignTemplate(id="sensor_interface", title="Smart sensor interface", description="Signed sample averaging, calibration, saturation and ready/valid flow control, plus an independently tested analog gain/RC filter model.", outputs=["digital regression", "SPICE measurements", "error budget"], recommended_pdk="gf180mcuD", tags=["sensor", "analog", "mixed-signal"]),
    DesignTemplate(id="analog_block", title="Analog integrated block", description="Executable amplifier macromodel with AC/transient measurements, numerical acceptance checks and parameter sweep. Includes a roadmap to transistor-level design.", outputs=["AC/transient plots", "measured gain", "macromodel sweep"], recommended_pdk="sky130A", tags=["analog", "SPICE", "layout"]),
    DesignTemplate(id="rf_frontend", title="RF front-end", description="Runnable LC matching network, AC sweep and analytical two-port S-parameters with Touchstone export. Documents the separate path to real EM extraction.", outputs=["RF AC response", "Touchstone", "passivity checks"], recommended_pdk="ihp-sg13g2", tags=["RF", "matching", "EM"]),
    DesignTemplate(id="standard_cell", title="Standard cell / reusable IP", description="CMOS inverter with generic transistor models, truth-table regression, formal properties, voltage transfer and propagation-delay measurements.", outputs=["tested logic", "VTC and delays", "characterization plan"], recommended_pdk="sky130A", tags=["IP", "characterization", "library"]),
    DesignTemplate(id="fpga_prototype", title="FPGA prototype", description="Parameterized PWM dimmer and heartbeat with synchronized/debounced button, duty-cycle tests and documented iCE40 board configuration.", outputs=["PWM regression", "synthesizable RTL", "board checklist"], recommended_pdk="sky130A", tags=["FPGA", "prototype", "digital"]),
    DesignTemplate(id="blank_project", title="Blank structured project", description="Validated manifest, workflow recipes, interface guidance and acceptance plan, without forcing an example circuit into your design.", outputs=["validated manifest", "verification plan", "workflow recipes"], recommended_pdk="sky130A", tags=["blank", "structure", "custom"]),
]


def stage(id: str, title: str, purpose: str, tools: list[str], output: str, status: str = "adapter_pending") -> DesignStage:
    return DesignStage(id=id, title=title, purpose=purpose, tools=tools, output=output, status=status)


def make_plan(project: DesignRequest) -> DesignPlan:
    digital_physical_supported = project.pdk in {"sky130A", "gf180mcuD"}
    rtl_runner_available = project.kind in {"microcontroller", "fpga_prototype", "sensor_interface", "standard_cell"}
    spice_runner_available = project.kind in {"sensor_interface", "analog_block", "standard_cell", "rf_frontend"}
    flows: dict[str, list[DesignStage]] = {
        "microcontroller": [
            stage("architecture", "Architecture & IP", "Define CPU, memories, buses, registers and peripherals.", ["FuseSoC", "Kactus2", "RISC-V toolchain", "rggen"], "IP-XACT and core manifest"),
            stage("rtl", "RTL & simulation", "Write, lint and verify behavior before synthesis.", ["Verible", "Verilator", "cocotb", "GTKWave", "pyUVM"], "verified RTL and coverage"),
            stage("formal", "Formal verification", "Prove key properties and equivalence.", ["Yosys SBY", "ABC", "EQY"], "property and equivalence reports"),
            stage("physical", "RTL to GDSII", "Synthesize, floorplan, place, route and close timing.", ["Yosys", "LibreLane", "OpenROAD", "OpenSTA"], "GDSII, DEF and timing reports", "ready"),
            stage("signoff", "Physical verification", "Check geometry, connectivity and extracted behavior.", ["KLayout", "Magic", "Netgen", "KLayout PEX"], "DRC/LVS/PEX reports", "ready"),
        ],
        "sensor_interface": [
            stage("requirements", "Sensor requirements", "Capture range, sensitivity, noise, bandwidth and power budgets.", ["OpenSemiLab"], "engineering specification", "ready"),
            stage("frontend", "Analog front-end", "Design bias, amplification, filtering and conversion circuits.", ["Xschem", "ngspice", "Xyce", "pygmid"], "corner-tested schematic", "ready"),
            stage("mixed", "Mixed-signal verification", "Co-simulate the analog front-end and digital controller.", ["spicebind", "ngspice", "Verilator", "cocotb"], "mixed-signal regression"),
            stage("layout", "Layout & extraction", "Create geometry and verify post-layout behavior.", ["KLayout", "Magic", "Netgen", "KLayout PEX"], "verified GDSII"),
            stage("digital", "Digital control", "Implement calibration, communications and register logic.", ["Verible", "Icarus Verilog", "Yosys", "LibreLane", "OpenROAD"], "digital macro", "ready"),
        ],
        "analog_block": [
            stage("sizing", "Topology & sizing", "Select topology and calculate initial transistor dimensions.", ["pygmid", "Xschem", "hdl21"], "sized schematic", "ready"),
            stage("simulation", "SPICE verification", "Run operating point, AC, transient, noise, corners and Monte Carlo.", ["ngspice", "Xyce", "CACE", "chipify", "PyOPUS"], "performance and yield report", "ready"),
            stage("layout", "Custom layout", "Draw matched geometry with PDK-aware rules.", ["KLayout", "Magic"], "GDSII"),
            stage("verification", "DRC / LVS / PEX", "Verify rules, connectivity and extracted performance.", ["KLayout", "gdscheck", "Netgen", "KLayout PEX"], "signoff candidate"),
        ],
        "rf_frontend": [
            stage("circuit", "RF circuit", "Run the LC starter, then extend it with compact models and bias circuitry.", ["Xschem", "Qucs-S", "ngspice", "VACASK"], "circuit response", "ready"),
            stage("passives", "Passive structures", "Create inductors, lines, pads and layout structures.", ["gdsfactory", "KLayout", "GDS3D"], "passive GDS"),
            stage("em", "Electromagnetic solve", "Extract S-parameters and field behavior.", ["openEMS", "Palace", "gds2palace", "scikit-rf"], "Touchstone data"),
            stage("cosim", "Circuit / EM co-simulation", "Bring extracted passives back into circuit verification.", ["snp2le", "ngspice", "Qucs-S"], "co-simulation report"),
        ],
        "standard_cell": [
            stage("function", "Cell function", "Define schematic, truth table and electrical constraints.", ["Verible", "Icarus Verilog", "Yosys", "ngspice"], "validated netlist", "ready"),
            stage("layout", "Cell layout", "Create a track-compatible reusable physical cell.", ["KLayout", "Magic"], "GDS and LEF"),
            stage("verify", "Physical verification", "Run DRC, LVS, ERC and extraction.", ["gdscheck", "Netgen", "CVC", "KLayout PEX"], "verification reports"),
            stage("characterize", "Characterization", "Generate timing, power and noise models.", ["CharLib", "lctime", "CACE"], "Liberty models"),
            stage("package", "Library packaging", "Version cells and their views for reuse.", ["LibMan", "open_pdks"], "versioned IP library"),
        ],
        "fpga_prototype": [
            stage("rtl", "RTL & tests", "Develop and verify the architecture.", ["Verilator", "Icarus Verilog", "GHDL", "cocotb"], "verified RTL", "ready"),
            stage("synthesis", "FPGA synthesis", "Map the design to FPGA primitives.", ["Yosys"], "technology netlist"),
            stage("pnr", "Place & route", "Implement the design on the selected device.", ["nextpnr", "Project IceStorm", "Project Trellis"], "FPGA bitstream"),
        ],
        "blank_project": [
            stage("design", "Design inputs", "Add source, schematic or model files without replacing the project structure.", ["OpenSemiLab"], "versioned design inputs", "ready"),
            stage("verification", "Verification", "Add tests, properties and sign-off criteria for the selected design domain.", ["Open EDA tools"], "verification evidence", "ready"),
            stage("implementation", "Implementation", "Configure the digital, analog or physical implementation route.", ["Open EDA tools"], "implementation artifacts", "optional"),
        ],
    }
    selected_stages = [stage.model_copy(deep=True) for stage in flows[project.kind]]
    if not digital_physical_supported:
        for item in selected_stages:
            if item.id in {"physical", "signoff", "digital"}:
                item.status = "adapter_pending"
    if project.pdk.startswith("private:"):
        notice = (
            "The project references a locally registered private PDK. RTL and simulation remain available. "
            "Physical implementation is enabled only when its private registry profile passes the LibreLane/OpenPDKs readiness checks."
        )
    elif not digital_physical_supported and project.kind in {"microcontroller", "sensor_interface", "standard_cell"}:
        notice = (
            "RTL and simulation tools remain executable, but automated RTL-to-GDSII is not connected for the selected PDK. "
            "Use SKY130/GF180 for the integrated digital flow, or treat this project as a research/migration scaffold."
        )
    else:
        notice = (
            "RTL, formal, FPGA, SPICE simulation with ngspice/Xyce, and specialized open EDA adapters are executable in the isolated EDA flow. "
            "LibreLane physical implementation is available for SKY130/GF180. Mixed-signal co-simulation remains in development."
            if rtl_runner_available and spice_runner_available
            else "RTL lint, simulation and synthesis are executable; LibreLane RTL-to-GDSII is available for SKY130/GF180 projects."
            if rtl_runner_available
            else "SPICE/Xyce, Xschem, CACE and openEMS adapters are executable in the isolated EDA flow."
            if spice_runner_available
            else "This engineering flow is planned; its isolated execution adapter remains in development."
        )
    return DesignPlan(
        project=project,
        stages=selected_stages,
        runner="OpenSemiLab isolated EDA flow",
        runner_available=rtl_runner_available or spice_runner_available,
        notice=notice,
    )
