// Exercise the SAME TS factory and raw assets used by Vite, without a browser.
// Runtime type-only imports disappear; raw imports are supplied from disk.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const web = fileURLToPath(new URL('../', import.meta.url))

async function dataModule(filename, transform = text => text) {
  const text = transform(await readFile(path.join(web, 'src', filename), 'utf8'))
  const outputText = stripTypeScriptTypes(text, { mode: 'strip' })
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
}

async function rawAssets() {
  const assets = {}
  async function walk(folder) {
    for (const entry of await readdir(path.join(web, 'src', folder), { withFileTypes: true })) {
      const relative = path.posix.join(folder, entry.name)
      if (entry.isDirectory()) await walk(relative)
      else assets['./' + relative] = await readFile(path.join(web, 'src', relative), 'utf8')
    }
  }
  await walk('templates')
  return assets
}

export async function loadFactories() {
  const assets = await rawAssets()
  const startersUrl = await dataModule('starterTemplates.ts', text => text.replace(/^const assets = import\.meta\.glob.*$/m, 'const assets = ' + JSON.stringify(assets)))
  const projectStoreUrl = await dataModule('projectStore.ts', text => text.replace("from './starterTemplates'", `from '${startersUrl}'`))
  return {
    starters: await import(startersUrl),
    store: await import(projectStoreUrl),
    archive: await import(await dataModule('projectArchive.ts')),
  }
}

export const KINDS = ['microcontroller', 'sensor_interface', 'analog_block', 'rf_frontend', 'standard_cell', 'fpga_prototype', 'blank_project']

export async function fixtures() {
  const { starters } = await loadFactories()
  const projects = Object.fromEntries(KINDS.map(kind => [kind, starters.createStarterFiles(kind, 'CI starter', 'sky130A')]))
  projects.microcontroller_vhdl = starters.createStarterFiles('microcontroller', 'VHDL MCU', 'sky130A', 'vhdl')
  projects.fpga_prototype_vhdl = starters.createStarterFiles('fpga_prototype', 'VHDL FPGA', 'sky130A', 'vhdl')
  return projects
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(await fixtures()))
}
