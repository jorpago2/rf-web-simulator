import type { NetworkChecks, TwoPortNetwork } from './types'

interface ComplexValue {
  re: number
  im: number
}

export function calculateNetworkChecks(network: TwoPortNetwork): NetworkChecks {
  const pointCount = network.frequencyHz.length
  const stabilityK = new Float64Array(pointCount)
  const stabilityMuSource = new Float64Array(pointCount)
  const stabilityMuLoad = new Float64Array(pointCount)
  const passivityMaximumSingularValue = new Float64Array(pointCount)
  const reciprocityErrorMagnitude = new Float64Array(pointCount)

  for (let index = 0; index < pointCount; index += 1) {
    const s11 = at(network.s11, index)
    const s12 = at(network.s12, index)
    const s21 = at(network.s21, index)
    const s22 = at(network.s22, index)
    const determinant = subtract(multiply(s11, s22), multiply(s12, s21))
    const crossMagnitude = magnitude(s12) * magnitude(s21)
    stabilityK[index] = safeRatio(
      1 -
        magnitudeSquared(s11) -
        magnitudeSquared(s22) +
        magnitudeSquared(determinant),
      2 * crossMagnitude,
    )
    stabilityMuSource[index] = safeRatio(
      1 - magnitudeSquared(s11),
      magnitude(subtract(s22, multiply(determinant, conjugate(s11)))) +
        crossMagnitude,
    )
    stabilityMuLoad[index] = safeRatio(
      1 - magnitudeSquared(s22),
      magnitude(subtract(s11, multiply(determinant, conjugate(s22)))) +
        crossMagnitude,
    )
    const trace =
      magnitudeSquared(s11) +
      magnitudeSquared(s12) +
      magnitudeSquared(s21) +
      magnitudeSquared(s22)
    const determinantSquared = magnitudeSquared(determinant)
    const discriminant = Math.max(0, trace * trace - 4 * determinantSquared)
    passivityMaximumSingularValue[index] = Math.sqrt(
      Math.max(0, (trace + Math.sqrt(discriminant)) / 2),
    )
    reciprocityErrorMagnitude[index] = magnitude(subtract(s21, s12))
  }

  return {
    stabilityK,
    stabilityMuSource,
    stabilityMuLoad,
    passivityMaximumSingularValue,
    reciprocityErrorMagnitude,
    ...calculateBandLimitedCausality(network),
  }
}

function calculateBandLimitedCausality(network: TwoPortNetwork): {
  causalityPreEchoEnergyDb: number | null
  causalityTimeResolutionS: number | null
} {
  const sourcePoints = network.frequencyHz.length
  if (sourcePoints < 16) {
    return { causalityPreEchoEnergyDb: null, causalityTimeResolutionS: null }
  }
  const maximumPositiveBins = 513
  const stride = Math.max(
    1,
    Math.ceil((sourcePoints - 1) / (maximumPositiveBins - 1)),
  )
  const positiveBins = Math.floor((sourcePoints - 1) / stride) + 1
  const indices = Array.from(
    { length: positiveBins },
    (_, index) => index * stride,
  )
  const frequencies = indices.map((index) => network.frequencyHz[index]!)
  const spacing = (frequencies.at(-1)! - frequencies[0]!) / (positiveBins - 1)
  if (!(spacing > 0)) {
    return { causalityPreEchoEnergyDb: null, causalityTimeResolutionS: null }
  }
  if (
    frequencies.some(
      (frequency, index) =>
        Math.abs(frequency - (frequencies[0]! + index * spacing)) >
        Math.max(1, Math.abs(frequency)) * 1e-5,
    )
  ) {
    return { causalityPreEchoEnergyDb: null, causalityTimeResolutionS: null }
  }
  const transformSize = 2 * (positiveBins - 1)
  const spectrum = Array.from({ length: transformSize }, () => ({
    re: 0,
    im: 0,
  }))
  const first = at(network.s21, indices[0]!)
  const referenceRotation = {
    re: Math.cos(-Math.atan2(first.im, first.re)),
    im: Math.sin(-Math.atan2(first.im, first.re)),
  }
  for (let bin = 0; bin < positiveBins; bin += 1) {
    const sourceIndex = indices[bin]!
    spectrum[bin] = multiply(at(network.s21, sourceIndex), referenceRotation)
    if (bin > 0 && bin < positiveBins - 1) {
      spectrum[transformSize - bin] = conjugate(spectrum[bin]!)
    }
  }
  let totalEnergy = 0
  let negativeTimeEnergy = 0
  for (let timeIndex = 0; timeIndex < transformSize; timeIndex += 1) {
    let sample = { re: 0, im: 0 }
    for (let bin = 0; bin < transformSize; bin += 1) {
      const angle = (2 * Math.PI * bin * timeIndex) / transformSize
      sample = add(
        sample,
        multiply(spectrum[bin]!, { re: Math.cos(angle), im: Math.sin(angle) }),
      )
    }
    const energy = magnitudeSquared(sample)
    totalEnergy += energy
    if (timeIndex > transformSize / 2) negativeTimeEnergy += energy
  }
  const ratio = totalEnergy > 0 ? negativeTimeEnergy / totalEnergy : 0
  return {
    causalityPreEchoEnergyDb:
      ratio > 0 ? 10 * Math.log10(ratio) : Number.NEGATIVE_INFINITY,
    causalityTimeResolutionS: 1 / (transformSize * spacing),
  }
}

function at(
  array: { re: Float64Array; im: Float64Array },
  index: number,
): ComplexValue {
  return { re: array.re[index]!, im: array.im[index]! }
}

function multiply(left: ComplexValue, right: ComplexValue): ComplexValue {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  }
}

function add(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re + right.re, im: left.im + right.im }
}

function subtract(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re - right.re, im: left.im - right.im }
}

function conjugate(value: ComplexValue): ComplexValue {
  return { re: value.re, im: -value.im }
}

function magnitude(value: ComplexValue): number {
  return Math.hypot(value.re, value.im)
}

function magnitudeSquared(value: ComplexValue): number {
  return value.re * value.re + value.im * value.im
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator <= 1e-30
    ? numerator >= 0
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY
    : numerator / denominator
}
