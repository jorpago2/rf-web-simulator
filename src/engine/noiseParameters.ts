import type { TouchstoneNoiseData } from './touchstone'

export interface NoiseParametersAtFrequency {
  minimumNoiseFactor: number
  optimumSourceReflection: { re: number; im: number }
  effectiveNoiseResistanceOhm: number
}

/** Source-dependent noise figure from the standard Fmin/GammaOpt/Rn model. */
export function noiseFigureFromParameters(
  noise: TouchstoneNoiseData,
  frequencyHz: number,
  sourceImpedanceOhm: number,
  referenceImpedanceOhm: number,
): number {
  if (
    !Number.isFinite(frequencyHz) ||
    !Number.isFinite(sourceImpedanceOhm) ||
    sourceImpedanceOhm <= 0 ||
    !Number.isFinite(referenceImpedanceOhm) ||
    referenceImpedanceOhm <= 0
  ) {
    throw new RangeError(
      'Noise evaluation requires positive frequency and impedances.',
    )
  }
  const parameters = noiseParametersAt(noise, frequencyHz)
  const gammaSource = {
    re:
      (sourceImpedanceOhm - referenceImpedanceOhm) /
      (sourceImpedanceOhm + referenceImpedanceOhm),
    im: 0,
  }
  return (
    10 *
    Math.log10(
      noiseFactorForSourceReflection(
        parameters,
        gammaSource,
        referenceImpedanceOhm,
      ),
    )
  )
}

export function noiseParametersAt(
  noise: TouchstoneNoiseData,
  frequencyHz: number,
): NoiseParametersAtFrequency {
  const index = lowerIndex(noise.frequencyHz, frequencyHz)
  const upper = Math.min(index + 1, noise.frequencyHz.length - 1)
  const span = noise.frequencyHz[upper]! - noise.frequencyHz[index]!
  const weight = span > 0 ? (frequencyHz - noise.frequencyHz[index]!) / span : 0
  const minimumNoiseFactor =
    10 **
    (lerp(
      noise.minimumNoiseFigureDb[index]!,
      noise.minimumNoiseFigureDb[upper]!,
      weight,
    ) /
      10)
  const optimumSourceReflection = {
    re: lerp(
      noise.optimumSourceReflection.re[index]!,
      noise.optimumSourceReflection.re[upper]!,
      weight,
    ),
    im: lerp(
      noise.optimumSourceReflection.im[index]!,
      noise.optimumSourceReflection.im[upper]!,
      weight,
    ),
  }
  const effectiveNoiseResistanceOhm = lerp(
    noise.effectiveNoiseResistanceOhm[index]!,
    noise.effectiveNoiseResistanceOhm[upper]!,
    weight,
  )
  return {
    minimumNoiseFactor,
    optimumSourceReflection,
    effectiveNoiseResistanceOhm,
  }
}

export function noiseFactorForSourceReflection(
  parameters: NoiseParametersAtFrequency,
  sourceReflection: { re: number; im: number },
  referenceImpedanceOhm: number,
): number {
  const gammaOpt = parameters.optimumSourceReflection
  const sourceMagnitudeSquared =
    sourceReflection.re ** 2 + sourceReflection.im ** 2
  const numerator =
    (sourceReflection.re - gammaOpt.re) ** 2 +
    (sourceReflection.im - gammaOpt.im) ** 2
  const denominator =
    (1 - sourceMagnitudeSquared) * ((1 + gammaOpt.re) ** 2 + gammaOpt.im ** 2)
  if (denominator <= 0)
    throw new RangeError('Noise source reflection is singular.')
  return (
    parameters.minimumNoiseFactor +
    (4 * parameters.effectiveNoiseResistanceOhm * numerator) /
      (referenceImpedanceOhm * denominator)
  )
}

function lowerIndex(grid: Float64Array, value: number): number {
  if (grid.length === 0) throw new RangeError('Noise parameter table is empty.')
  if (value < grid[0]! || value > grid.at(-1)!) {
    throw new RangeError('Noise frequency is outside the measured range.')
  }
  let low = 0
  let high = grid.length - 1
  while (low < high - 1) {
    const middle = Math.floor((low + high) / 2)
    if (grid[middle]! <= value) low = middle
    else high = middle
  }
  return low
}

function lerp(left: number, right: number, weight: number): number {
  return left + weight * (right - left)
}
