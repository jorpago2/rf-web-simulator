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
    output.networkChecks.stabilityK.buffer,
    output.networkChecks.stabilityMuSource.buffer,
    output.networkChecks.stabilityMuLoad.buffer,
    output.networkChecks.passivityMaximumSingularValue.buffer,
    output.networkChecks.reciprocityErrorMagnitude.buffer,
    ...output.probeResults.map((probe) => probe.s21Db.buffer),
    output.frequencyPlan.outputFrequencyHz.buffer,
    output.nonlinear.inputPowerDbm.buffer,
    output.nonlinear.linearOutputPowerDbm.buffer,
    output.nonlinear.compressedOutputPowerDbm.buffer,
    output.nonlinear.outputPhaseDeg.buffer,
    output.nonlinear.im3OutputPowerDbm.buffer,
    output.oscillatorNoise.offsetFrequencyHz.buffer,
    output.oscillatorNoise.freeRunningDbcHz.buffer,
    output.oscillatorNoise.outputDbcHz.buffer,
    output.antenna.angleDeg.buffer,
    output.antenna.normalizedPatternDb.buffer,
    output.parametricSweep.parameterValues.buffer,
    output.parametricSweep.metricValues.buffer,
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
