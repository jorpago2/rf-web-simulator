import type { ComplexArray, NPortNetwork, TwoPortNetwork } from './types'

export interface ComplexValue {
  re: number
  im: number
}

export interface ComplexLinearSolveDiagnostics {
  reciprocalConditionEstimate: number
  normalizedResidual: number
}

export interface ComplexLinearSolveResult {
  solution: ComplexValue[]
  diagnostics: ComplexLinearSolveDiagnostics
}

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
  const size = matrixSize(numerator)
  if (matrixSize(denominator) !== size) {
    throw new RangeError('Matrix dimensions do not match.')
  }
  const transposedDenominator = transposeSquare(denominator, size)
  const transposedNumerator = transposeSquare(numerator, size)
  return transposeRectangular(
    solveComplexLinearSystem(
      transposedDenominator,
      transposedNumerator,
      size,
    ).solution,
    size,
    size,
  )
}

export function invertComplexMatrix(
  values: readonly ComplexValue[],
): ComplexValue[] {
  const size = matrixSize(values)
  return solveComplexLinearSystem(values, identity(size), size).solution
}

export function solveComplexLinearSystem(
  values: readonly ComplexValue[],
  rightHandSide: readonly ComplexValue[],
  rightColumns: number,
): ComplexLinearSolveResult {
  const size = matrixSize(values)
  if (
    !Number.isInteger(rightColumns) ||
    rightColumns < 1 ||
    rightHandSide.length !== size * rightColumns
  ) {
    throw new RangeError('Matrix dimensions do not match.')
  }
  const matrix = values.map(validateFiniteComplex)
  const right = rightHandSide.map(validateFiniteComplex)
  const factorization = factorComplexMatrix(matrix, size)
  const solution = solveFactoredComplexSystem(
    factorization,
    right,
    rightColumns,
  )
  const inverse = solveFactoredComplexSystem(
    factorization,
    identity(size),
    size,
  )
  const denominator =
    matrixInfinityNorm(matrix, size, size) *
    matrixInfinityNorm(inverse, size, size)
  const reciprocalConditionEstimate =
    denominator > 0 && Number.isFinite(denominator) ? 1 / denominator : 0
  const residual = subtractRectangular(
    multiplyRectangularLocal(matrix, size, size, solution, rightColumns),
    right,
  )
  const residualDenominator =
    matrixInfinityNorm(matrix, size, size) *
      matrixInfinityNorm(solution, size, rightColumns) +
    matrixInfinityNorm(right, size, rightColumns)
  const normalizedResidual =
    residualDenominator > 0
      ? matrixInfinityNorm(residual, size, rightColumns) / residualDenominator
      : matrixInfinityNorm(residual, size, rightColumns)
  if (
    !Number.isFinite(reciprocalConditionEstimate) ||
    !Number.isFinite(normalizedResidual)
  ) {
    throw new RangeError('Network linear solve produced non-finite evidence.')
  }
  return {
    solution,
    diagnostics: { reciprocalConditionEstimate, normalizedResidual },
  }
}

interface ComplexFactorization {
  lu: ComplexValue[]
  permutation: number[]
  size: number
}

function factorComplexMatrix(
  values: readonly ComplexValue[],
  size: number,
): ComplexFactorization {
  const lu = values.map((value) => ({ ...value }))
  const permutation = Array.from({ length: size }, (_, index) => index)
  const scales = Array.from({ length: size }, (_, row) => {
    let scale = 0
    for (let column = 0; column < size; column += 1) {
      scale = Math.max(scale, Math.hypot(lu[row * size + column]!.re, lu[row * size + column]!.im))
    }
    return scale
  })
  const matrixNorm = matrixInfinityNorm(values, size, size)
  if (!(matrixNorm > 0)) {
    throw new RangeError('Network conversion matrix is singular.')
  }
  const pivotFloor = Number.EPSILON * Math.max(1, size) * matrixNorm

  for (let pivotColumn = 0; pivotColumn < size; pivotColumn += 1) {
    let pivotRow = pivotColumn
    let bestScaledMagnitude = -1
    for (let row = pivotColumn; row < size; row += 1) {
      const value = lu[row * size + pivotColumn]!
      const scaledMagnitude =
        scales[row]! > 0 ? Math.hypot(value.re, value.im) / scales[row]! : 0
      if (scaledMagnitude > bestScaledMagnitude) {
        bestScaledMagnitude = scaledMagnitude
        pivotRow = row
      }
    }
    const pivotCandidate = lu[pivotRow * size + pivotColumn]!
    if (Math.hypot(pivotCandidate.re, pivotCandidate.im) <= pivotFloor) {
      throw new RangeError(
        'Network conversion matrix is singular to working precision.',
      )
    }
    if (pivotRow !== pivotColumn) {
      for (let column = 0; column < size; column += 1) {
        ;[
          lu[pivotColumn * size + column],
          lu[pivotRow * size + column],
        ] = [
          lu[pivotRow * size + column]!,
          lu[pivotColumn * size + column]!,
        ]
      }
      ;[scales[pivotColumn], scales[pivotRow]] = [
        scales[pivotRow]!,
        scales[pivotColumn]!,
      ]
      ;[permutation[pivotColumn], permutation[pivotRow]] = [
        permutation[pivotRow]!,
        permutation[pivotColumn]!,
      ]
    }
    const pivot = lu[pivotColumn * size + pivotColumn]!
    for (let row = pivotColumn + 1; row < size; row += 1) {
      const multiplier = divideFiniteValue(
        lu[row * size + pivotColumn]!,
        pivot,
      )
      lu[row * size + pivotColumn] = multiplier
      for (let column = pivotColumn + 1; column < size; column += 1) {
        lu[row * size + column] = subtractValue(
          lu[row * size + column]!,
          multiplyValue(multiplier, lu[pivotColumn * size + column]!),
        )
      }
    }
  }
  return { lu, permutation, size }
}

function solveFactoredComplexSystem(
  factorization: ComplexFactorization,
  rightHandSide: readonly ComplexValue[],
  rightColumns: number,
): ComplexValue[] {
  const { lu, permutation, size } = factorization
  const solution = Array.from({ length: size * rightColumns }, (_, index) => {
    const row = Math.floor(index / rightColumns)
    const column = index % rightColumns
    return { ...rightHandSide[permutation[row]! * rightColumns + column]! }
  })
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < rightColumns; column += 1) {
      let value = solution[row * rightColumns + column]!
      for (let inner = 0; inner < row; inner += 1) {
        value = subtractValue(
          value,
          multiplyValue(
            lu[row * size + inner]!,
            solution[inner * rightColumns + column]!,
          ),
        )
      }
      solution[row * rightColumns + column] = value
    }
  }
  for (let row = size - 1; row >= 0; row -= 1) {
    for (let column = 0; column < rightColumns; column += 1) {
      let value = solution[row * rightColumns + column]!
      for (let inner = row + 1; inner < size; inner += 1) {
        value = subtractValue(
          value,
          multiplyValue(
            lu[row * size + inner]!,
            solution[inner * rightColumns + column]!,
          ),
        )
      }
      solution[row * rightColumns + column] = divideFiniteValue(
        value,
        lu[row * size + row]!,
      )
    }
  }
  return solution
}

function validateFiniteComplex(value: ComplexValue): ComplexValue {
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) {
    throw new RangeError('Network matrix entries must be finite.')
  }
  return { ...value }
}

function matrixInfinityNorm(
  values: readonly ComplexValue[],
  rows: number,
  columns: number,
): number {
  let norm = 0
  for (let row = 0; row < rows; row += 1) {
    let sum = 0
    for (let column = 0; column < columns; column += 1) {
      const value = values[row * columns + column]!
      sum += Math.hypot(value.re, value.im)
    }
    norm = Math.max(norm, sum)
  }
  return norm
}

function multiplyRectangularLocal(
  left: readonly ComplexValue[],
  leftRows: number,
  innerSize: number,
  right: readonly ComplexValue[],
  rightColumns: number,
): ComplexValue[] {
  const result = Array.from({ length: leftRows * rightColumns }, () => ({ re: 0, im: 0 }))
  for (let row = 0; row < leftRows; row += 1) {
    for (let column = 0; column < rightColumns; column += 1) {
      let sum = { re: 0, im: 0 }
      for (let inner = 0; inner < innerSize; inner += 1) {
        sum = addValue(
          sum,
          multiplyValue(
            left[row * innerSize + inner]!,
            right[inner * rightColumns + column]!,
          ),
        )
      }
      result[row * rightColumns + column] = sum
    }
  }
  return result
}

function subtractRectangular(
  left: readonly ComplexValue[],
  right: readonly ComplexValue[],
): ComplexValue[] {
  sameLength(left, right)
  return left.map((value, index) => subtractValue(value, right[index]!))
}

function transposeSquare(
  values: readonly ComplexValue[],
  size: number,
): ComplexValue[] {
  return transposeRectangular(values, size, size)
}

function transposeRectangular(
  values: readonly ComplexValue[],
  rows: number,
  columns: number,
): ComplexValue[] {
  return Array.from({ length: values.length }, (_, index) => {
    const row = Math.floor(index / rows)
    const column = index % rows
    return { ...values[column * columns + row]! }
  })
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

function divideFiniteValue(
  numerator: ComplexValue,
  denominator: ComplexValue,
): ComplexValue {
  const realMagnitude = Math.abs(denominator.re)
  const imaginaryMagnitude = Math.abs(denominator.im)
  let result: ComplexValue
  if (realMagnitude >= imaginaryMagnitude) {
    const ratio = denominator.im / denominator.re
    const scale = denominator.re + denominator.im * ratio
    result = {
      re: (numerator.re + numerator.im * ratio) / scale,
      im: (numerator.im - numerator.re * ratio) / scale,
    }
  } else {
    const ratio = denominator.re / denominator.im
    const scale = denominator.im + denominator.re * ratio
    result = {
      re: (numerator.re * ratio + numerator.im) / scale,
      im: (numerator.im * ratio - numerator.re) / scale,
    }
  }
  if (!Number.isFinite(result.re) || !Number.isFinite(result.im)) {
    throw new RangeError('Complex linear solve produced a non-finite value.')
  }
  return result
}

function scaleValue(value: ComplexValue, scale: number): ComplexValue {
  return { re: value.re * scale, im: value.im * scale }
}
