import type { ProjectFile } from './projectStore'

// Raw assets stay readable as normal HDL, SPICE, Python and Markdown files.
// Vite embeds them in the browser bundle; creating a project needs no downloads.
const assets = import.meta.glob<string>('./templates/**/*', { query: '?raw', import: 'default', eager: true, exhaustive: true })

export const STARTER_VERSION = 2

const execution: Record<string, Record<string, string>> = {
  microcontroller: { rtl_top: 'top', testbench_top: 'tb_top', fpga_top: 'top_fpga_top' },
  sensor_interface: { rtl_top: 'sensor_ctrl', testbench_top: 'tb_sensor_ctrl', spice_entry: 'simulation/afe_transient.cir' },
  analog_block: { spice_entry: 'simulation/testbench.spice' },
  rf_frontend: { spice_entry: 'simulation/rf_ac.cir' },
  standard_cell: { rtl_top: 'inverter', testbench_top: 'tb_inverter', spice_entry: 'simulation/tb_inverter.spice' },
  fpga_prototype: { rtl_top: 'top', testbench_top: 'tb_top', fpga_top: 'top' },
  blank_project: {},
}

function role(path: string): ProjectFile['role'] {
  if (/\.(sv|v|vhd|vhdl)$/.test(path)) {
    if (path.startsWith('verification/formal/')) return 'configuration'
    return /(^|\/)tb_/.test(path) ? 'testbench' : 'source'
  }
  if (path.endsWith('.sdc') || path.endsWith('.pcf')) return 'constraint'
  if (/\.(spice|cir|ckt|lib|sch|xml)$/.test(path)) return path.startsWith('simulation/') ? 'testbench' : 'simulation'
  if (path.startsWith('layout/')) return 'layout'
  if (/\.(json|yaml|yml|sby)$/.test(path) || path === 'Makefile') return 'configuration'
  return 'documentation'
}

function filesFor(folder: string, name: string, pdk: string): ProjectFile[] {
  const prefix = `./templates/${folder}/`
  return Object.entries(assets).filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([key, content]) => {
    const path = key.slice(prefix.length)
    return { path, role: role(path), content: content.replaceAll('{{NAME}}', () => name).replaceAll('{{PDK}}', () => pdk) }
  })
}

function makefile(files: ProjectFile[], config: Record<string, string>, kind: string, language: string): string {
  const rtl = files.filter(file => file.role === 'source' && /\.(sv|v)$/.test(file.path)).map(file => file.path).join(' ')
  const benches = files.filter(file => file.role === 'testbench' && file.path.endsWith('.sv')).map(file => file.path).join(' ')
  const vhdl = [...files.filter(file => file.role === 'source' && file.path.endsWith('.vhd')), ...files.filter(file => file.role === 'testbench' && file.path.endsWith('.vhd'))].map(file => file.path).join(' ')
  const digital = Boolean(rtl || vhdl), analog = Boolean(config.spice_entry)
  const targets = [...(digital ? ['sim'] : []), ...(analog ? ['spice'] : []), ...(kind === 'rf_frontend' ? ['rf'] : [])]
  const lines = [
    '# Ejecutar desde la raiz del proyecto descargado. No requiere Docker local.',
    '# make test termina con error si una comprobacion funcional falla.',
    'PYTHON ?= python3', 'IVERILOG ?= iverilog', 'VVP ?= vvp', 'YOSYS ?= yosys', 'GHDL ?= ghdl', 'NGSPICE ?= ngspice',
    '.PHONY: test check sim synth spice rf formal', 'test: check ' + targets.join(' '),
    'check:', '\t$(PYTHON) scripts/check_project.py', '',
  ]
  if (digital && language !== 'vhdl') lines.push(
    'sim:', '\tmkdir -p build', `\t$(IVERILOG) -g2012 -s ${config.testbench_top} -o build/test.vvp ${rtl} ${benches}`, '\t$(VVP) build/test.vvp',
    '', 'synth:', '\tmkdir -p build', `\t$(YOSYS) -p 'read_verilog -sv ${rtl}; hierarchy -check -top ${config.rtl_top}; proc; opt; check -assert; stat; write_json build/netlist.json'`, '',
  )
  if (vhdl) lines.push('sim:', '\tmkdir -p build', `\t$(GHDL) -a --std=08 --workdir=build ${vhdl}`, `\t$(GHDL) -e --std=08 --workdir=build ${config.testbench_top}`, `\t$(GHDL) -r --std=08 --workdir=build ${config.testbench_top} --assert-level=error --vcd=build/waveform.vcd`, '')
  if (analog) lines.push('spice:', '\tmkdir -p build', `\t$(NGSPICE) -b -o build/spice.log ${config.spice_entry} || { tail -n 80 build/spice.log; exit 1; }`, '\t$(PYTHON) scripts/check_spice.py build/spice.log', '')
  if (kind === 'rf_frontend') lines.push('rf:', '\t$(PYTHON) scripts/rf_network.py', '')
  const formal = files.find(file => file.path.endsWith('.sby'))
  if (formal) lines.push('formal:', `\tsby -f ${formal.path}`, '')
  return lines.join('\n') + '\n'
}

export function createStarterFiles(kind: string, name: string, pdk: string, language = 'systemverilog'): ProjectFile[] {
  if (!execution[kind]) throw new Error(`Unknown starter template: ${kind}`)
  let files = [...filesFor('common', name, pdk), ...filesFor(kind, name, pdk)]
  const isVhdl = language === 'vhdl' && ['microcontroller', 'fpga_prototype'].includes(kind)
  const config = { ...execution[kind] }
  if (isVhdl) {
    // Separate HDL variants: never mix a VHDL entity and an unrelated SV top.
    files = files.filter(file => !/\.(sv|sby|pcf|sdc)$/.test(file.path))
    files = files.filter(file => !['README.md', 'docs/architecture.md', 'docs/registers.md'].includes(file.path))
    files.push(...filesFor('vhdl', name, pdk))
    delete config.fpga_top
  }
  const unique = new Map(files.map(file => [file.path, file]))
  files = [...unique.values()]
  const manifest = {
    schema: 'opensemilab.project/v3', name, kind, pdk,
    starter: { id: kind, version: STARTER_VERSION, language: isVhdl ? 'vhdl' : 'systemverilog', scope: kind === 'blank_project' ? 'structured-workspace' : 'tested-starter-not-foundry-signoff' },
    execution: config,
    physical: { clock_port: 'clk', clock_period_ns: 25, floorplan_mode: 'auto', die_width_um: 120, die_height_um: 120, core_utilization_pct: 40, timing_effort: 'balanced' },
    adapters: { formal: kind === 'standard_cell' ? { depth: 2, mode: 'prove' } : { depth: 24, mode: 'bmc' }, fpga: { device: 'up5k', package: 'sg48', frequency_mhz: 12 } },
  }
  files.unshift({ path: 'project.json', role: 'configuration', content: JSON.stringify(manifest, null, 2) + '\n' })
  files.push({ path: 'Makefile', role: 'configuration', content: makefile(files, config, kind, isVhdl ? 'vhdl' : 'systemverilog') })
  return files
}
