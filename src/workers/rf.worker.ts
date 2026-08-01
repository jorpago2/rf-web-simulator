import { simulateLinearChain } from '../engine/simulation'
import type { SimulationOutput } from '../engine/types'
import type { RFWorkerRequest, RFWorkerResponse } from './messages'

interface WorkerScope {
  onmessage: ((event: MessageEvent<RFWorkerRequest>) => void) | null
  postMessage(message: RFWorkerResponse, transfer: Transferable[]): void
}

const workerScope = self as unknown as WorkerScope

workerScope.onmessage = (event) => {
  const request = event.data
  try {
    const payload = simulateLinearChain(request.payload)
    workerScope.postMessage(
      { type: 'success', requestId: request.requestId, payload },
      transferables(payload),
    )
  } catch (error) {
    workerScope.postMessage(
      {
        type: 'failure',
        requestId: request.requestId,
        error: serializeError(error),
      },
      [],
    )
  }
}

function transferables(output: SimulationOutput): Transferable[] {
  const network = output.total
  return [
    network.frequencyHz.buffer,
    network.s11.re.buffer,
    network.s11.im.buffer,
    network.s21.re.buffer,
    network.s21.im.buffer,
    network.s12.re.buffer,
    network.s12.im.buffer,
    network.s22.re.buffer,
    network.s22.im.buffer,
    output.curves.s11Db.buffer,
    output.curves.s21Db.buffer,
    output.curves.s12Db.buffer,
    output.curves.s22Db.buffer,
    output.curves.s21PhaseDeg.buffer,
    output.curves.s21GroupDelayS.buffer,
  ]
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  return { name: 'Error', message: 'Unknown simulation failure.' }
}
