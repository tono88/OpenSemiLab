import { runStudy, simulateDevice } from './physics'
import type { WorkerReply, WorkerRequest } from './types'

// This worker is built as a separate asset by Vite. No API, server, credentials
// or network requests are used by analytic calculations or parametric studies.
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<WorkerRequest>) => void; postMessage: (reply: WorkerReply) => void }
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage(data.study ? { id: data.id, study: runStudy(data.config, data.study) } : { id: data.id, result: simulateDevice(data.config) })
  } catch (reason) { scope.postMessage({ id: data.id, error: reason instanceof Error ? reason.message : String(reason) }) }
}
