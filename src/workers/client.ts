import type { SimulationInput, SimulationOutput } from '../engine/types'
import type { RFWorkerRequest, RFWorkerResponse } from './messages'

export function simulateInWorker(
  input: SimulationInput,
): Promise<SimulationOutput> {
  const worker = new Worker(new URL('./rf.worker.ts', import.meta.url), {
    type: 'module',
  })
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<RFWorkerResponse>) => {
      if (event.data.requestId !== requestId) return
      worker.terminate()
      if (event.data.type === 'success') resolve(event.data.payload)
      else reject(new Error(event.data.error.message))
    }
    worker.onerror = (event) => {
      worker.terminate()
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
