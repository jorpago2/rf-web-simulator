import type {
  AntennaResult,
  OscillatorNoiseResult,
  RFBudgetResult,
  RFProjectNode,
} from './types'

const SPEED_OF_LIGHT_M_PER_S = 299_792_458

export function calculateOscillatorNoise(
  source: RFProjectNode,
): OscillatorNoiseResult {
  if (source.data.type !== 'vcoSource') return emptyOscillatorNoise()

  const carrierFrequencyHz =
    parameter(source, 'freeRunningFrequencyHz', 0.9e9) +
    parameter(source, 'tuningSensitivityHzPerV', 100e6) *
      parameter(source, 'controlVoltageV', 1)
  const startHz = parameter(source, 'phaseNoiseIntegrationStartHz', 100)
  const stopHz = parameter(source, 'phaseNoiseIntegrationStopHz', 10e6)
  const offsetFrequencyHz = logarithmicGrid(startHz, stopHz, 121)
  const anchorDbcHz = parameter(source, 'phaseNoiseAt1MHzDbcHz', -120)
  const slopeDbPerDecade = parameter(source, 'phaseNoiseSlopeDbPerDecade', -20)
  const floorDbcHz = parameter(source, 'phaseNoiseFloorDbcHz', -160)
  const freeRunningDbcHz = Float64Array.from(offsetFrequencyHz, (offset) =>
    Math.max(
      floorDbcHz,
      anchorDbcHz + slopeDbPerDecade * Math.log10(offset / 1e6),
    ),
  )
  const pllEnabled = source.data.parameters.pllEnabled === true
  const outputDbcHz = pllEnabled
    ? closedLoopNoise(
        offsetFrequencyHz,
        freeRunningDbcHz,
        parameter(source, 'pllLoopBandwidthHz', 100e3),
        parameter(source, 'pllInBandPhaseNoiseDbcHz', -140),
      )
    : freeRunningDbcHz.slice()
  const phaseVariance = 2 * integrateLinearNoise(offsetFrequencyHz, outputDbcHz)
  const rmsPhaseRad = Math.sqrt(Math.max(0, phaseVariance))

  return {
    available: true,
    pllEnabled,
    carrierFrequencyHz,
    offsetFrequencyHz,
    freeRunningDbcHz,
    outputDbcHz,
    integratedPhaseErrorDeg: (rmsPhaseRad * 180) / Math.PI,
    rmsJitterS: rmsPhaseRad / (2 * Math.PI * carrierFrequencyHz),
  }
}

export function calculateAntenna(
  source: RFProjectNode,
  load: RFProjectNode,
  budget: RFBudgetResult,
): AntennaResult {
  const antenna =
    load.data.type === 'txAntenna'
      ? load
      : source.data.type === 'rxAntenna'
        ? source
        : null
  if (!antenna) return emptyAntenna()

  const mode = antenna.data.type === 'txAntenna' ? 'tx' : 'rx'
  const frequencyHz = budget.centerFrequencyHz
  const efficiencyPercent = parameter(antenna, 'efficiencyPercent', 70)
  const exponent = parameter(antenna, 'patternExponent', 2)
  const frontToBackDb = parameter(antenna, 'frontToBackDb', 20)
  const backRatio = 10 ** (-frontToBackDb / 10)
  const directivity = (2 * (exponent + 1)) / (1 + backRatio)
  const directivityDbi = 10 * Math.log10(directivity)
  const efficiency = efficiencyPercent / 100
  const realizedGainDbi = directivityDbi + 10 * Math.log10(efficiency)
  const angleDeg = Float64Array.from({ length: 361 }, (_, index) => index - 180)
  const normalizedPatternDb = Float64Array.from(angleDeg, (angle) => {
    const front = Math.abs(angle) <= 90
    const power =
      Math.abs(Math.cos((angle * Math.PI) / 180)) ** exponent *
      (front ? 1 : backRatio)
    return Math.max(-60, 10 * Math.log10(power))
  })

  return {
    available: true,
    mode,
    frequencyHz,
    efficiencyPercent,
    directivityDbi,
    realizedGainDbi,
    radiatedPowerDbm:
      mode === 'tx' && budget.deliveredLoadPowerDbm !== null
        ? budget.deliveredLoadPowerDbm + 10 * Math.log10(efficiency)
        : null,
    eirpDbm:
      mode === 'tx' && budget.deliveredLoadPowerDbm !== null
        ? budget.deliveredLoadPowerDbm + realizedGainDbi
        : null,
    effectiveApertureM2:
      (10 ** (realizedGainDbi / 10) *
        (SPEED_OF_LIGHT_M_PER_S / frequencyHz) ** 2) /
      (4 * Math.PI),
    angleDeg,
    normalizedPatternDb,
  }
}

function closedLoopNoise(
  offsetsHz: Float64Array,
  vcoDbcHz: Float64Array,
  bandwidthHz: number,
  inBandDbcHz: number,
): Float64Array {
  const referenceLinear = 10 ** (inBandDbcHz / 10)
  return Float64Array.from(offsetsHz, (offset, index) => {
    const ratioSquared = (offset / bandwidthHz) ** 2
    const referenceTransfer = 1 / (1 + ratioSquared)
    const vcoTransfer = 1 - referenceTransfer
    return (
      10 *
      Math.log10(
        referenceTransfer * referenceLinear +
          vcoTransfer * 10 ** (vcoDbcHz[index]! / 10),
      )
    )
  })
}

function integrateLinearNoise(
  frequencyHz: Float64Array,
  noiseDbcHz: Float64Array,
): number {
  let integral = 0
  for (let index = 1; index < frequencyHz.length; index += 1) {
    const left = 10 ** (noiseDbcHz[index - 1]! / 10)
    const right = 10 ** (noiseDbcHz[index]! / 10)
    integral +=
      ((left + right) / 2) * (frequencyHz[index]! - frequencyHz[index - 1]!)
  }
  return integral
}

function logarithmicGrid(start: number, stop: number, points: number) {
  const startLog = Math.log10(start)
  const step = (Math.log10(stop) - startLog) / (points - 1)
  return Float64Array.from(
    { length: points },
    (_, index) => 10 ** (startLog + index * step),
  )
}

function parameter(node: RFProjectNode, key: string, fallback: number): number {
  const value = node.data.parameters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function emptyOscillatorNoise(): OscillatorNoiseResult {
  return {
    available: false,
    pllEnabled: false,
    carrierFrequencyHz: null,
    offsetFrequencyHz: new Float64Array(),
    freeRunningDbcHz: new Float64Array(),
    outputDbcHz: new Float64Array(),
    integratedPhaseErrorDeg: null,
    rmsJitterS: null,
  }
}

function emptyAntenna(): AntennaResult {
  return {
    available: false,
    mode: null,
    frequencyHz: null,
    efficiencyPercent: null,
    directivityDbi: null,
    realizedGainDbi: null,
    radiatedPowerDbm: null,
    eirpDbm: null,
    effectiveApertureM2: null,
    angleDeg: new Float64Array(),
    normalizedPatternDb: new Float64Array(),
  }
}
