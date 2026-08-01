import type { FrequencyPlanResult, FrequencyRange, MixerMode } from './types'

export interface FrequencyMixerInput {
  nodeId: string
  label: string
  mode: MixerMode
  loFrequencyHz: number
}

export function calculateFrequencyPlan(
  inputFrequencyHz: Float64Array,
  mixers: FrequencyMixerInput[],
): FrequencyPlanResult {
  validateGrid(inputFrequencyHz)
  const input = range(inputFrequencyHz)
  let current = new Float64Array(inputFrequencyHz)
  const stages = mixers.map((mixer) => {
    if (!Number.isFinite(mixer.loFrequencyHz) || mixer.loFrequencyHz <= 0) {
      throw new RangeError(`${mixer.label}: LO frequency must be positive.`)
    }
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
    current = output
    return {
      nodeId: mixer.nodeId,
      label: mixer.label,
      mode: mixer.mode,
      loFrequencyHz: mixer.loFrequencyHz,
      input: mixerInput,
      output: range(output),
    }
  })

  return { input, output: range(current), outputFrequencyHz: current, stages }
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
