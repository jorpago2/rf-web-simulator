import type { SimulationInput, SimulationOutput } from '../engine/types'

export interface SerializedError {
  name: string
  message: string
  stack?: string
}

export type RFWorkerRequest = {
  type: 'simulate'
  requestId: string
  payload: SimulationInput
}

export type RFWorkerResponse =
  | {
      type: 'success'
      requestId: string
      payload: SimulationOutput
    }
  | {
      type: 'failure'
      requestId: string
      error: SerializedError
    }
