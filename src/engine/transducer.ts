import type { TwoPortNetwork } from './types'

export interface TransducerResult {
  sourceReflectionCoefficient: number
  loadReflectionCoefficient: number
  transducerGainLinear: number
  transducerGainDb: number
}

export function calculateTransducerGain(
  network: TwoPortNetwork,
  pointIndex: number,
  sourceImpedanceOhm: number,
  loadImpedanceOhm: number,
): TransducerResult {
  if (
    !Number.isFinite(sourceImpedanceOhm) ||
    sourceImpedanceOhm <= 0 ||
    !Number.isFinite(loadImpedanceOhm) ||
    loadImpedanceOhm <= 0
  ) {
    throw new RangeError(
      'Source and load impedances must be positive real values.',
    )
  }
  if (
    !Number.isInteger(pointIndex) ||
    pointIndex < 0 ||
    pointIndex >= network.frequencyHz.length
  ) {
    throw new RangeError('Transducer-gain frequency index is invalid.')
  }
  const reference = network.referenceImpedanceOhm
  const gammaSource =
    (sourceImpedanceOhm - reference) / (sourceImpedanceOhm + reference)
  const gammaLoad =
    (loadImpedanceOhm - reference) / (loadImpedanceOhm + reference)
  const s11 = at(network.s11, pointIndex)
  const s12 = at(network.s12, pointIndex)
  const s21 = at(network.s21, pointIndex)
  const s22 = at(network.s22, pointIndex)
  const first = multiply(
    subtract({ re: 1, im: 0 }, scale(s11, gammaSource)),
    subtract({ re: 1, im: 0 }, scale(s22, gammaLoad)),
  )
  const feedback = scale(multiply(s12, s21), gammaSource * gammaLoad)
  const denominator = magnitudeSquared(subtract(first, feedback))
  if (denominator <= 1e-28) {
    throw new RangeError(
      'Transducer gain is singular for the selected terminations.',
    )
  }
  const transducerGainLinear =
    (magnitudeSquared(s21) *
      (1 - gammaSource * gammaSource) *
      (1 - gammaLoad * gammaLoad)) /
    denominator
  const transducerGainDb =
    transducerGainLinear > 0
      ? 10 * Math.log10(transducerGainLinear)
      : Number.NEGATIVE_INFINITY
  return {
    sourceReflectionCoefficient: gammaSource,
    loadReflectionCoefficient: gammaLoad,
    transducerGainLinear,
    transducerGainDb,
  }
}

interface ComplexValue {
  re: number
  im: number
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

function subtract(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re - right.re, im: left.im - right.im }
}

function scale(value: ComplexValue, factor: number): ComplexValue {
  return { re: value.re * factor, im: value.im * factor }
}

function magnitudeSquared(value: ComplexValue): number {
  return value.re * value.re + value.im * value.im
}
