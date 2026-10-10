import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './auth'
import type { RunResult } from './eda-results'

export interface PhysicalJob {
  job_id: string
  project_id?: string
  status: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
  created_at?: number
  started_at?: number
  jobs_ahead: number
  queue_position: number
  waiting_seconds: number
  elapsed_seconds: number
  queue_reason?: string
  live_output?: string
  stage?: string
  stage_label?: string
  tool?: string
  cpu_percent?: number
  memory_mb?: number
  disk_free_mb?: number
  last_activity_seconds_ago?: number
  process_alive?: boolean
  error?: string
  persistence_warning?: string
  result?: RunResult
  queue?: {
    running: number
    pending: number
    max_running: number
    cpu_threshold_percent: number
    resources: { cpu_capacity?: number; worker_cpu_percent?: number | null; host_cpu_percent?: number | null; memory_available_mb?: number; disk_free_mb?: number }
  }
}

const ACTIVE = new Set(['queued', 'running', 'cancelling'])
function detail(body: { detail?: unknown }, fallback: string): string {
  if (typeof body.detail === 'string') return body.detail
  if (Array.isArray(body.detail)) return body.detail.map(item => item.msg ?? '').join(' · ')
  return fallback
}

/** Own one poller per mounted project; polling never owns the server process. */
export function usePhysicalJob(projectId: string, locale: 'es' | 'en',
  onActive: (active: boolean) => void, onResult: (result: RunResult) => void) {
  const es = locale === 'es'
  const key = `opensemilab.activePhysical.${projectId}`
  const [job, setJob] = useState<PhysicalJob | null>(null)
  const [active, setActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const callbacks = useRef({ onActive, onResult })
  callbacks.current = { onActive, onResult }
  const scope = useRef({ generation: 0, mounted: false, controller: new AbortController() })
  const handled = useRef(new Set<string>())

  function valid(generation: number) { return scope.current.mounted && scope.current.generation === generation }
  function begin() {
    scope.current.controller.abort()
    scope.current.controller = new AbortController()
    return ++scope.current.generation
  }
  function markActive(value: boolean) { setActive(value); callbacks.current.onActive(value) }
  function remember(jobId: string) {
    try { localStorage.setItem(key, jobId) } catch { /* Server-side recovery is also available. */ }
  }
  function forget() { try { localStorage.removeItem(key) } catch { /* Optional local pointer. */ } }
  function receive(next: PhysicalJob) {
    if (handled.current.has(next.job_id) && ACTIVE.has(next.status)) return
    setJob(previous => previous?.job_id === next.job_id && previous.status === 'cancelling' && next.status === 'running' ? previous : next)
    setNotice('')
    if (!ACTIVE.has(next.status)) {
      forget()
      markActive(false)
      if (!handled.current.has(next.job_id)) {
        handled.current.add(next.job_id)
        if (next.status !== 'cancelled') {
          if (next.result) callbacks.current.onResult(next.result)
          else setError(next.error ?? (es ? 'El flujo terminó sin un resultado disponible.' : 'The flow ended without an available result.'))
        }
      }
    }
  }

  async function poll(jobId: string, generation: number) {
    remember(jobId)
    markActive(true)
    while (valid(generation)) {
      try {
        const response = await apiFetch(`/api/v1/eda/jobs/${jobId}`, { signal: scope.current.controller.signal })
        const body = await response.json()
        if (!valid(generation)) return
        if (response.status === 404 || response.status === 401 || response.status === 403) {
          forget(); markActive(false)
          setError(response.status === 404
            ? (es ? 'El trabajo ya no está disponible para esta cuenta. Los resultados se conservan temporalmente; descargue los archivos al terminar.' : 'This job is no longer available to this account. Results are kept temporarily; download files when the run completes.')
            : (es ? 'Inicie sesión para recuperar el estado del trabajo.' : 'Sign in to recover the job status.'))
          return
        }
        if (!response.ok) throw new Error(detail(body, `HTTP ${response.status}`))
        receive(body as PhysicalJob)
        if (!ACTIVE.has(body.status)) return
      } catch (reason) {
        if (!valid(generation) || (reason instanceof Error && reason.name === 'AbortError')) return
        setNotice(es ? 'Conexión interrumpida. Recuperando el estado automáticamente; su turno sigue guardado.' : 'Connection interrupted. Reconnecting automatically; your place is still saved.')
      }
      await new Promise(resolve => window.setTimeout(resolve, 2000))
    }
  }

  async function recover(generation: number) {
    let saved = ''
    try { saved = localStorage.getItem(key) ?? '' } catch { /* Continue with server discovery. */ }
    if (saved) { await poll(saved, generation); return }
    try {
      const response = await apiFetch('/api/v1/eda/jobs', { signal: scope.current.controller.signal })
      if (!response.ok || !valid(generation)) return
      const body = await response.json()
      const existing = (body.jobs ?? []).find((item: PhysicalJob) => item.project_id === projectId && ACTIVE.has(item.status))
      if (existing && valid(generation)) { setError(''); receive(existing); await poll(existing.job_id, generation) }
    } catch { /* No stored pointer: a failed lookup must not block other project tools. */ }
  }

  useEffect(() => {
    scope.current.mounted = true
    setJob(null); markActive(false); setError(''); setNotice(''); setCancelBusy(false)
    const generation = begin()
    void recover(generation)
    return () => { scope.current.mounted = false; scope.current.generation++; scope.current.controller.abort() }
  }, [projectId])

  async function submit(payload: Record<string, unknown>) {
    if (active || submitting) return
    const generation = begin()
    markActive(true); setSubmitting(true); setJob(null); setError(''); setNotice(''); setCancelBusy(false)
    const body = JSON.stringify({ ...payload, project_id: projectId, request_id: crypto.randomUUID() })
    try {
      // Retry an uncertain response with the same identifier, never a second job.
      for (let attempt = 0; attempt < 3 && valid(generation); attempt++) {
        try {
          const response = await apiFetch('/api/v1/eda/jobs', { method: 'POST', body, signal: scope.current.controller.signal })
          const created = await response.json()
          if (!valid(generation)) return
          if (!response.ok) {
            setError(detail(created, es ? 'No se pudo enviar el flujo.' : 'Could not submit the flow.'))
            markActive(false)
            if (response.status === 409) void recover(generation)
            return
          }
          receive(created)
          setSubmitting(false)
          await poll(created.job_id, generation)
          return
        } catch (reason) {
          if (!valid(generation)) return
          if (attempt === 2) throw reason
          setNotice(es ? 'Confirmando el envío de su trabajo…' : 'Confirming your job submission…')
          await new Promise(resolve => window.setTimeout(resolve, 1000))
        }
      }
    } catch {
      if (!valid(generation)) return
      markActive(false)
      setError(es ? 'No se pudo confirmar el envío. Comprobando si su trabajo ya está guardado en la cola…' : 'Could not confirm submission. Checking whether your job is already saved in the queue…')
      void recover(generation)
    } finally { if (valid(generation)) setSubmitting(false) }
  }

  async function cancel() {
    if (!job || cancelBusy || !ACTIVE.has(job.status)) return
    const generation = scope.current.generation
    setCancelBusy(true); setError('')
    try {
      const response = await apiFetch(`/api/v1/eda/jobs/${job.job_id}/cancel`, { method: 'POST', signal: scope.current.controller.signal })
      const body = await response.json()
      if (!valid(generation)) return
      if (!response.ok) throw new Error(detail(body, es ? 'No se pudo cancelar; intente nuevamente.' : 'Could not cancel; please retry.'))
      receive(body as PhysicalJob)
    } catch (reason) {
      if (valid(generation)) setError(reason instanceof Error ? reason.message : (es ? 'No se pudo cancelar.' : 'Could not cancel.'))
    } finally { if (valid(generation)) setCancelBusy(false) }
  }
  return { job, active, submitting, cancelBusy, error, notice, submit, cancel }
}
