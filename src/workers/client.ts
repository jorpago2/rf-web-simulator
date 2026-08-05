import type { SimulationInput, SimulationOutput } from '../engine/types'
import type { RFWorkerRequest, RFWorkerResponse } from './messages'

export function simulateInWorker(
  input: SimulationInput,
  signal?: AbortSignal,
): Promise<SimulationOutput> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Simulation cancelled.', 'AbortError'))
  }
  const worker = new Worker(new URL('./rf.worker.ts', import.meta.url), {
    type: 'module',
  })
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    const stop = () => {
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      stop()
      reject(new DOMException('Simulation cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<RFWorkerResponse>) => {
      if (event.data.requestId !== requestId) return
      stop()
      if (event.data.type === 'success') resolve(event.data.payload)
      else reject(new Error(event.data.error.message))
    }
    worker.onerror = (event) => {
      stop()
      reject(new Error(event.message || 'RF worker failed.'))
    }
    const request: RFWorkerRequest = {
      type: 'simulate',
      requestId,
      payload: input,
    }
    worker.postMessage(request)
  })
}
