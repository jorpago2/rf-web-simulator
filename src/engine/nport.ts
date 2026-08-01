import type { ComplexArray, NPortNetwork, TwoPortNetwork } from './types'

export interface ComplexValue {
  re: number
  im: number
}

const MATRIX_TOLERANCE = 1e-14

export function createNPortS(
  portCount: number,
  pointCount: number,
): ComplexArray[] {
  if (!Number.isInteger(portCount) || portCount < 1) {
    throw new RangeError('Port count must be a positive integer.')
  }
  return Array.from({ length: portCount * portCount }, () => ({
    re: new Float64Array(pointCount),
    im: new Float64Array(pointCount),
  }))
}

export function nPortToTwoPort(network: NPortNetwork): TwoPortNetwork {
  if (network.portCount !== 2 || network.s.length !== 4) {
    throw new RangeError('A two-port network is required.')
  }
  const reference = network.referenceImpedancesOhm[0]
  if (
    !Number.isFinite(reference) ||
    reference! <= 0 ||
    Math.abs(reference! - network.referenceImpedancesOhm[1]!) > 1e-9
  ) {
    throw new RangeError(
      'Two-port simulation requires equal real reference impedances; renormalize the imported network first.',
    )
  }
  return {
    frequencyHz: network.frequencyHz,
    referenceImpedanceOhm: reference!,
    s11: network.s[0]!,
    s12: network.s[1]!,
    s21: network.s[2]!,
    s22: network.s[3]!,
    ...(network.sourceName ? { sourceName: network.sourceName } : {}),
  }
}

export function twoPortToNPort(network: TwoPortNetwork): NPortNetwork {
  return {
    frequencyHz: network.frequencyHz,
    portCount: 2,
    referenceImpedancesOhm: new Float64Array([
      network.referenceImpedanceOhm,
      network.referenceImpedanceOhm,
    ]),
    s: [network.s11, network.s12, network.s21, network.s22],
    ...(network.sourceName ? { sourceName: network.sourceName } : {}),
  }
}

export function renormalizeNPortNetwork(
  network: NPortNetwork,
  newReferenceImpedancesOhm: number | readonly number[],
): NPortNetwork {
  validateNPortNetwork(network)
  const newReferences = normalizeReferences(
    newReferenceImpedancesOhm,
    network.portCount,
  )
  const s = createNPortS(network.portCount, network.frequencyHz.length)

  for (
    let pointIndex = 0;
    pointIndex < network.frequencyHz.length;
    pointIndex += 1
  ) {
    const oldS = matrixAt(network.s, pointIndex)
    writeMatrixAt(
      s,
      pointIndex,
      renormalizeScattering(
        oldS,
        network.referenceImpedancesOhm,
        newReferences,
      ),
    )
  }

  return {
    ...network,
    referenceImpedancesOhm: newReferences,
    s,
  }
}

function renormalizeScattering(
  scattering: readonly ComplexValue[],
  oldReferences: ArrayLike<number>,
  newReferences: ArrayLike<number>,
): ComplexValue[] {
  const portCount = matrixSize(scattering)
  validateReferences(oldReferences, portCount)
  validateReferences(newReferences, portCount)
  const diagonalA = new Float64Array(portCount)
  const diagonalB = new Float64Array(portCount)
  for (let port = 0; port < portCount; port += 1) {
    const ratio = Math.sqrt(oldReferences[port]! / newReferences[port]!)
    diagonalA[port] = (ratio + 1 / ratio) / 2
    diagonalB[port] = (ratio - 1 / ratio) / 2
  }
  const a = diagonalMatrix(diagonalA)
  const b = diagonalMatrix(diagonalB)
  return rightDivide(
    addMatrices(b, leftDiagonalMultiply(diagonalA, scattering)),
    addMatrices(a, leftDiagonalMultiply(diagonalB, scattering)),
  )
}

export function impedanceToScattering(
  impedance: readonly ComplexValue[],
  referenceImpedancesOhm: ArrayLike<number>,
): ComplexValue[] {
  const portCount = matrixSize(impedance)
  validateReferences(referenceImpedancesOhm, portCount)
  const normalized = impedance.map((value, index) => {
    const row = Math.floor(index / portCount)
    const column = index % portCount
    const scale = Math.sqrt(
      referenceImpedancesOhm[row]! * referenceImpedancesOhm[column]!,
    )
    return scaleValue(value, 1 / scale)
  })
  return rightDivide(
    subtractMatrices(normalized, identity(portCount)),
    addMatrices(normalized, identity(portCount)),
  )
}

export function admittanceToScattering(
  admittance: readonly ComplexValue[],
  referenceImpedancesOhm: ArrayLike<number>,
): ComplexValue[] {
  const portCount = matrixSize(admittance)
  validateReferences(referenceImpedancesOhm, portCount)
  const normalized = admittance.map((value, index) => {
    const row = Math.floor(index / portCount)
    const column = index % portCount
    const scale = Math.sqrt(
      referenceImpedancesOhm[row]! * referenceImpedancesOhm[column]!,
    )
    return scaleValue(value, scale)
  })
  const unit = identity(portCount)
  return rightDivide(
    subtractMatrices(unit, normalized),
    addMatrices(unit, normalized),
  )
}

export function scatteringToImpedance(
  scattering: readonly ComplexValue[],
  referenceImpedancesOhm: ArrayLike<number>,
): ComplexValue[] {
  const portCount = matrixSize(scattering)
  validateReferences(referenceImpedancesOhm, portCount)
  const unit = identity(portCount)
  const normalized = rightDivide(
    addMatrices(unit, scattering),
    subtractMatrices(unit, scattering),
  )
  return normalized.map((value, index) => {
    const row = Math.floor(index / portCount)
    const column = index % portCount
    const scale = Math.sqrt(
      referenceImpedancesOhm[row]! * referenceImpedancesOhm[column]!,
    )
    return scaleValue(value, scale)
  })
}

export function validateNPortNetwork(network: NPortNetwork): void {
  if (!Number.isInteger(network.portCount) || network.portCount < 1) {
    throw new RangeError('Network port count must be a positive integer.')
  }
  if (network.s.length !== network.portCount * network.portCount) {
    throw new RangeError('S matrix size does not match the network port count.')
  }
  if (network.referenceImpedancesOhm.length !== network.portCount) {
    throw new RangeError('A reference impedance is required for every port.')
  }
  validateReferences(network.referenceImpedancesOhm, network.portCount)
  for (const element of network.s) {
    if (
      element.re.length !== network.frequencyHz.length ||
      element.im.length !== network.frequencyHz.length
    ) {
      throw new RangeError(
        'Every S matrix element must match the frequency grid.',
      )
    }
  }
}

function matrixAt(
  values: readonly ComplexArray[],
  pointIndex: number,
): ComplexValue[] {
  return values.map((value) => ({
    re: value.re[pointIndex]!,
    im: value.im[pointIndex]!,
  }))
}

function writeMatrixAt(
  destination: readonly ComplexArray[],
  pointIndex: number,
  values: readonly ComplexValue[],
): void {
  if (destination.length !== values.length) {
    throw new RangeError('Matrix dimensions do not match.')
  }
  for (let index = 0; index < values.length; index += 1) {
    destination[index]!.re[pointIndex] = values[index]!.re
    destination[index]!.im[pointIndex] = values[index]!.im
  }
}

function normalizeReferences(
  values: number | readonly number[],
  portCount: number,
): Float64Array {
  const result =
    typeof values === 'number'
      ? new Float64Array(portCount).fill(values)
      : new Float64Array(values)
  validateReferences(result, portCount)
  return result
}

function validateReferences(
  values: ArrayLike<number>,
  portCount: number,
): void {
  if (values.length !== portCount) {
    throw new RangeError('Reference impedance count must match the port count.')
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index]) || values[index]! <= 0) {
      throw new RangeError('Reference impedances must be positive real values.')
    }
  }
}

function matrixSize(values: readonly ComplexValue[]): number {
  const size = Math.sqrt(values.length)
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Complex matrix must be square and non-empty.')
  }
  return size
}

function identity(size: number): ComplexValue[] {
  return Array.from({ length: size * size }, (_, index) => ({
    re: index % (size + 1) === 0 ? 1 : 0,
    im: 0,
  }))
}

function diagonalMatrix(values: ArrayLike<number>): ComplexValue[] {
  return Array.from({ length: values.length * values.length }, (_, index) => ({
    re:
      index % (values.length + 1) === 0
        ? values[Math.floor(index / values.length)]!
        : 0,
    im: 0,
  }))
}

function leftDiagonalMultiply(
  diagonal: ArrayLike<number>,
  matrix: readonly ComplexValue[],
): ComplexValue[] {
  const size = matrixSize(matrix)
  if (diagonal.length !== size)
    throw new RangeError('Matrix dimensions do not match.')
  return matrix.map((value, index) =>
    scaleValue(value, diagonal[Math.floor(index / size)]!),
  )
}

function addMatrices(
  left: readonly ComplexValue[],
  right: readonly ComplexValue[],
): ComplexValue[] {
  sameLength(left, right)
  return left.map((value, index) => addValue(value, right[index]!))
}

function subtractMatrices(
  left: readonly ComplexValue[],
  right: readonly ComplexValue[],
): ComplexValue[] {
  sameLength(left, right)
  return left.map((value, index) => subtractValue(value, right[index]!))
}

export function multiplyComplexMatrices(
  left: readonly ComplexValue[],
  right: readonly ComplexValue[],
): ComplexValue[] {
  const size = matrixSize(left)
  if (matrixSize(right) !== size)
    throw new RangeError('Matrix dimensions do not match.')
  const result = Array.from({ length: size * size }, () => ({ re: 0, im: 0 }))
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let sum = { re: 0, im: 0 }
      for (let inner = 0; inner < size; inner += 1) {
        sum = addValue(
          sum,
          multiplyValue(
            left[row * size + inner]!,
            right[inner * size + column]!,
          ),
        )
      }
      result[row * size + column] = sum
    }
  }
  return result
}

function rightDivide(
  numerator: readonly ComplexValue[],
  denominator: readonly ComplexValue[],
): ComplexValue[] {
  return multiplyComplexMatrices(numerator, invertComplexMatrix(denominator))
}

export function invertComplexMatrix(
  values: readonly ComplexValue[],
): ComplexValue[] {
  const size = matrixSize(values)
  const augmented = Array.from({ length: size }, (_, row) => [
    ...values
      .slice(row * size, (row + 1) * size)
      .map((value) => ({ ...value })),
    ...identity(size).slice(row * size, (row + 1) * size),
  ])

  for (let pivotColumn = 0; pivotColumn < size; pivotColumn += 1) {
    let pivotRow = pivotColumn
    let pivotMagnitude = magnitudeSquared(augmented[pivotRow]![pivotColumn]!)
    for (let row = pivotColumn + 1; row < size; row += 1) {
      const candidate = magnitudeSquared(augmented[row]![pivotColumn]!)
      if (candidate > pivotMagnitude) {
        pivotRow = row
        pivotMagnitude = candidate
      }
    }
    if (pivotMagnitude < MATRIX_TOLERANCE * MATRIX_TOLERANCE) {
      throw new RangeError(
        'Network conversion matrix is singular or ill-conditioned.',
      )
    }
    ;[augmented[pivotColumn], augmented[pivotRow]] = [
      augmented[pivotRow]!,
      augmented[pivotColumn]!,
    ]
    const pivot = augmented[pivotColumn]![pivotColumn]!
    augmented[pivotColumn] = augmented[pivotColumn]!.map((value) =>
      divideValue(value, pivot),
    )
    for (let row = 0; row < size; row += 1) {
      if (row === pivotColumn) continue
      const factor = augmented[row]![pivotColumn]!
      augmented[row] = augmented[row]!.map((value, column) =>
        subtractValue(
          value,
          multiplyValue(factor, augmented[pivotColumn]![column]!),
        ),
      )
    }
  }

  return augmented.flatMap((row) => row.slice(size))
}

function sameLength(left: readonly unknown[], right: readonly unknown[]): void {
  if (left.length !== right.length)
    throw new RangeError('Matrix dimensions do not match.')
}

function addValue(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re + right.re, im: left.im + right.im }
}

function subtractValue(left: ComplexValue, right: ComplexValue): ComplexValue {
  return { re: left.re - right.re, im: left.im - right.im }
}

function multiplyValue(left: ComplexValue, right: ComplexValue): ComplexValue {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  }
}

function divideValue(
  numerator: ComplexValue,
  denominator: ComplexValue,
): ComplexValue {
  const scale = magnitudeSquared(denominator)
  if (scale < MATRIX_TOLERANCE * MATRIX_TOLERANCE) {
    throw new RangeError('Cannot divide by a complex value near zero.')
  }
  return {
    re: (numerator.re * denominator.re + numerator.im * denominator.im) / scale,
    im: (numerator.im * denominator.re - numerator.re * denominator.im) / scale,
  }
}

function scaleValue(value: ComplexValue, scale: number): ComplexValue {
  return { re: value.re * scale, im: value.im * scale }
}

function magnitudeSquared(value: ComplexValue): number {
  return value.re * value.re + value.im * value.im
}
