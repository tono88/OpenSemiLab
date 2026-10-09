import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fixtures, loadFactories, KINDS } from '../scripts/template-fixtures.mjs'

const { starters, store, archive } = await loadFactories()
const projects = await fixtures()

for (const [kind, files] of Object.entries(projects)) {
  test(`${kind}: complete, unique, portable, commented starter`, () => {
    assert.ok(files.length >= 12, `${kind}: expected a useful multi-file starter`)
    const paths = files.map(file => file.path)
    assert.equal(new Set(paths).size, paths.length)
    for (const required of ['README.md', 'project.json', 'Makefile', 'docs/QUICKSTART.md', 'docs/CUSTOMIZATION.md', 'docs/ACCEPTANCE.md', 'scripts/check_project.py']) assert.ok(paths.includes(required), required)
    for (const file of files) {
      assert.ok(!file.path.startsWith('/') && !file.path.split('/').includes('..'))
      assert.ok(file.content.trim().length > 0)
      assert.ok(!/\{\{(NAME|PDK)\}\}/.test(file.content))
      if (file.role === 'source') assert.match(file.content, /\/\/|--/, `${file.path}: missing explanation`)
    }
    const manifest = JSON.parse(files.find(file => file.path === 'project.json').content)
    assert.equal(manifest.starter.version, starters.STARTER_VERSION)
    if (manifest.execution.spice_entry) {
      assert.ok(paths.includes(manifest.execution.spice_entry))
      assert.ok(paths.includes('verification/spice_checks.json'))
      assert.match(files.find(file => file.path === manifest.execution.spice_entry).content, /\.meas/i)
    }
    if (kind.endsWith('_vhdl')) {
      assert.ok(!paths.some(file => /\.(sv|sby)$/.test(file)))
      assert.match(files.find(file => file.path === 'tb/tb_top.vhd').content, /severity failure/)
      assert.match(files.find(file => file.path === 'tb/tb_top.vhd').content, /std\.env\.stop/)
    } else if (manifest.execution.rtl_top) {
      assert.ok(files.some(file => file.role === 'testbench' && /\$fatal/.test(file.content)))
    }
  })
}

test('metadata substitutions preserve dollars and never interpret user text as JS', () => {
  const name = 'Chip $& ${process.env.SECRET}'
  const files = starters.createStarterFiles('analog_block', name, 'private:demo')
  assert.ok(files.find(file => file.path === 'README.md').content.includes(name))
  assert.equal(JSON.parse(files[0].content).name, name)
})

test('blank means blank: no hidden circuit or falsely enabled execution', () => {
  const files = projects.blank_project
  assert.deepEqual(JSON.parse(files[0].content).execution, {})
  assert.ok(!files.some(file => file.role === 'source'))
})

test('v2 reload preserves user edits and deletions without injecting starter files', () => {
  const original = store.createProject({ name: 'Edited', kind: 'microcontroller', pdk: 'sky130A', level: 'guided', language: 'systemverilog' })
  const modified = { ...original, files: original.files.filter(file => file.path !== 'rtl/top_fpga_top.sv').map(file => file.path === 'rtl/top.sv' ? { ...file, content: '// My own design\nmodule top; endmodule\n' } : file) }
  let state = JSON.stringify([modified])
  globalThis.localStorage = { getItem: () => state, setItem: (_, value) => { state = value } }
  assert.deepEqual(store.loadProjects(), [modified])
})

test('legacy project is not upgraded to an incompatible v2 architecture', () => {
  const legacy = { id: 'legacy', name: 'Old', kind: 'microcontroller', pdk: 'sky130A', language: 'systemverilog', files: [{ path: 'rtl/top.sv', role: 'source', content: '// User implementation\nmodule top; endmodule\n' }] }
  let state = JSON.stringify([legacy])
  globalThis.localStorage = { getItem: () => state, setItem: (_, value) => { state = value } }
  const reloaded = store.loadProjects()[0]
  assert.equal(reloaded.files.find(file => file.path === 'rtl/top.sv').content, legacy.files[0].content)
  assert.ok(!reloaded.files.some(file => file.path === 'rtl/top_fpga_top.sv'))
  assert.ok(!JSON.parse(reloaded.files.find(file => file.path === 'project.json').content).starter)
})

test('source ZIP is a real archive with valid CRCs and exact UTF-8 files', () => {
  const files = [...projects.sensor_interface, { path: 'docs/accent.md', role: 'documentation', content: '# Configuración µm\n' }]
  const zip = archive.createProjectArchive(files)
  const python = spawnSync('python3', ['-c', `import base64, io, json, sys, zipfile
payload = json.load(sys.stdin)
with zipfile.ZipFile(io.BytesIO(base64.b64decode(payload['zip']))) as z:
    assert z.testzip() is None
    assert z.namelist() == [f['path'] for f in payload['files']]
    for f in payload['files']:
        assert z.read(f['path']).decode('utf-8') == f['content']
print('PASS ZIP round trip')`], { input: JSON.stringify({ zip: Buffer.from(zip).toString('base64'), files }), encoding: 'utf8' })
  assert.equal(python.status, 0, python.stderr)
  assert.match(python.stdout, /PASS/)
  assert.deepEqual(archive.createProjectArchive(files), zip)
})

test('source ZIP rejects traversal, duplicate names and empty bundles', () => {
  for (const name of ['../secret', '/etc/passwd', 'a/../b', 'a//b', 'a\\b']) assert.throws(() => archive.createProjectArchive([{ path: name, content: '', role: 'source' }]))
  assert.throws(() => archive.createProjectArchive([projects.microcontroller[0], projects.microcontroller[0]]))
  assert.throws(() => archive.createProjectArchive([]))
})

test('all frontend template kinds are supplied by the factory', () => {
  assert.equal(KINDS.length, 7)
  assert.throws(() => starters.createStarterFiles('unknown', 'Broken', 'sky130A'))
})
