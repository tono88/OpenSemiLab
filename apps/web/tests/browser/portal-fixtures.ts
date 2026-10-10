// Demonstration data for browser checks and annotated manual screenshots.
// Never used by a production entry point or to claim a real physical sign-off.
import type { Page } from '@playwright/test'

export const DEMO_VCD = '$timescale 1ns $end\n$scope module tb_top $end\n$var wire 1 ! clk $end\n$var wire 1 " rst_n $end\n$var wire 4 # counter $end\n$upscope $end\n$enddefinitions $end\n#0\n0!\n0"\nb0000 #\n#10\n1!\n#20\n0!\n1"\n#30\n1!\nb0001 #\n#40\n0!\n#50\n1!\nb0010 #\n#60\n0!\n#70\n1!\nb0011 #\n#80\n0!\n#90\n1!\nb0100 #\n#100\n0!\n'
const cells = Array.from({ length: 48 }, (_, i) => `- u${i} demo_cell + PLACED ( ${10000 + i % 8 * 11000} ${12000 + Math.floor(i / 8) * 14000} ) N ;`).join('\n')
const routes = Array.from({ length: 24 }, (_, i) => `- net${i} + ROUTED met${i % 3 + 1} ( ${10000 + i % 8 * 11000} ${12000 + Math.floor(i / 8) * 28000} ) ( * ${82000 - Math.floor(i / 8) * 9000} ) ( ${20000 + i % 8 * 11000} * ) ;`).join('\n')
export const DEMO_RESULT = {
  job_id: 'demoqueue001', action: 'physical', engine: 'LibreLane/OpenROAD', success: true, exit_code: 0,
  duration_ms: 184000, output: '[2026-10-09 18:04:00] [INFO] Example flow finished\n[WARNING] I/O constraints require review. Demonstration data, not a fabrication result.',
  artifacts: [{ name: 'final/demo.def', media_type: 'text/plain', content: `VERSION 5.8 ;\nUNITS DISTANCE MICRONS 1000 ;\nDIEAREA ( 0 0 ) ( 120000 120000 ) ;\nCOMPONENTS 48 ;\n${cells}\nEND COMPONENTS\nNETS 24 ;\n${routes}\nEND NETS\nEND DESIGN\n` }],
  summary: {
    schema: 'opensemilab.physical-summary/v1', pdk: 'sky130A', scl: 'sky130_fd_sc_hd', floorplan_mode: 'auto',
    die_area_um2: 14400, die_width_um: 120, die_height_um: 120, core_area_um2: 10000, stdcell_area_um2: 4000,
    target_utilization_pct: 40, actual_utilization_pct: 40, clock_period_ns: 25, cell_count: 48, wns_ns: 2.1, tns_ns: 0,
    drc_violations: 0, lvs_errors: 0, antenna_violations: 0, hold_violations: 0, setup_violations: 0,
    max_slew_violations: 0, max_cap_violations: 0, max_fanout_violations: 0, disconnected_pins: 0,
    critical_disconnected_pins: 0, power_grid_violations: 0, unmapped_cells: 0, setup_worst_slack_ns: 2.1, hold_worst_slack_ns: .08,
    constraint_scope: 'clock_only', signoff_status: 'review', production_ready: false,
    signoff_blockers: [], signoff_warnings: ['Review I/O constraints. Demonstration data.'],
    tapeout_readiness: { schema: 'opensemilab.tapeout-readiness/v1', status: 'review', level: 'hardened_block_candidate', production_ready: false,
      disclaimer: 'Demonstration data; not a fabrication approval.', checks: [{ id: 'io_constraints', label: 'I/O constraints', status: 'review', evidence: 'Only a clock constraint was supplied in this example.' }] },
  },
}

export async function installPortalFixtures(page: Page) {
  let job: Record<string, any> | null = null
  let submissions = 0
  let rejected = false
  let lostPolls = 0
  let lostSubmissions = 0
  let discovery = false
  await page.route('**/fonts.googleapis.com/**', route => route.abort())
  await page.route('**/fonts.gstatic.com/**', route => route.abort())
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const method = request.method()
    let status = 200, body: unknown = {}
    if (path === '/api/v1/auth/me') body = { id: '00000000000000000000000000000001', email: 'docente@example.edu', name: 'Cuenta de demostración', role: 'admin' }
    else if (path === '/api/v1/projects') body = []
    else if (path === '/api/v1/pdks') body = []
    else if (path === '/api/v1/eda/capabilities') body = { ready: true, tools: Object.fromEntries(['verible_lint','verilator','yosys','iverilog','vvp','librelane','ghdl','sby','nextpnr_ice40','gds3d','ngspice','xyce','xschem','cace','openems'].map(key => [key, { available: true }])), integrations: [{ tool: 'librelane', available: true, level: 'direct', purpose: 'RTL-to-GDSII' }] }
    else if (path === '/api/v1/design/templates') { status = 503; body = { detail: 'Use the built-in template catalog in this fixture.' } }
    else if (path === '/api/v1/design/plan') body = { ...request.postDataJSON(), stages: [] }
    else if (path === '/api/v1/eda/jobs' && method === 'GET') body = { jobs: discovery && job ? [job] : [] }
    else if (path === '/api/v1/eda/jobs' && method === 'POST') {
      submissions++
      if (rejected) { status = 429; body = { detail: 'La cola física está llena. Espere a que se libere un turno.' } }
      else {
        const input = request.postDataJSON()
        job ??= { job_id: 'demoqueue001', project_id: input.project_id, status: 'queued', created_at: Date.now() / 1000 - 75,
          elapsed_seconds: 0, waiting_seconds: 75, queue_position: 3, jobs_ahead: 2, queue_reason: 'cpu_busy', process_alive: false,
          queue: { running: 1, pending: 3, max_running: 1, cpu_threshold_percent: 60, resources: { worker_cpu_percent: 72, host_cpu_percent: 35, cpu_capacity: 4, memory_available_mb: 3600 } } }
        body = job; status = 202
        if (lostSubmissions > 0) { lostSubmissions--; await route.abort(); return }
      }
    } else if (path.endsWith('/cancel')) {
      if (job) { job = { ...job, status: job.status === 'queued' ? 'cancelled' : 'cancelling' }; body = job; status = 202 }
      else { status = 404; body = { detail: 'Trabajo no encontrado.' } }
    } else if (path.startsWith('/api/v1/eda/jobs/')) {
      if (lostPolls > 0) { lostPolls--; await route.abort(); return }
      if (job) body = job
      else { status = 404; body = { detail: 'Trabajo no encontrado.' } }
    } else if (path === '/api/v1/eda/run') {
      const action = request.postDataJSON().action
      body = { job_id: 'demorun001', action, engine: action === 'simulate' ? 'iverilog/vvp' : action === 'synthesize' ? 'yosys' : 'Verible', success: true, exit_code: 0, duration_ms: 42,
        output: `[2026-10-09 18:00:00] [INFO] ${action} example completed\n[PASS] Demonstration fixture`,
        artifacts: action === 'simulate' ? [{ name: 'waveform.vcd', media_type: 'text/plain', content: DEMO_VCD }] : [] }
    } else if (path === '/api/v1/admin/stats') body = { users: 12, verified: 10, admins: 1, projects: 8, events: 42, by_tool: { yosys: 12 }, by_action: { simulate: 8 } }
    else if (path === '/api/v1/admin/smtp') body = { enabled: true, host: 'mail.example.edu', port: 587, encryption: 'starttls', username: 'laboratorio@example.edu', from_email: 'laboratorio@example.edu', from_name: 'OpenSemiLab', has_password: true, updated_by: '', updated_at: '' }
    else if (path.startsWith('/api/v1/admin/')) body = []
    else if (path.startsWith('/api/v1/projects/') || path.includes('/events')) body = {}
    else { status = 503; body = { detail: 'No external solver in this demonstration fixture.' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return {
    submissions: () => submissions,
    job: () => job,
    update: (fields: Record<string, any>) => { if (job) job = { ...job, ...fields } },
    full: () => { rejected = true },
    interruptPoll: (count = 1) => { lostPolls = count },
    loseSubmissionResponse: () => { lostSubmissions = 1 },
    discover: () => { discovery = true },
  }
}

export async function openDemoProject(page: Page) {
  await page.goto('/#/lab')
  await page.getByRole('button', { name: 'Crear flujo de diseño' }).click()
  await page.locator('.project-toolbar').waitFor()
}

export async function openPhysical(page: Page) {
  await page.locator('.wizard-nav button').nth(3).click()
  await page.getByRole('button', { name: /Ejecutar flujo completo RTL/ }).waitFor()
}
