import type {
  FrequencyConversionStage,
  FrequencyPlanResult,
  FrequencyRange,
  MixerProduct,
  MixerMode,
} from './types'

export interface FrequencyMixerInput {
  nodeId: string
  label: string
  mode: MixerMode
  loFrequencyHz: number
  loPowerDbm?: number | null
  imageRejectionDb?: number | null
  loToOutputIsolationDb?: number | null
}

const PRODUCT_TERMS = [
  ['RF feedthrough', 'fIN', 1, 0, 'feedthrough'],
  ['LO leakage', 'fLO', 0, 1, 'leakage'],
  ['Difference', '|fIN - fLO|', 1, -1, 'alternate'],
  ['Sum', 'fIN + fLO', 1, 1, 'alternate'],
  ['Second harmonic', '2fIN', 2, 0, 'spur'],
  ['Second harmonic', '2fLO', 0, 2, 'spur'],
  ['Third order', '|2fIN - fLO|', 2, -1, 'spur'],
  ['Third order', '2fIN + fLO', 2, 1, 'spur'],
  ['Third order', '|fIN - 2fLO|', 1, -2, 'spur'],
  ['Third order', 'fIN + 2fLO', 1, 2, 'spur'],
  ['Third harmonic', '3fIN', 3, 0, 'spur'],
  ['Third harmonic', '3fLO', 0, 3, 'spur'],
] as const

export function calculateFrequencyPlan(
  inputFrequencyHz: Float64Array,
  mixers: FrequencyMixerInput[],
): FrequencyPlanResult {
  validateGrid(inputFrequencyHz)
  const input = range(inputFrequencyHz)
  let current = new Float64Array(inputFrequencyHz)
  const stages = mixers.map((mixer): FrequencyConversionStage => {
    if (!Number.isFinite(mixer.loFrequencyHz) || mixer.loFrequencyHz <= 0) {
      throw new RangeError(`${mixer.label}: LO frequency must be positive.`)
    }
    const loPowerDbm = optionalNumber(mixer.loPowerDbm, mixer.label)
    const imageRejectionDb = optionalNumber(
      mixer.imageRejectionDb,
      mixer.label,
      0,
    )
    const loToOutputIsolationDb = optionalNumber(
      mixer.loToOutputIsolationDb,
      mixer.label,
      0,
    )
    const mixerInput = range(current)
    const output = new Float64Array(current.length)
    for (let index = 0; index < current.length; index += 1) {
      const inputHz = current[index]!
      const outputHz =
        mixer.mode === 'upconvert'
          ? inputHz + mixer.loFrequencyHz
          : inputHz - mixer.loFrequencyHz
      if (!Number.isFinite(outputHz) || outputHz <= 0) {
        throw new RangeError(
          `${mixer.label}: difference conversion requires every input frequency to exceed the LO frequency.`,
        )
      }
      output[index] = outputHz
    }
    const mixerOutput = range(output)
    const imageFrequencyHz =
      mixer.mode === 'downconvert'
        ? 2 * mixer.loFrequencyHz - mixerInput.centerHz
        : Math.abs(mixer.loFrequencyHz - mixerInput.centerHz)
    const products = PRODUCT_TERMS.map(
      ([
        label,
        formula,
        inputCoefficient,
        loCoefficient,
        kind,
      ]): MixerProduct => {
        const desired =
          (mixer.mode === 'downconvert' && loCoefficient === -1) ||
          (mixer.mode === 'upconvert' && loCoefficient === 1)
        return {
          label,
          formula,
          frequencyHz: Math.abs(
            inputCoefficient * mixerInput.centerHz +
              loCoefficient * mixer.loFrequencyHz,
          ),
          order: Math.abs(inputCoefficient) + Math.abs(loCoefficient),
          kind: desired && inputCoefficient === 1 ? 'desired' : kind,
        }
      },
    )
    current = output
    return {
      nodeId: mixer.nodeId,
      label: mixer.label,
      mode: mixer.mode,
      loFrequencyHz: mixer.loFrequencyHz,
      input: mixerInput,
      output: mixerOutput,
      imageLocation: mixer.mode === 'downconvert' ? 'input' : 'output',
      imageFrequencyHz: imageFrequencyHz >= 0 ? imageFrequencyHz : null,
      imageRejectionDb,
      loPowerDbm,
      loToOutputIsolationDb,
      estimatedLoLeakagePowerDbm:
        loPowerDbm !== null && loToOutputIsolationDb !== null
          ? loPowerDbm - loToOutputIsolationDb
          : null,
      products,
    }
  })

  return { input, output: range(current), outputFrequencyHz: current, stages }
}

function optionalNumber(
  value: number | null | undefined,
  label: string,
  minimum?: number,
): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new RangeError(`${label}: mixer planning metadata is invalid.`)
  }
  return value
}

function validateGrid(frequencyHz: Float64Array): void {
  if (frequencyHz.length === 0) {
    throw new RangeError('Frequency plan requires a non-empty input grid.')
  }
  for (let index = 0; index < frequencyHz.length; index += 1) {
    const value = frequencyHz[index]!
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (index > 0 && value <= frequencyHz[index - 1]!)
    ) {
      throw new RangeError(
        'Frequency plan input must be non-negative, finite, and strictly increasing.',
      )
    }
  }
}

function range(frequencyHz: Float64Array): FrequencyRange {
  return {
    startHz: frequencyHz[0]!,
    centerHz: frequencyHz[Math.floor(frequencyHz.length / 2)]!,
    stopHz: frequencyHz.at(-1)!,
  }
}
