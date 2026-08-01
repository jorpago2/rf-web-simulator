import type {
  ComplexArray,
  NPortNetwork,
  RFAnalysisSettings,
  SimulationWarning,
  TwoPortNetwork,
} from './types'

export interface CommonFrequencyGrid {
  frequencyHz: Float64Array
  warnings: SimulationWarning[]
}

export function buildCommonFrequencyGrid(
  networks: Array<{
    network: Pick<TwoPortNetwork, 'frequencyHz'>
    inputFrequencyOffsetHz: number
  }>,
  analysis: RFAnalysisSettings,
): CommonFrequencyGrid {
  validateAnalysis(analysis)

  let startHz = analysis.startHz
  let stopHz = analysis.stopHz
  for (const { network, inputFrequencyOffsetHz } of networks) {
    validateNetworkGrid(network)
    startHz = Math.max(
      startHz,
      network.frequencyHz[0]! - inputFrequencyOffsetHz,
    )
    stopHz = Math.min(
      stopHz,
      network.frequencyHz.at(-1)! - inputFrequencyOffsetHz,
    )
  }

  if (!(startHz < stopHz)) {
    throw new RangeError(
      'The requested range and the Touchstone networks have no common frequency interval.',
    )
  }

  const warnings: SimulationWarning[] = []
  if (startHz !== analysis.startHz || stopHz !== analysis.stopHz) {
    warnings.push({
      code: 'RANGE_CLIPPED',
      message: `Requested range clipped to ${formatFrequency(startHz)}–${formatFrequency(stopHz)}; extrapolation is disabled.`,
    })
  }

  const frequencyHz = new Float64Array(analysis.points)
  const stepHz = (stopHz - startHz) / (analysis.points - 1)
  for (let index = 0; index < analysis.points; index += 1) {
    frequencyHz[index] = startHz + stepHz * index
  }
  frequencyHz[analysis.points - 1] = stopHz

  return { frequencyHz, warnings }
}

export function interpolateNPortNetwork(
  network: NPortNetwork,
  targetFrequencyHz: Float64Array,
): NPortNetwork {
  validateNetworkGrid(network)
  validateTargetGrid(targetFrequencyHz)
  const sourceFrequencyHz = network.frequencyHz
  if (
    targetFrequencyHz[0]! < sourceFrequencyHz[0]! ||
    targetFrequencyHz.at(-1)! > sourceFrequencyHz.at(-1)!
  ) {
    throw new RangeError(
      'Interpolation target exceeds the source frequency range.',
    )
  }
  return {
    ...network,
    frequencyHz: targetFrequencyHz,
    s: network.s.map((value) =>
      interpolateComplexArray(sourceFrequencyHz, value, targetFrequencyHz),
    ),
  }
}

export function interpolateNetwork(
  network: TwoPortNetwork,
  targetFrequencyHz: Float64Array,
): TwoPortNetwork {
  validateNetworkGrid(network)
  validateTargetGrid(targetFrequencyHz)
  const sourceFrequencyHz = network.frequencyHz

  if (
    targetFrequencyHz[0]! < sourceFrequencyHz[0]! ||
    targetFrequencyHz.at(-1)! > sourceFrequencyHz.at(-1)!
  ) {
    throw new RangeError(
      'Interpolation target exceeds the network frequency range.',
    )
  }

  return {
    frequencyHz: targetFrequencyHz,
    referenceImpedanceOhm: network.referenceImpedanceOhm,
    s11: interpolateComplexArray(
      sourceFrequencyHz,
      network.s11,
      targetFrequencyHz,
    ),
    s21: interpolateComplexArray(
      sourceFrequencyHz,
      network.s21,
      targetFrequencyHz,
    ),
    s12: interpolateComplexArray(
      sourceFrequencyHz,
      network.s12,
      targetFrequencyHz,
    ),
    s22: interpolateComplexArray(
      sourceFrequencyHz,
      network.s22,
      targetFrequencyHz,
    ),
    ...(network.sourceName ? { sourceName: network.sourceName } : {}),
  }
}

function interpolateComplexArray(
  sourceFrequencyHz: Float64Array,
  source: ComplexArray,
  targetFrequencyHz: Float64Array,
): ComplexArray {
  if (
    source.re.length !== sourceFrequencyHz.length ||
    source.im.length !== sourceFrequencyHz.length
  ) {
    throw new RangeError(
      'S-parameter array length does not match its frequency grid.',
    )
  }

  const result: ComplexArray = {
    re: new Float64Array(targetFrequencyHz.length),
    im: new Float64Array(targetFrequencyHz.length),
  }
  let leftIndex = 0

  for (
    let targetIndex = 0;
    targetIndex < targetFrequencyHz.length;
    targetIndex += 1
  ) {
    const frequencyHz = targetFrequencyHz[targetIndex]!
    while (
      leftIndex < sourceFrequencyHz.length - 2 &&
      sourceFrequencyHz[leftIndex + 1]! < frequencyHz
    ) {
      leftIndex += 1
    }

    const leftFrequencyHz = sourceFrequencyHz[leftIndex]!
    const rightFrequencyHz = sourceFrequencyHz[leftIndex + 1]!
    const weight =
      (frequencyHz - leftFrequencyHz) / (rightFrequencyHz - leftFrequencyHz)
    result.re[targetIndex] =
      source.re[leftIndex]! +
      weight * (source.re[leftIndex + 1]! - source.re[leftIndex]!)
    result.im[targetIndex] =
      source.im[leftIndex]! +
      weight * (source.im[leftIndex + 1]! - source.im[leftIndex]!)
  }

  return result
}

function validateAnalysis(analysis: RFAnalysisSettings): void {
  if (
    !Number.isFinite(analysis.startHz) ||
    !Number.isFinite(analysis.stopHz) ||
    analysis.startHz < 0 ||
    analysis.stopHz <= analysis.startHz
  ) {
    throw new RangeError(
      'Analysis frequencies must be finite with 0 ≤ start < stop.',
    )
  }
  if (
    !Number.isInteger(analysis.points) ||
    analysis.points < 2 ||
    analysis.points > 10_001
  ) {
    throw new RangeError('Analysis points must be an integer from 2 to 10,001.')
  }
  if (
    !Number.isFinite(analysis.referenceImpedanceOhm) ||
    analysis.referenceImpedanceOhm <= 0
  ) {
    throw new RangeError('Reference impedance must be a positive finite value.')
  }
}

function validateNetworkGrid(network: { frequencyHz: Float64Array }): void {
  if (network.frequencyHz.length < 2) {
    throw new RangeError(
      'A network needs at least two frequency points for interpolation.',
    )
  }
  for (let index = 1; index < network.frequencyHz.length; index += 1) {
    if (!(network.frequencyHz[index]! > network.frequencyHz[index - 1]!)) {
      throw new RangeError(
        'Network frequencies must be finite and strictly increasing.',
      )
    }
  }
}

function validateTargetGrid(frequencyHz: Float64Array): void {
  if (frequencyHz.length < 2) {
    throw new RangeError('The target grid needs at least two frequency points.')
  }
  for (let index = 0; index < frequencyHz.length; index += 1) {
    const value = frequencyHz[index]!
    if (
      !Number.isFinite(value) ||
      (index > 0 && value <= frequencyHz[index - 1]!)
    ) {
      throw new RangeError(
        'Target frequencies must be finite and strictly increasing.',
      )
    }
  }
}

function formatFrequency(frequencyHz: number): string {
  if (frequencyHz >= 1e9) return `${frequencyHz / 1e9} GHz`
  if (frequencyHz >= 1e6) return `${frequencyHz / 1e6} MHz`
  if (frequencyHz >= 1e3) return `${frequencyHz / 1e3} kHz`
  return `${frequencyHz} Hz`
}
