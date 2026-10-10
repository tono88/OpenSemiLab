import type { PhysicalJob } from './usePhysicalJob'
import './physical-queue.css'

export function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return value < 60 ? `${value}s` : value < 3600 ? `${Math.floor(value / 60)}m ${value % 60}s` : `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m`
}

export function physicalJobLabel(job: PhysicalJob | null, es: boolean): string {
  if (!job) return es ? 'Enviando trabajo…' : 'Submitting job…'
  const labels = es
    ? { queued: 'En cola', running: 'En ejecución', cancelling: 'Cancelando', completed: 'Flujo terminado', failed: 'Revisar resultado', cancelled: 'Trabajo cancelado' }
    : { queued: 'Queued', running: 'Running', cancelling: 'Cancelling', completed: 'Flow finished', failed: 'Review result', cancelled: 'Job cancelled' }
  return labels[job.status]
}

export default function PhysicalJobStatus({ job, submitting, cancelBusy, notice, error, locale, onCancel }: {
  job: PhysicalJob | null; submitting: boolean; cancelBusy: boolean; notice: string; error: string; locale: 'es' | 'en'; onCancel: () => void
}) {
  const es = locale === 'es'
  if (!job && !submitting && !error && !notice) return null
  const waiting = job?.status === 'queued'
  const active = job && ['queued', 'running', 'cancelling'].includes(job.status)
  const threshold = job?.queue?.cpu_threshold_percent ?? 60
  const reason = es ? {
    cpu_busy: `La carga de CPU supera el ${threshold} %. El flujo empezará cuando haya recursos y llegue su turno.`,
    concurrency_limit: 'Otro flujo físico ocupa el turno de ejecución. Su trabajo iniciará automáticamente al liberarse.',
    measuring: 'Comprobando la carga antes de iniciar otro flujo pesado.',
    memory_low: 'Esperando memoria disponible para ejecutar el flujo con margen suficiente.',
    disk_low: 'Esperando espacio en disco. El administrador debe liberar o ampliar el volumen de trabajos.',
    admission_unavailable: 'El servicio no puede comprobar los recursos. El turno se conserva mientras se recupera.',
    waiting_turn: 'Trabajo aceptado. Preparando su turno de ejecución.',
  } : {
    cpu_busy: `CPU load exceeds ${threshold}%. The flow will start when resources and your turn are available.`,
    concurrency_limit: 'Another physical flow is using the execution slot. Your job will start automatically when it becomes free.',
    measuring: 'Checking load before starting another heavy flow.',
    memory_low: 'Waiting for enough available memory to run with headroom.',
    disk_low: 'Waiting for disk space. An administrator needs to free or expand the job volume.',
    admission_unavailable: 'Resource checks are unavailable. Your place is saved while the service recovers.',
    waiting_turn: 'Job accepted. Preparing your execution slot.',
  }
  const capacity = job?.queue?.resources.cpu_capacity
  const cpu = typeof job?.cpu_percent === 'number' && capacity ? Math.min(100, job.cpu_percent / capacity).toFixed(1) : null
  return <section className={`physical-job-card ${job?.status ?? 'submitting'}`} aria-label={es ? 'Estado del trabajo físico' : 'Physical job status'}>
    <div className="physical-job-heading"><div role="status" aria-live="polite"><span>{es ? 'RTL → GDSII · TURNO COMPARTIDO' : 'RTL → GDSII · SHARED QUEUE'}</span><h3>{physicalJobLabel(job, es)}{waiting && <small>{es ? `${job.jobs_ahead} ${job.jobs_ahead === 1 ? 'trabajo antes del suyo' : 'trabajos antes del suyo'}` : `${job.jobs_ahead} ${job.jobs_ahead === 1 ? 'job' : 'jobs'} ahead of yours`}</small>}</h3></div>{job && <code>{job.job_id}</code>}</div>
    {waiting ? <><div className="physical-queue-metrics"><div><b>{job.queue_position}</b><span>{es ? 'Su posición' : 'Your position'}</span></div><div><b>{duration(job.waiting_seconds)}</b><span>{es ? 'Tiempo en cola' : 'Queue time'}</span></div><div><b>{job.queue?.running ?? 0}</b><span>{es ? 'Flujos en ejecución' : 'Running flows'}</span></div></div><p>{reason[job.queue_reason as keyof typeof reason] ?? reason.waiting_turn}</p><p className="queue-note">{es ? 'La duración depende del diseño. Puede cerrar el proyecto o recargar sin perder su turno. La cola evita ejecutar varios flujos pesados a la vez.' : 'Duration depends on the design. You can close the project or reload without losing your place. The queue prevents several heavy flows from running together.'}</p></>
      : job?.status === 'running' || job?.status === 'cancelling' ? <><div className="physical-queue-metrics"><div><b>{duration(job.elapsed_seconds)}</b><span>{es ? 'Tiempo ejecutando' : 'Execution time'}</span></div><div><b>{job.stage_label ?? (es ? 'Preparación' : 'Preparation')}</b><span>{job.tool ?? 'LibreLane'}</span></div><div><b>{cpu !== null ? `${cpu}%` : '—'}</b><span>{es ? 'CPU del ejecutor' : 'Worker CPU'}</span></div></div><p>{job.status === 'cancelling' ? (es ? 'Deteniendo las herramientas y conservando el registro. El turno se libera al confirmar la salida del proceso.' : 'Stopping tools and preserving the log. The slot is released after the process exits.') : (es ? `Su turno comenzó. Espera previa: ${duration(job.waiting_seconds)}. RAM del proceso: ${job.memory_mb ?? '—'} MB.` : `Your turn started. Previous wait: ${duration(job.waiting_seconds)}. Process RAM: ${job.memory_mb ?? '—'} MB.`)}</p></>
      : job?.status === 'cancelled' ? <p>{es ? 'Su trabajo fue cancelado. Puede modificar el proyecto y enviar un nuevo flujo cuando lo necesite.' : 'Your job was cancelled. You can edit the project and submit a new flow whenever needed.'}</p>
      : job?.status === 'completed' ? <p>{es ? 'Abra Resultados para revisar temporización, DRC/LVS y descargar los artefactos. Finalizar el flujo no equivale a aprobar la fabricación.' : 'Open Results to review timing, DRC/LVS and download artifacts. Finishing the flow does not constitute fabrication approval.'}</p>
      : job?.status === 'failed' ? <p>{job.error ?? (es ? 'Abra el registro y Resultados para identificar el fallo antes de volver a enviar el flujo.' : 'Open the log and Results to identify the failure before resubmitting the flow.')}</p>
      : submitting ? <p>{es ? 'Enviando una copia de las fuentes y restricciones actuales. Confirmaremos su turno al recibir la respuesta.' : 'Sending a snapshot of current sources and constraints. Your place will be confirmed on acknowledgement.'}</p> : null}
    {notice && <p className="queue-connection" role="status">{notice}</p>}{job?.persistence_warning && <p className="queue-connection" role="alert">{job.persistence_warning}</p>}{error && <p className="error" role="alert">{error}</p>}
    <div className="physical-job-actions">{active && <button className="cancel-job" disabled={cancelBusy || job.status === 'cancelling'} onClick={onCancel}>{cancelBusy || job.status === 'cancelling' ? (es ? 'Cancelando…' : 'Cancelling…') : waiting ? (es ? 'Cancelar y salir de la cola' : 'Cancel and leave queue') : (es ? 'Cancelar ejecución' : 'Cancel run')}</button>}<a href="#/guia?seccion=physical" target="_blank" rel="noreferrer">{es ? 'Cómo usar el flujo y la cola' : 'How to use the flow and queue'} ↗</a></div>
  </section>
}
