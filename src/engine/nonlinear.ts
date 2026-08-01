import type { BudgetStageInput } from './budget'
import {
  interpolateDeviceOutputPhase,
  interpolateDeviceOutputPower,
} from './deviceTable'
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
  const budgetOutputIp3Dbm = finiteOrNull(total?.cumulativeOutputIp3Dbm)
  const outputIp3Dbm =
    smallSignalGainDb === null
      ? budgetOutputIp3Dbm
      : (coherentOutputIp3Dbm(stages, smallSignalGainDb) ?? budgetOutputIp3Dbm)
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
  const outputPhaseDeg = new Float64Array(NONLINEAR_SWEEP_POINTS)
  const im3OutputPowerDbm = new Float64Array(NONLINEAR_SWEEP_POINTS)

  for (let index = 0; index < NONLINEAR_SWEEP_POINTS; index += 1) {
    const inputDbm = inputPowerDbm[index]!
    const linearOutputDbm = inputDbm + smallSignalGainDb
    linearOutputPowerDbm[index] = linearOutputDbm
    const propagated =
      inputP1Dbm === null && !stages.some((stage) => stage.powerTransfer)
        ? { outputDbm: linearOutputDbm, outputPhaseDeg: 0 }
        : propagatePower(inputDbm, stages)
    compressedOutputPowerDbm[index] = propagated.outputDbm
    outputPhaseDeg[index] = propagated.outputPhaseDeg
    im3OutputPowerDbm[index] =
      outputIp3Dbm === null
        ? Number.NaN
        : (coherentIm3OutputPowerDbm(inputDbm, stages) ??
          3 * linearOutputDbm - 2 * outputIp3Dbm)
  }

  const chainP1Propagation =
    inputP1Dbm === null ? null : propagatePower(inputP1Dbm, stages)
  const spectrumInputPowerDbm =
    operatingInputPowerDbm ?? (inputP1Dbm === null ? null : inputP1Dbm - 10)
  return {
    available,
    inputPowerDbm,
    linearOutputPowerDbm,
    compressedOutputPowerDbm,
    outputPhaseDeg,
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
    envelopeSpectrum:
      spectrumInputPowerDbm === null
        ? []
        : calculateEnvelopeSpectrum(
            spectrumInputPowerDbm,
            stages,
            outputCenterFrequencyHz,
            toneSpacingHz,
          ),
    spectrumInputPowerDbm,
  }
}

function calculateEnvelopeSpectrum(
  inputPowerPerToneDbm: number,
  stages: BudgetStageInput[],
  outputCenterFrequencyHz: number,
  toneSpacingHz: number,
): NonlinearSweepResult['envelopeSpectrum'] {
  const sampleCount = 512
  const inputToneAmplitude = Math.sqrt(10 ** (inputPowerPerToneDbm / 10))
  const output = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const angle = (2 * Math.PI * sampleIndex) / sampleCount
    const inputEnvelope = 2 * inputToneAmplitude * Math.cos(angle)
    if (Math.abs(inputEnvelope) < 1e-18) return { re: 0, im: 0 }
    const propagated = propagatePower(
      20 * Math.log10(Math.abs(inputEnvelope)),
      stages,
    )
    const amplitude = Math.sqrt(10 ** (propagated.outputDbm / 10))
    const phaseRad =
      ((propagated.outputPhaseDeg + (inputEnvelope < 0 ? 180 : 0)) * Math.PI) /
      180
    return {
      re: amplitude * Math.cos(phaseRad),
      im: amplitude * Math.sin(phaseRad),
    }
  })
  const raw = Array.from({ length: 31 }, (_, arrayIndex) => {
    const index = arrayIndex - 15
    let coefficient = { re: 0, im: 0 }
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const angle = (-2 * Math.PI * index * sampleIndex) / sampleCount
      const rotation = { re: Math.cos(angle), im: Math.sin(angle) }
      const value = output[sampleIndex]!
      coefficient = {
        re: coefficient.re + value.re * rotation.re - value.im * rotation.im,
        im: coefficient.im + value.re * rotation.im + value.im * rotation.re,
      }
    }
    coefficient.re /= sampleCount
    coefficient.im /= sampleCount
    const powerMilliwatt =
      coefficient.re * coefficient.re + coefficient.im * coefficient.im
    return {
      index,
      frequencyHz: outputCenterFrequencyHz + (index * toneSpacingHz) / 2,
      outputPowerDbm:
        powerMilliwatt > 0
          ? 10 * Math.log10(powerMilliwatt)
          : Number.NEGATIVE_INFINITY,
      phaseDeg: (Math.atan2(coefficient.im, coefficient.re) * 180) / Math.PI,
    }
  }).filter(
    (line) => line.frequencyHz > 0 && Number.isFinite(line.outputPowerDbm),
  )
  const strongest = Math.max(...raw.map((line) => line.outputPowerDbm))
  return raw
    .filter((line) => line.outputPowerDbm >= strongest - 180)
    .map((line) => ({
      ...line,
      relativeToStrongestDb: line.outputPowerDbm - strongest,
      kind:
        Math.abs(line.index) === 1
          ? ('fundamental' as const)
          : Math.abs(line.index) === 3
            ? ('im3' as const)
            : ('higher-order' as const),
    }))
}

function coherentOutputIp3Dbm(
  stages: BudgetStageInput[],
  totalGainDb: number,
): number | null {
  const im3AtZeroDbm = coherentIm3OutputPowerDbm(0, stages)
  if (im3AtZeroDbm === null) return null
  if (im3AtZeroDbm === Number.NEGATIVE_INFINITY) return Number.POSITIVE_INFINITY
  return (3 * totalGainDb - im3AtZeroDbm) / 2
}

function coherentIm3OutputPowerDbm(
  chainInputPowerDbm: number,
  stages: BudgetStageInput[],
): number | null {
  const gains = stages.map((stage) => stage.gainDb)
  if (gains.some((gain) => gain === null)) return null
  const totalGainDb = gains.reduce<number>((sum, gain) => sum + gain!, 0)
  let gainBeforeDb = 0
  let sumRe = 0
  let sumIm = 0
  let sumMagnitude = 0
  let contributors = 0
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]!
    const gainDb = gains[index]!
    if (stage.outputIp3Dbm !== null && Number.isFinite(stage.outputIp3Dbm)) {
      const gainAfterDb = totalGainDb - gainBeforeDb - gainDb
      const contributionDbm =
        3 * (chainInputPowerDbm + gainBeforeDb + gainDb) -
        2 * stage.outputIp3Dbm +
        gainAfterDb
      const amplitude = 10 ** (contributionDbm / 20)
      const phaseRad = ((stage.im3PhaseDeg ?? 0) * Math.PI) / 180
      sumRe += amplitude * Math.cos(phaseRad)
      sumIm += amplitude * Math.sin(phaseRad)
      sumMagnitude += amplitude
      contributors += 1
    }
    gainBeforeDb += gainDb
  }
  if (contributors === 0) return null
  const powerMilliwatt = sumRe * sumRe + sumIm * sumIm
  if (Math.sqrt(powerMilliwatt) <= sumMagnitude * 1e-12)
    return Number.NEGATIVE_INFINITY
  return powerMilliwatt > 0
    ? 10 * Math.log10(powerMilliwatt)
    : Number.NEGATIVE_INFINITY
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
): {
  outputDbm: number
  outputPhaseDeg: number
  limitingStageLabel: string | null
} {
  let outputDbm = inputPowerDbm
  let outputPhaseDeg = 0
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
    const measuredPhaseDeg = stage.powerTransfer
      ? interpolateDeviceOutputPhase(stage.powerTransfer, outputDbm)
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
    outputPhaseDeg += measuredPhaseDeg ?? 0
  }
  return { outputDbm, outputPhaseDeg, limitingStageLabel }
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
    outputPhaseDeg: new Float64Array(),
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
    envelopeSpectrum: [],
    spectrumInputPowerDbm: null,
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
