import { createNPortS, type ComplexValue } from './nport'
import type { NPortNetwork } from './types'

export interface PassivityEnforcementResult {
  network: NPortNetwork
  correctedPointCount: number
  maximumOriginalSingularValue: number
}

/** Conservative projection S <- S/max(1,sigmaMax); opt-in because it changes measured data. */
export function enforceNPortPassivity(
  network: NPortNetwork,
): PassivityEnforcementResult {
  const output: NPortNetwork = {
    frequencyHz: network.frequencyHz,
    portCount: network.portCount,
    referenceImpedancesOhm: new Float64Array(network.referenceImpedancesOhm),
    s: createNPortS(network.portCount, network.frequencyHz.length),
    ...(network.sourceName ? { sourceName: network.sourceName } : {}),
  }
  let correctedPointCount = 0
  let maximumOriginalSingularValue = 0
  for (
    let pointIndex = 0;
    pointIndex < network.frequencyHz.length;
    pointIndex += 1
  ) {
    const matrix = network.s.map((value) => ({
      re: value.re[pointIndex]!,
      im: value.im[pointIndex]!,
    }))
    const singularValue = maximumSingularValue(matrix, network.portCount)
    maximumOriginalSingularValue = Math.max(
      maximumOriginalSingularValue,
      singularValue,
    )
    const scale = singularValue > 1 ? 1 / singularValue : 1
    if (scale < 1) correctedPointCount += 1
    for (let index = 0; index < matrix.length; index += 1) {
      output.s[index]!.re[pointIndex] = matrix[index]!.re * scale
      output.s[index]!.im[pointIndex] = matrix[index]!.im * scale
    }
  }
  return {
    network: {
      ...output,
      ...(network.portLabels ? { portLabels: [...network.portLabels] } : {}),
    },
    correctedPointCount,
    maximumOriginalSingularValue,
  }
}

export function maximumSingularValue(
  matrix: ComplexValue[],
  size: number,
): number {
  let vector = Array.from({ length: size }, (_, index) => ({
    re: Math.cos((index + 1) * Math.SQRT2) / Math.sqrt(size),
    im: Math.sin((index + 1) * Math.SQRT2) / Math.sqrt(size),
  }))
  let eigenvalue = 0
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const forward = Array.from({ length: size }, () => ({ re: 0, im: 0 }))
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        forward[row] = add(
          forward[row]!,
          multiply(matrix[row * size + column]!, vector[column]!),
        )
      }
    }
    const product = Array.from({ length: size }, () => ({ re: 0, im: 0 }))
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        product[row] = add(
          product[row]!,
          multiply(conjugate(matrix[column * size + row]!), forward[column]!),
        )
      }
    }
    const norm = Math.sqrt(
      product.reduce((sum, value) => sum + magnitudeSquared(value), 0),
    )
    if (norm === 0) return 0
    vector = product.map((value) => ({
      re: value.re / norm,
      im: value.im / norm,
    }))
    eigenvalue = norm
  }
  return Math.sqrt(Math.max(0, eigenvalue))
}

function add(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re + right.re, im: left.im + right.im }
}

function multiply(left: ComplexValue, right: ComplexValue): ComplexValue {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  }
}

function conjugate(value: ComplexValue): ComplexValue {
  return { re: value.re, im: -value.im }
}

function magnitudeSquared(value: ComplexValue): number {
  return value.re * value.re + value.im * value.im
}
