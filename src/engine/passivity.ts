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
    if (scale < 1) {
      const projected = matrix.map((value) => ({ re: value.re * scale, im: value.im * scale }))
      if (maximumSingularValue(projected, network.portCount) > 1 + 1e-10) {
        throw new Error('Passivity projection failed its postcondition.')
      }
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
  if (!Number.isInteger(size) || size < 1 || matrix.length !== size * size) {
    throw new RangeError('A square complex matrix is required.')
  }
  if (matrix.some((value) => !Number.isFinite(value.re) || !Number.isFinite(value.im))) {
    throw new RangeError('Matrix entries must be finite.')
  }

  // A complex Hermitian matrix H = SᴴS has the same eigenvalues as the
  // real-symmetric representation [[Re(H), -Im(H)], [Im(H), Re(H)]].
  const dimension = 2 * size
  const hermitianReal = new Float64Array(dimension * dimension)
  for (let row = 0; row < size; row += 1) {
    for (let column = row; column < size; column += 1) {
      let re = 0
      let im = 0
      for (let inner = 0; inner < size; inner += 1) {
        const left = matrix[inner * size + row]!
        const right = matrix[inner * size + column]!
        re += left.re * right.re + left.im * right.im
        im += left.re * right.im - left.im * right.re
      }
      setSymmetric(hermitianReal, dimension, row, column, re)
      setSymmetric(hermitianReal, dimension, row + size, column + size, re)
      setSymmetric(hermitianReal, dimension, row, column + size, -im)
      setSymmetric(hermitianReal, dimension, row + size, column, im)
    }
  }
  return Math.sqrt(Math.max(0, largestSymmetricEigenvalue(hermitianReal, dimension)))
}

function setSymmetric(matrix: Float64Array, size: number, row: number, column: number, value: number) {
  matrix[row * size + column] = value
  matrix[column * size + row] = value
}

function largestSymmetricEigenvalue(matrix: Float64Array, size: number): number {
  const tolerance = 1e-14
  const maximumRotations = 50 * size * size
  for (let rotation = 0; rotation < maximumRotations; rotation += 1) {
    let pivotRow = 0
    let pivotColumn = 1
    let maximumOffDiagonal = 0
    let diagonalScale = 0
    for (let row = 0; row < size; row += 1) {
      diagonalScale = Math.max(diagonalScale, Math.abs(matrix[row * size + row]!))
      for (let column = row + 1; column < size; column += 1) {
        const magnitude = Math.abs(matrix[row * size + column]!)
        if (magnitude > maximumOffDiagonal) {
          maximumOffDiagonal = magnitude
          pivotRow = row
          pivotColumn = column
        }
      }
    }
    if (maximumOffDiagonal <= tolerance * Math.max(1, diagonalScale)) break
    const pp = matrix[pivotRow * size + pivotRow]!
    const qq = matrix[pivotColumn * size + pivotColumn]!
    const pq = matrix[pivotRow * size + pivotColumn]!
    const angle = 0.5 * Math.atan2(2 * pq, qq - pp)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) continue
      const ip = matrix[index * size + pivotRow]!
      const iq = matrix[index * size + pivotColumn]!
      setSymmetric(matrix, size, index, pivotRow, cosine * ip - sine * iq)
      setSymmetric(matrix, size, index, pivotColumn, sine * ip + cosine * iq)
    }
    matrix[pivotRow * size + pivotRow] = cosine * cosine * pp - 2 * sine * cosine * pq + sine * sine * qq
    matrix[pivotColumn * size + pivotColumn] = sine * sine * pp + 2 * sine * cosine * pq + cosine * cosine * qq
    matrix[pivotRow * size + pivotColumn] = 0
    matrix[pivotColumn * size + pivotRow] = 0
  }
  let maximum = Number.NEGATIVE_INFINITY
  for (let index = 0; index < size; index += 1) maximum = Math.max(maximum, matrix[index * size + index]!)
  return maximum
}
