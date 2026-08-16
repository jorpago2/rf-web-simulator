import type { SimulationInput, SimulationOutput } from '../engine/types'
import type { RFWorkerRequest, RFWorkerResponse } from './messages'

export function simulateInWorker(
  input: SimulationInput,
  signal?: AbortSignal,
): Promise<SimulationOutput> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Simulation cancelled.', 'AbortError'))
  }
  let worker: Worker
  try {
    worker = new Worker(new URL('./rf.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error('Unable to start RF worker.'),
    )
  }
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    let stopped = false
    let settled = false
    const stop = () => {
      if (stopped) return
      stopped = true
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      stop()
      reject(new DOMException('Simulation cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    worker.onmessage = (event: MessageEvent<RFWorkerResponse>) => {
      if (settled || event.data.requestId !== requestId) return
      settled = true
      stop()
      if (event.data.type === 'success') resolve(event.data.payload)
      else reject(new Error(event.data.error.message))
    }
    worker.onerror = (event) => {
      if (settled) return
      settled = true
      stop()
      reject(new Error(event.message || 'RF worker failed.'))
    }
    const request: RFWorkerRequest = {
      type: 'simulate',
      requestId,
      payload: input,
    }
    try {
      worker.postMessage(request)
    } catch (error) {
      if (settled) return
      settled = true
      stop()
      reject(
        error instanceof Error ? error : new Error('Unable to send RF request.'),
      )
    }
  })
}
