import { invertComplexMatrix, type ComplexValue } from './nport'
import type { ComplexArray, NPortNetwork, TwoPortNetwork } from './types'

export interface NetworkBlock {
  nodeId: string
  portIds: readonly string[]
  network: NPortNetwork
  /** Normalized E[c cᴴ]/kT noise-wave correlation at one frequency point. */
  noiseCorrelationAt?: (pointIndex: number) => ComplexValue[] | null
}

export interface NetworkPortReference {
  nodeId: string
  portId: string
}

export interface NetworkConnection {
  first: NetworkPortReference
  second: NetworkPortReference
}

export function solveNPortInterconnection(
  blocks: readonly NetworkBlock[],
  connections: readonly NetworkConnection[],
  externalInput: NetworkPortReference,
  externalOutput: NetworkPortReference,
  referenceImpedanceOhm: number,
): TwoPortNetwork {
  if (blocks.length === 0) {
    throw new RangeError(
      'N-port interconnection requires at least one network block.',
    )
  }
  const frequencyHz = blocks[0]!.network.frequencyHz
  const { totalPorts, inputIndex, outputIndex, internalIndices } =
    prepareInterconnection(
      blocks,
      connections,
      externalInput,
      externalOutput,
      referenceImpedanceOhm,
    )

  const s11 = createComplexArray(frequencyHz.length)
  const s12 = createComplexArray(frequencyHz.length)
  const s21 = createComplexArray(frequencyHz.length)
  const s22 = createComplexArray(frequencyHz.length)
  const externalIndices = [inputIndex, outputIndex]
  for (let pointIndex = 0; pointIndex < frequencyHz.length; pointIndex += 1) {
    const composite = compositeScatteringAt(blocks, totalPorts, pointIndex)
    const effective = eliminateConnectedPorts(
      composite,
      totalPorts,
      internalIndices,
      externalIndices,
    )
    writeValue(s11, pointIndex, effective[0]!)
    writeValue(s12, pointIndex, effective[1]!)
    writeValue(s21, pointIndex, effective[2]!)
    writeValue(s22, pointIndex, effective[3]!)
  }

  return {
    frequencyHz,
    referenceImpedanceOhm,
    s11,
    s12,
    s21,
    s22,
    sourceName: 'Interconnected RF network',
  }
}

export function solveNPortNoiseCorrelationAt(
  blocks: readonly NetworkBlock[],
  connections: readonly NetworkConnection[],
  externalInput: NetworkPortReference,
  externalOutput: NetworkPortReference,
  referenceImpedanceOhm: number,
  pointIndex: number,
): ComplexValue[] | null {
  if (!Number.isInteger(pointIndex) || pointIndex < 0) {
    throw new RangeError('Noise-wave frequency index is invalid.')
  }
  const { totalPorts, inputIndex, outputIndex, internalIndices } =
    prepareInterconnection(
      blocks,
      connections,
      externalInput,
      externalOutput,
      referenceImpedanceOhm,
    )
  if (pointIndex >= blocks[0]!.network.frequencyHz.length) {
    throw new RangeError('Noise-wave frequency index is invalid.')
  }
  const correlation = compositeNoiseCorrelationAt(
    blocks,
    totalPorts,
    pointIndex,
  )
  if (!correlation) return null
  const scattering = compositeScatteringAt(blocks, totalPorts, pointIndex)
  const transfer = externalNoiseTransfer(
    scattering,
    totalPorts,
    internalIndices,
    [inputIndex, outputIndex],
  )
  const left = multiplyRectangular(
    transfer,
    2,
    totalPorts,
    correlation,
    totalPorts,
  )
  const transferHermitian = Array.from(
    { length: totalPorts * 2 },
    (_, index) => {
      const row = Math.floor(index / 2)
      const column = index % 2
      return conjugate(transfer[column * totalPorts + row]!)
    },
  )
  return multiplyRectangular(left, 2, totalPorts, transferHermitian, 2)
}

export function solveNPortWaveAt(
  blocks: readonly NetworkBlock[],
  connections: readonly NetworkConnection[],
  externalInput: NetworkPortReference,
  externalOutput: NetworkPortReference,
  observation: NetworkPortReference,
  referenceImpedanceOhm: number,
): ComplexArray {
  return solveNPortPortWave(
    blocks,
    connections,
    externalInput,
    externalOutput,
    observation,
    referenceImpedanceOhm,
    true,
  )
}

export function solveNPortIncidentWaveAt(
  blocks: readonly NetworkBlock[],
  connections: readonly NetworkConnection[],
  externalInput: NetworkPortReference,
  externalOutput: NetworkPortReference,
  observation: NetworkPortReference,
  referenceImpedanceOhm: number,
): ComplexArray {
  return solveNPortPortWave(
    blocks,
    connections,
    externalInput,
    externalOutput,
    observation,
    referenceImpedanceOhm,
    false,
  )
}

function solveNPortPortWave(
  blocks: readonly NetworkBlock[],
  connections: readonly NetworkConnection[],
  externalInput: NetworkPortReference,
  externalOutput: NetworkPortReference,
  observation: NetworkPortReference,
  referenceImpedanceOhm: number,
  outgoing: boolean,
): ComplexArray {
  const { totalPorts, inputIndex, outputIndex, internalIndices, portIndex } =
    prepareInterconnection(
      blocks,
      connections,
      externalInput,
      externalOutput,
      referenceImpedanceOhm,
    )
  const observationIndex = requiredPortIndex(portIndex, observation)
  const frequencyHz = blocks[0]!.network.frequencyHz
  const result = createComplexArray(frequencyHz.length)
  for (let pointIndex = 0; pointIndex < frequencyHz.length; pointIndex += 1) {
    const scattering = compositeScatteringAt(blocks, totalPorts, pointIndex)
    const incident = Array.from({ length: totalPorts }, () => ({
      re: 0,
      im: 0,
    }))
    incident[inputIndex] = { re: 1, im: 0 }
    incident[outputIndex] = { re: 0, im: 0 }
    if (internalIndices.length > 0) {
      const internalCount = internalIndices.length
      const sie = submatrix(scattering, totalPorts, internalIndices, [
        inputIndex,
        outputIndex,
      ])
      const sii = submatrix(
        scattering,
        totalPorts,
        internalIndices,
        internalIndices,
      )
      const permutation = connectionPermutation(internalCount)
      const permutedSii = multiplyRectangular(
        permutation,
        internalCount,
        internalCount,
        sii,
        internalCount,
      )
      const system = permutedSii.map((value, index) => ({
        re: (index % (internalCount + 1) === 0 ? 1 : 0) - value.re,
        im: -value.im,
      }))
      const inverse = invertComplexMatrix(system)
      const permutedSie = multiplyRectangular(
        permutation,
        internalCount,
        internalCount,
        sie,
        2,
      )
      const internalIncident = multiplyRectangular(
        inverse,
        internalCount,
        internalCount,
        permutedSie,
        2,
      )
      for (let index = 0; index < internalCount; index += 1) {
        incident[internalIndices[index]!] = internalIncident[index * 2]!
      }
    }
    let observed = incident[observationIndex]!
    if (outgoing) {
      observed = { re: 0, im: 0 }
      for (let column = 0; column < totalPorts; column += 1) {
        observed = add(
          observed,
          multiply(
            scattering[observationIndex * totalPorts + column]!,
            incident[column]!,
          ),
        )
      }
    }
    writeValue(result, pointIndex, observed)
  }
  return result
}

function prepareInterconnection(
  blocks: readonly NetworkBlock[],
  connections: readonly NetworkConnection[],
  externalInput: NetworkPortReference,
  externalOutput: NetworkPortReference,
  referenceImpedanceOhm: number,
): {
  totalPorts: number
  inputIndex: number
  outputIndex: number
  internalIndices: number[]
  portIndex: Map<string, number>
} {
  if (blocks.length === 0) {
    throw new RangeError(
      'N-port interconnection requires at least one network block.',
    )
  }
  const frequencyHz = blocks[0]!.network.frequencyHz
  const portIndex = new Map<string, number>()
  let totalPorts = 0
  for (const block of blocks) {
    validateBlock(block, frequencyHz, referenceImpedanceOhm)
    for (let port = 0; port < block.portIds.length; port += 1) {
      const key = portKey({
        nodeId: block.nodeId,
        portId: block.portIds[port]!,
      })
      if (portIndex.has(key))
        throw new RangeError(`Duplicate network port ${key}.`)
      portIndex.set(key, totalPorts + port)
    }
    totalPorts += block.network.portCount
  }
  const inputIndex = requiredPortIndex(portIndex, externalInput)
  const outputIndex = requiredPortIndex(portIndex, externalOutput)
  if (inputIndex === outputIndex)
    throw new RangeError('External RF ports must be distinct.')
  const internalIndices: number[] = []
  const used = new Set<number>([inputIndex, outputIndex])
  for (const connection of connections) {
    const first = requiredPortIndex(portIndex, connection.first)
    const second = requiredPortIndex(portIndex, connection.second)
    if (first === second || used.has(first) || used.has(second)) {
      throw new RangeError(
        'Every interconnected RF port must be distinct and used once.',
      )
    }
    used.add(first)
    used.add(second)
    internalIndices.push(first, second)
  }
  if (used.size !== totalPorts) {
    throw new RangeError(
      'Every block port must be connected or selected as an external port.',
    )
  }
  return { totalPorts, inputIndex, outputIndex, internalIndices, portIndex }
}

function eliminateConnectedPorts(
  scattering: ComplexValue[],
  totalPorts: number,
  internalIndices: number[],
  externalIndices: number[],
): ComplexValue[] {
  if (internalIndices.length === 0) {
    return submatrix(scattering, totalPorts, externalIndices, externalIndices)
  }
  const internalCount = internalIndices.length
  const see = submatrix(
    scattering,
    totalPorts,
    externalIndices,
    externalIndices,
  )
  const sei = submatrix(
    scattering,
    totalPorts,
    externalIndices,
    internalIndices,
  )
  const sie = submatrix(
    scattering,
    totalPorts,
    internalIndices,
    externalIndices,
  )
  const sii = submatrix(
    scattering,
    totalPorts,
    internalIndices,
    internalIndices,
  )
  const permutation = connectionPermutation(internalCount)
  const permutedSii = multiplyRectangular(
    permutation,
    internalCount,
    internalCount,
    sii,
    internalCount,
  )
  const system = permutedSii.map((value, index) => ({
    re: (index % (internalCount + 1) === 0 ? 1 : 0) - value.re,
    im: -value.im,
  }))
  const inverse = invertComplexMatrix(system)
  const permutedSie = multiplyRectangular(
    permutation,
    internalCount,
    internalCount,
    sie,
    2,
  )
  const internalIncident = multiplyRectangular(
    inverse,
    internalCount,
    internalCount,
    permutedSie,
    2,
  )
  const correction = multiplyRectangular(
    sei,
    2,
    internalCount,
    internalIncident,
    2,
  )
  return see.map((value, index) => add(value, correction[index]!))
}

function compositeScatteringAt(
  blocks: readonly NetworkBlock[],
  totalPorts: number,
  pointIndex: number,
): ComplexValue[] {
  const result = Array.from({ length: totalPorts * totalPorts }, () => ({
    re: 0,
    im: 0,
  }))
  let offset = 0
  for (const block of blocks) {
    const portCount = block.network.portCount
    for (let row = 0; row < portCount; row += 1) {
      for (let column = 0; column < portCount; column += 1) {
        const value = block.network.s[row * portCount + column]!
        result[(offset + row) * totalPorts + offset + column] = {
          re: value.re[pointIndex]!,
          im: value.im[pointIndex]!,
        }
      }
    }
    offset += portCount
  }
  return result
}

function compositeNoiseCorrelationAt(
  blocks: readonly NetworkBlock[],
  totalPorts: number,
  pointIndex: number,
): ComplexValue[] | null {
  const result = Array.from({ length: totalPorts * totalPorts }, () => ({
    re: 0,
    im: 0,
  }))
  let offset = 0
  for (const block of blocks) {
    const correlation = block.noiseCorrelationAt?.(pointIndex)
    if (!correlation) return null
    const portCount = block.network.portCount
    if (correlation.length !== portCount * portCount) {
      throw new RangeError(
        `Noise correlation at "${block.nodeId}" has invalid dimensions.`,
      )
    }
    for (let row = 0; row < portCount; row += 1) {
      for (let column = 0; column < portCount; column += 1) {
        result[(offset + row) * totalPorts + offset + column] = {
          ...correlation[row * portCount + column]!,
        }
      }
    }
    offset += portCount
  }
  return result
}

function externalNoiseTransfer(
  scattering: ComplexValue[],
  totalPorts: number,
  internalIndices: number[],
  externalIndices: number[],
): ComplexValue[] {
  const transfer = Array.from({ length: 2 * totalPorts }, () => ({
    re: 0,
    im: 0,
  }))
  transfer[externalIndices[0]!] = { re: 1, im: 0 }
  transfer[totalPorts + externalIndices[1]!] = { re: 1, im: 0 }
  if (internalIndices.length === 0) return transfer

  const internalCount = internalIndices.length
  const sei = submatrix(
    scattering,
    totalPorts,
    externalIndices,
    internalIndices,
  )
  const sii = submatrix(
    scattering,
    totalPorts,
    internalIndices,
    internalIndices,
  )
  const permutation = connectionPermutation(internalCount)
  const permutedSii = multiplyRectangular(
    permutation,
    internalCount,
    internalCount,
    sii,
    internalCount,
  )
  const system = permutedSii.map((value, index) => ({
    re: (index % (internalCount + 1) === 0 ? 1 : 0) - value.re,
    im: -value.im,
  }))
  const inverse = invertComplexMatrix(system)
  const inversePermutation = multiplyRectangular(
    inverse,
    internalCount,
    internalCount,
    permutation,
    internalCount,
  )
  const internalTransfer = multiplyRectangular(
    sei,
    2,
    internalCount,
    inversePermutation,
    internalCount,
  )
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < internalCount; column += 1) {
      transfer[row * totalPorts + internalIndices[column]!] =
        internalTransfer[row * internalCount + column]!
    }
  }
  return transfer
}

function submatrix(
  matrix: ComplexValue[],
  sourceColumns: number,
  rows: number[],
  columns: number[],
): ComplexValue[] {
  return rows.flatMap((row) =>
    columns.map((column) => ({ ...matrix[row * sourceColumns + column]! })),
  )
}

function connectionPermutation(internalCount: number): ComplexValue[] {
  return Array.from({ length: internalCount * internalCount }, (_, index) => {
    const row = Math.floor(index / internalCount)
    const column = index % internalCount
    return {
      re: column === (row % 2 === 0 ? row + 1 : row - 1) ? 1 : 0,
      im: 0,
    }
  })
}

function multiplyRectangular(
  left: ComplexValue[],
  leftRows: number,
  innerSize: number,
  right: ComplexValue[],
  rightColumns: number,
): ComplexValue[] {
  if (
    left.length !== leftRows * innerSize ||
    right.length !== innerSize * rightColumns
  ) {
    throw new RangeError('Matrix dimensions do not match.')
  }
  const result = Array.from({ length: leftRows * rightColumns }, () => ({
    re: 0,
    im: 0,
  }))
  for (let row = 0; row < leftRows; row += 1) {
    for (let column = 0; column < rightColumns; column += 1) {
      let value = { re: 0, im: 0 }
      for (let inner = 0; inner < innerSize; inner += 1) {
        value = add(
          value,
          multiply(
            left[row * innerSize + inner]!,
            right[inner * rightColumns + column]!,
          ),
        )
      }
      result[row * rightColumns + column] = value
    }
  }
  return result
}

function validateBlock(
  block: NetworkBlock,
  frequencyHz: Float64Array,
  referenceImpedanceOhm: number,
): void {
  if (
    block.network.portCount !== block.portIds.length ||
    block.network.frequencyHz.length !== frequencyHz.length
  ) {
    throw new RangeError(
      `Network block "${block.nodeId}" has inconsistent dimensions.`,
    )
  }
  for (let index = 0; index < frequencyHz.length; index += 1) {
    if (block.network.frequencyHz[index] !== frequencyHz[index]) {
      throw new RangeError(
        'Every interconnected block must use the same frequency grid.',
      )
    }
  }
  for (const reference of block.network.referenceImpedancesOhm) {
    if (
      Math.abs(reference - referenceImpedanceOhm) >
      Math.max(1, reference, referenceImpedanceOhm) * 1e-12
    ) {
      throw new RangeError(
        'Every interconnected port must use the analysis reference impedance.',
      )
    }
  }
}

function requiredPortIndex(
  portIndex: Map<string, number>,
  reference: NetworkPortReference,
): number {
  const index = portIndex.get(portKey(reference))
  if (index === undefined) {
    throw new RangeError(`Unknown network port ${portKey(reference)}.`)
  }
  return index
}

function portKey(reference: NetworkPortReference): string {
  return `${reference.nodeId}:${reference.portId}`
}

function createComplexArray(length: number): ComplexArray {
  return { re: new Float64Array(length), im: new Float64Array(length) }
}

function writeValue(
  destination: ComplexArray,
  index: number,
  value: ComplexValue,
): void {
  destination.re[index] = value.re
  destination.im[index] = value.im
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
