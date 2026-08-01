import {
  noiseFactorForSourceReflection,
  noiseParametersAt,
} from './noiseParameters'
import type { TouchstoneNoiseData } from './touchstone'
import { calculateTransducerGain } from './transducer'
import type { NPortNetwork, TwoPortNetwork } from './types'
import type { ComplexValue } from './nport'
import { maximumSingularValue } from './passivity'

/** Bosma relation C/kT = I - SSᴴ for a passive network at the reference temperature. */
export function passiveNoiseCorrelationAt(
  network: NPortNetwork,
  pointIndex: number,
): ComplexValue[] | null {
  const size = network.portCount
  const scattering = network.s.map((value) => ({
    re: value.re[pointIndex]!,
    im: value.im[pointIndex]!,
  }))
  if (maximumSingularValue(scattering, size) > 1 + 1e-9) return null
  return Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size)
    const column = index % size
    let product = { re: 0, im: 0 }
    for (let inner = 0; inner < size; inner += 1) {
      product = add(
        product,
        multiply(
          scattering[row * size + inner]!,
          conjugate(scattering[column * size + inner]!),
        ),
      )
    }
    return {
      re: (row === column ? 1 : 0) - product.re,
      im: -product.im,
    }
  })
}

/** Output-only behavioral correlation for a declared matched noise figure. */
export function outputNoiseCorrelationAt(
  network: TwoPortNetwork,
  pointIndex: number,
  noiseFigureDb: number,
): ComplexValue[] {
  const gain =
    network.s21.re[pointIndex]! ** 2 + network.s21.im[pointIndex]! ** 2
  const addedOutputNoise = (10 ** (noiseFigureDb / 10) - 1) * gain
  return [
    { re: 0, im: 0 },
    { re: 0, im: 0 },
    { re: 0, im: 0 },
    { re: Math.max(0, addedOutputNoise), im: 0 },
  ]
}

/** Recover the complete two-port noise-wave correlation from Fmin/GammaOpt/Rn. */
export function touchstoneNoiseCorrelationAt(
  network: TwoPortNetwork,
  pointIndex: number,
  noise: TouchstoneNoiseData,
  noiseFrequencyHz: number,
  noiseReferenceImpedanceOhm: number,
): ComplexValue[] | null {
  const parameters = noiseParametersAt(noise, noiseFrequencyHz)
  const s11 = at(network.s11, pointIndex)
  const s21 = at(network.s21, pointIndex)
  const samples = [
    { re: 0, im: 0 },
    { re: 0.5, im: 0 },
    { re: -0.5, im: 0 },
    { re: 0, im: 0.5 },
  ]
  const equations = samples.map((gamma) => {
    const denominator = subtract({ re: 1, im: 0 }, multiply(s11, gamma))
    const alpha = divide(multiply(s21, gamma), denominator)
    const gain =
      (magnitudeSquared(s21) * (1 - magnitudeSquared(gamma))) /
      magnitudeSquared(denominator)
    const noiseFactor = noiseFactorForSourceReflection(
      parameters,
      gamma,
      noiseReferenceImpedanceOhm,
    )
    return { alpha, addedNoise: (noiseFactor - 1) * gain }
  })
  const c22 = Math.max(0, equations[0]!.addedNoise)
  const matrix = equations
    .slice(1)
    .map(({ alpha }) => [magnitudeSquared(alpha), 2 * alpha.re, -2 * alpha.im])
  const right = equations.slice(1).map(({ addedNoise }) => addedNoise - c22)
  const solved = solveReal3(matrix, right)
  if (!solved) return null
  const c11 = Math.max(0, solved[0]!)
  let c12 = { re: solved[1]!, im: solved[2]! }
  const maximumCrossMagnitude = Math.sqrt(c11 * c22)
  const crossMagnitude = Math.sqrt(magnitudeSquared(c12))
  if (crossMagnitude > maximumCrossMagnitude && crossMagnitude > 0) {
    c12 = scale(c12, maximumCrossMagnitude / crossMagnitude)
  }
  return [{ re: c11, im: 0 }, c12, conjugate(c12), { re: c22, im: 0 }]
}

export function noiseFigureFromCorrelation(
  network: TwoPortNetwork,
  pointIndex: number,
  correlation: ComplexValue[],
  sourceImpedanceOhm: number,
  loadImpedanceOhm: number,
): number {
  if (correlation.length !== 4) {
    throw new RangeError('Two-port noise correlation must contain four values.')
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
  const inverse = inverse2([
    subtract({ re: 1, im: 0 }, scale(s11, gammaSource)),
    scale(s12, -gammaLoad),
    scale(s21, -gammaSource),
    subtract({ re: 1, im: 0 }, scale(s22, gammaLoad)),
  ])
  const outputTransfer = [inverse[2]!, inverse[3]!]
  let addedNoise = 0
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      addedNoise += multiply(
        multiply(outputTransfer[row]!, correlation[row * 2 + column]!),
        conjugate(outputTransfer[column]!),
      ).re
    }
  }
  const transducerGain = calculateTransducerGain(
    network,
    pointIndex,
    sourceImpedanceOhm,
    loadImpedanceOhm,
  ).transducerGainLinear
  if (transducerGain <= 0) {
    throw new RangeError('Noise figure is undefined for zero transducer gain.')
  }
  const factor =
    1 + ((1 - gammaLoad * gammaLoad) * Math.max(0, addedNoise)) / transducerGain
  return 10 * Math.log10(factor)
}

function solveReal3(matrix: number[][], right: number[]): number[] | null {
  const rows = matrix.map((row, index) => [...row, right[index]!])
  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!))
        pivot = row
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-18) return null
    ;[rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!]
    const divisor = rows[column]![column]!
    for (let index = column; index < 4; index += 1)
      rows[column]![index]! /= divisor
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue
      const factor = rows[row]![column]!
      for (let index = column; index < 4; index += 1) {
        rows[row]![index]! -= factor * rows[column]![index]!
      }
    }
  }
  return rows.map((row) => row[3]!)
}

function inverse2(matrix: ComplexValue[]): ComplexValue[] {
  const determinant = subtract(
    multiply(matrix[0]!, matrix[3]!),
    multiply(matrix[1]!, matrix[2]!),
  )
  if (magnitudeSquared(determinant) < 1e-28) {
    throw new RangeError('Noise termination system is singular.')
  }
  return [
    divide(matrix[3]!, determinant),
    divide(scale(matrix[1]!, -1), determinant),
    divide(scale(matrix[2]!, -1), determinant),
    divide(matrix[0]!, determinant),
  ]
}

function at(
  array: { re: Float64Array; im: Float64Array },
  index: number,
): ComplexValue {
  return { re: array.re[index]!, im: array.im[index]! }
}

function add(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re + right.re, im: left.im + right.im }
}

function subtract(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re - right.re, im: left.im - right.im }
}

function multiply(left: ComplexValue, right: ComplexValue): ComplexValue {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  }
}

function divide(left: ComplexValue, right: ComplexValue): ComplexValue {
  const denominator = magnitudeSquared(right)
  return {
    re: (left.re * right.re + left.im * right.im) / denominator,
    im: (left.im * right.re - left.re * right.im) / denominator,
  }
}

function scale(value: ComplexValue, factor: number): ComplexValue {
  return { re: value.re * factor, im: value.im * factor }
}

function conjugate(value: ComplexValue): ComplexValue {
  return { re: value.re, im: -value.im }
}

function magnitudeSquared(value: ComplexValue): number {
  return value.re * value.re + value.im * value.im
}
