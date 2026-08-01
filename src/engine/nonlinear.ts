import type { BudgetStageInput } from './budget'
import { interpolateDeviceOutputPower } from './deviceTable'
import type { NonlinearSweepResult, RFBudgetResult } from './types'

export const NONLINEAR_SWEEP_POINTS = 101
export const DEFAULT_TWO_TONE_SPACING_HZ = 10e6
const ONE_DB_COMPRESSION_FACTOR = 10 ** 0.1 - 1

export function calculateNonlinearSweep(
  budget: RFBudgetResult,
  stages: BudgetStageInput[],
  outputCenterFrequencyHz = budget.centerFrequencyHz,
  toneSpacingHz = DEFAULT_TWO_TONE_SPACING_HZ,
): NonlinearSweepResult {
  if (!Number.isFinite(toneSpacingHz) || toneSpacingHz <= 0) {
    throw new RangeError('Two-tone spacing must be positive.')
  }
  if (
    !Number.isFinite(outputCenterFrequencyHz) ||
    outputCenterFrequencyHz <= 0 ||
    1.5 * toneSpacingHz >= outputCenterFrequencyHz
  ) {
    throw new RangeError(
      'Two-tone spacing must keep both third-order products above 0 Hz.',
    )
  }

  const total = budget.stages.at(-1)
  const smallSignalGainDb = finiteOrNull(total?.cumulativeGainDb)
  const budgetInputP1Dbm = finiteOrNull(total?.cumulativeInputP1Dbm)
  const outputIp3Dbm = finiteOrNull(total?.cumulativeOutputIp3Dbm)
  const operatingInputPowerDbm = finiteOrNull(budget.sourcePowerDbm)
  const inputP1Dbm =
    budgetInputP1Dbm === null
      ? null
      : findChainInputP1Dbm(stages, budgetInputP1Dbm)
  const outputP1Dbm =
    inputP1Dbm === null ? null : propagatePower(inputP1Dbm, stages).outputDbm
  const available =
    smallSignalGainDb !== null && (inputP1Dbm !== null || outputIp3Dbm !== null)
  const toneFrequenciesHz: [number, number] = [
    outputCenterFrequencyHz - toneSpacingHz / 2,
    outputCenterFrequencyHz + toneSpacingHz / 2,
  ]
  const im3FrequenciesHz: [number, number] = [
    outputCenterFrequencyHz - 1.5 * toneSpacingHz,
    outputCenterFrequencyHz + 1.5 * toneSpacingHz,
  ]

  if (!available || smallSignalGainDb === null) {
    return emptyResult(
      smallSignalGainDb,
      operatingInputPowerDbm,
      toneSpacingHz,
      toneFrequenciesHz,
      im3FrequenciesHz,
    )
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
    compressedOutputPowerDbm[index] =
      inputP1Dbm === null
        ? linearOutputDbm
        : propagatePower(inputDbm, stages).outputDbm
    im3OutputPowerDbm[index] =
      outputIp3Dbm === null
        ? Number.NaN
        : 3 * linearOutputDbm - 2 * outputIp3Dbm
  }

  const chainP1Propagation =
    inputP1Dbm === null ? null : propagatePower(inputP1Dbm, stages)
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
        : inputP1Dbm === null
          ? operatingInputPowerDbm + smallSignalGainDb
          : propagatePower(operatingInputPowerDbm, stages).outputDbm,
    toneSpacingHz,
    toneFrequenciesHz,
    im3FrequenciesHz,
    limitingStageLabel: chainP1Propagation?.limitingStageLabel ?? null,
  }
}

function findChainInputP1Dbm(
  stages: BudgetStageInput[],
  estimateDbm: number,
): number | null {
  if (!stages.some((stage) => Number.isFinite(stage.outputP1Dbm))) return null
  const totalGainDb = stages.reduce((sum, stage) => sum + stage.gainDb!, 0)
  let lowDbm = estimateDbm - 30
  let highDbm = estimateDbm + 20
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const inputDbm = (lowDbm + highDbm) / 2
    const compressionDb =
      inputDbm + totalGainDb - propagatePower(inputDbm, stages).outputDbm
    if (compressionDb < 1) lowDbm = inputDbm
    else highDbm = inputDbm
  }
  return (lowDbm + highDbm) / 2
}

function propagatePower(
  inputPowerDbm: number,
  stages: BudgetStageInput[],
): { outputDbm: number; limitingStageLabel: string | null } {
  let outputDbm = inputPowerDbm
  let largestCompressionDb = 0
  let limitingStageLabel: string | null = null

  for (const stage of stages) {
    const linearOutputDbm = outputDbm + stage.gainDb!
    const stageInputP1Dbm = Number.isFinite(stage.outputP1Dbm)
      ? stage.outputP1Dbm! + 1 - stage.gainDb!
      : null
    const measuredOutputDbm = stage.powerTransfer
      ? interpolateDeviceOutputPower(stage.powerTransfer, outputDbm)
      : null
    const compressedOutputDbm =
      measuredOutputDbm ??
      compressedPowerDbm(outputDbm, linearOutputDbm, stageInputP1Dbm)
    const compressionDb = linearOutputDbm - compressedOutputDbm
    if (compressionDb > largestCompressionDb) {
      largestCompressionDb = compressionDb
      limitingStageLabel = stage.label
    }
    outputDbm = compressedOutputDbm
  }
  return { outputDbm, limitingStageLabel }
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
  toneSpacingHz: number,
  toneFrequenciesHz: [number, number],
  im3FrequenciesHz: [number, number],
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
    toneSpacingHz,
    toneFrequenciesHz,
    im3FrequenciesHz,
    limitingStageLabel: null,
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
