import type { NonlinearSweepResult, RFBudgetResult } from './types'

export const NONLINEAR_SWEEP_POINTS = 101
const ONE_DB_COMPRESSION_FACTOR = 10 ** 0.1 - 1

export function calculateNonlinearSweep(
  budget: RFBudgetResult,
): NonlinearSweepResult {
  const total = budget.stages.at(-1)
  const smallSignalGainDb = finiteOrNull(total?.cumulativeGainDb)
  const inputP1Dbm = finiteOrNull(total?.cumulativeInputP1Dbm)
  const outputP1Dbm = finiteOrNull(total?.cumulativeOutputP1Dbm)
  const outputIp3Dbm = finiteOrNull(total?.cumulativeOutputIp3Dbm)
  const operatingInputPowerDbm = finiteOrNull(budget.sourcePowerDbm)
  const available =
    smallSignalGainDb !== null && (inputP1Dbm !== null || outputIp3Dbm !== null)

  if (!available || smallSignalGainDb === null) {
    return emptyResult(smallSignalGainDb, operatingInputPowerDbm)
  }

  const anchorDbm = inputP1Dbm ?? outputIp3Dbm! - smallSignalGainDb
  const startDbm = Math.min(
    anchorDbm - 30,
    operatingInputPowerDbm === null
      ? Number.POSITIVE_INFINITY
      : operatingInputPowerDbm - 3,
  )
  const stopDbm = Math.max(
    anchorDbm + 10,
    operatingInputPowerDbm === null
      ? Number.NEGATIVE_INFINITY
      : operatingInputPowerDbm + 3,
  )
  const inputPowerDbm = linearGrid(startDbm, stopDbm)
  const linearOutputPowerDbm = new Float64Array(NONLINEAR_SWEEP_POINTS)
  const compressedOutputPowerDbm = new Float64Array(NONLINEAR_SWEEP_POINTS)
  const im3OutputPowerDbm = new Float64Array(NONLINEAR_SWEEP_POINTS)

  for (let index = 0; index < NONLINEAR_SWEEP_POINTS; index += 1) {
    const inputDbm = inputPowerDbm[index]!
    const linearOutputDbm = inputDbm + smallSignalGainDb
    linearOutputPowerDbm[index] = linearOutputDbm
    compressedOutputPowerDbm[index] = compressedPowerDbm(
      inputDbm,
      linearOutputDbm,
      inputP1Dbm,
    )
    im3OutputPowerDbm[index] =
      outputIp3Dbm === null
        ? Number.NaN
        : 3 * linearOutputDbm - 2 * outputIp3Dbm
  }

  return {
    available,
    inputPowerDbm,
    linearOutputPowerDbm,
    compressedOutputPowerDbm,
    im3OutputPowerDbm,
    smallSignalGainDb,
    inputP1Dbm,
    outputP1Dbm,
    outputIp3Dbm,
    operatingInputPowerDbm,
    operatingOutputPowerDbm:
      operatingInputPowerDbm === null
        ? null
        : compressedPowerDbm(
            operatingInputPowerDbm,
            operatingInputPowerDbm + smallSignalGainDb,
            inputP1Dbm,
          ),
  }
}

function compressedPowerDbm(
  inputPowerDbm: number,
  linearOutputPowerDbm: number,
  inputP1Dbm: number | null,
): number {
  if (inputP1Dbm === null) return linearOutputPowerDbm
  const compressionDb =
    10 *
    Math.log10(
      1 + ONE_DB_COMPRESSION_FACTOR * 10 ** ((inputPowerDbm - inputP1Dbm) / 10),
    )
  return linearOutputPowerDbm - compressionDb
}

function linearGrid(start: number, stop: number): Float64Array {
  const result = new Float64Array(NONLINEAR_SWEEP_POINTS)
  const step = (stop - start) / (NONLINEAR_SWEEP_POINTS - 1)
  for (let index = 0; index < NONLINEAR_SWEEP_POINTS; index += 1) {
    result[index] = start + index * step
  }
  result[NONLINEAR_SWEEP_POINTS - 1] = stop
  return result
}

function emptyResult(
  smallSignalGainDb: number | null,
  operatingInputPowerDbm: number | null,
): NonlinearSweepResult {
  return {
    available: false,
    inputPowerDbm: new Float64Array(),
    linearOutputPowerDbm: new Float64Array(),
    compressedOutputPowerDbm: new Float64Array(),
    im3OutputPowerDbm: new Float64Array(),
    smallSignalGainDb,
    inputP1Dbm: null,
    outputP1Dbm: null,
    outputIp3Dbm: null,
    operatingInputPowerDbm,
    operatingOutputPowerDbm: null,
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
