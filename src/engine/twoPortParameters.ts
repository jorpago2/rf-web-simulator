import {
  invertComplexMatrix,
  scatteringToImpedance,
  type ComplexValue,
} from './nport'
import type { ComplexArray, TwoPortNetwork } from './types'
import { cascadeTwoPorts } from './cascade'

export interface TwoPortParameterSet {
  z: ComplexValue[]
  y: ComplexValue[]
  abcd: ComplexValue[]
}

export function twoPortParametersAt(
  network: TwoPortNetwork,
  pointIndex: number,
): TwoPortParameterSet {
  const scattering = scatteringAt(network, pointIndex)
  const references = new Float64Array(2).fill(network.referenceImpedanceOhm)
  const z = scatteringToImpedance(scattering, references)
  return {
    z,
    y: invertComplexMatrix(z),
    abcd: scatteringToAbcd(scattering, network.referenceImpedanceOhm),
  }
}

export function invertTwoPortNetwork(network: TwoPortNetwork): TwoPortNetwork {
  const s11 = createComplexArray(network.frequencyHz.length)
  const s12 = createComplexArray(network.frequencyHz.length)
  const s21 = createComplexArray(network.frequencyHz.length)
  const s22 = createComplexArray(network.frequencyHz.length)
  for (let index = 0; index < network.frequencyHz.length; index += 1) {
    const abcd = scatteringToAbcd(
      scatteringAt(network, index),
      network.referenceImpedanceOhm,
    )
    const [a, b, c, d] = abcd
    const determinant = subtract(multiply(a!, d!), multiply(b!, c!))
    const inverse = [
      divide(d!, determinant),
      divide(scale(b!, -1), determinant),
      divide(scale(c!, -1), determinant),
      divide(a!, determinant),
    ]
    const scattering = abcdToScattering(inverse, network.referenceImpedanceOhm)
    write(s11, index, scattering[0]!)
    write(s12, index, scattering[1]!)
    write(s21, index, scattering[2]!)
    write(s22, index, scattering[3]!)
  }
  return {
    frequencyHz: network.frequencyHz,
    referenceImpedanceOhm: network.referenceImpedanceOhm,
    s11,
    s12,
    s21,
    s22,
    sourceName: `${network.sourceName ?? 'Network'} inverse`,
  }
}

export function deembedTwoPortNetwork(
  measured: TwoPortNetwork,
  leftFixture?: TwoPortNetwork,
  rightFixture?: TwoPortNetwork,
): TwoPortNetwork {
  let result = measured
  if (leftFixture) {
    result = cascadeTwoPorts(invertTwoPortNetwork(leftFixture), result).network
  }
  if (rightFixture) {
    result = cascadeTwoPorts(result, invertTwoPortNetwork(rightFixture)).network
  }
  return {
    ...result,
    sourceName: `${measured.sourceName ?? 'Network'} de-embedded`,
  }
}

function scatteringToAbcd(
  scattering: ComplexValue[],
  referenceImpedanceOhm: number,
): ComplexValue[] {
  const [s11, s12, s21, s22] = scattering
  if (!s11 || !s12 || !s21 || !s22)
    throw new RangeError('A two-port S matrix is required.')
  const twoS21 = scale(s21, 2)
  const s12s21 = multiply(s12, s21)
  const one = { re: 1, im: 0 }
  return [
    divide(add(multiply(add(one, s11), subtract(one, s22)), s12s21), twoS21),
    scale(
      divide(subtract(multiply(add(one, s11), add(one, s22)), s12s21), twoS21),
      referenceImpedanceOhm,
    ),
    scale(
      divide(
        subtract(multiply(subtract(one, s11), subtract(one, s22)), s12s21),
        twoS21,
      ),
      1 / referenceImpedanceOhm,
    ),
    divide(add(multiply(subtract(one, s11), add(one, s22)), s12s21), twoS21),
  ]
}

function abcdToScattering(
  abcd: ComplexValue[],
  referenceImpedanceOhm: number,
): ComplexValue[] {
  const [a, b, c, d] = abcd
  if (!a || !b || !c || !d)
    throw new RangeError('A 2×2 ABCD matrix is required.')
  const bNormalized = scale(b, 1 / referenceImpedanceOhm)
  const cNormalized = scale(c, referenceImpedanceOhm)
  const denominator = add(add(a, bNormalized), add(cNormalized, d))
  const determinant = subtract(multiply(a, d), multiply(b, c))
  return [
    divide(subtract(add(a, bNormalized), add(cNormalized, d)), denominator),
    divide(scale(determinant, 2), denominator),
    divide({ re: 2, im: 0 }, denominator),
    divide(
      add(subtract(bNormalized, a), subtract(d, cNormalized)),
      denominator,
    ),
  ]
}

function scatteringAt(network: TwoPortNetwork, index: number): ComplexValue[] {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= network.frequencyHz.length
  ) {
    throw new RangeError('Two-port parameter index is invalid.')
  }
  return [
    at(network.s11, index),
    at(network.s12, index),
    at(network.s21, index),
    at(network.s22, index),
  ]
}

function at(array: ComplexArray, index: number): ComplexValue {
  return { re: array.re[index]!, im: array.im[index]! }
}

function createComplexArray(length: number): ComplexArray {
  return { re: new Float64Array(length), im: new Float64Array(length) }
}

function write(array: ComplexArray, index: number, value: ComplexValue): void {
  array.re[index] = value.re
  array.im[index] = value.im
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

function divide(
  numerator: ComplexValue,
  denominator: ComplexValue,
): ComplexValue {
  const scaleValue =
    denominator.re * denominator.re + denominator.im * denominator.im
  if (scaleValue <= 1e-28) {
    throw new RangeError('Two-port parameter conversion is singular.')
  }
  return {
    re:
      (numerator.re * denominator.re + numerator.im * denominator.im) /
      scaleValue,
    im:
      (numerator.im * denominator.re - numerator.re * denominator.im) /
      scaleValue,
  }
}

function scale(value: ComplexValue, factor: number): ComplexValue {
  return { re: value.re * factor, im: value.im * factor }
}
