import {
  admittanceToScattering,
  createNPortS,
  impedanceToScattering,
  nPortToTwoPort,
  type ComplexValue,
} from './nport'
import type { ComplexArray, NPortNetwork, TwoPortNetwork } from './types'

export type TouchstoneDataFormat = 'RI' | 'MA' | 'DB'
export type TouchstoneFrequencyUnit = 'HZ' | 'KHZ' | 'MHZ' | 'GHZ'
export type TouchstoneParameterType = 'S' | 'Y' | 'Z' | 'H' | 'G'
export type TouchstoneMatrixFormat = 'FULL' | 'LOWER' | 'UPPER'

export interface TouchstoneNoiseData {
  frequencyHz: Float64Array
  minimumNoiseFigureDb: Float64Array
  optimumSourceReflection: ComplexArray
  effectiveNoiseResistanceOhm: Float64Array
}

export interface ParsedTouchstoneNPort extends NPortNetwork {
  version: '1.0' | '2.0'
  format: TouchstoneDataFormat
  frequencyUnit: TouchstoneFrequencyUnit
  originalParameterType: TouchstoneParameterType
  matrixFormat: TouchstoneMatrixFormat
  mixedModeOrder?: string[]
  noise?: TouchstoneNoiseData
}

export interface ParsedTouchstone extends TwoPortNetwork {
  version: '1.0' | '2.0'
  format: TouchstoneDataFormat
  frequencyUnit: TouchstoneFrequencyUnit
  originalParameterType: TouchstoneParameterType
  noise?: TouchstoneNoiseData
}

interface NumericToken {
  value: number
  lineNumber: number
}

interface ParsedOptionLine {
  frequencyUnit: TouchstoneFrequencyUnit
  format: TouchstoneDataFormat
  parameterType: TouchstoneParameterType
  referenceImpedanceOhm: number
}

const UNIT_SCALE: Record<TouchstoneFrequencyUnit, number> = {
  HZ: 1,
  KHZ: 1e3,
  MHZ: 1e6,
  GHZ: 1e9,
}

export class TouchstoneParseError extends Error {
  readonly lineNumber: number | undefined

  constructor(message: string, lineNumber?: number) {
    super(lineNumber ? `${message} (line ${lineNumber})` : message)
    this.name = 'TouchstoneParseError'
    this.lineNumber = lineNumber
  }
}

export function parseTouchstone(
  text: string,
  sourceName?: string,
  expectedPortCount?: number,
): ParsedTouchstoneNPort {
  const extensionPortCount = portCountFromName(sourceName)
  if (
    expectedPortCount !== undefined &&
    extensionPortCount !== undefined &&
    expectedPortCount !== extensionPortCount
  ) {
    throw new TouchstoneParseError(
      `Expected ${expectedPortCount} ports but filename declares ${extensionPortCount}.`,
    )
  }

  let option: ParsedOptionLine = {
    frequencyUnit: 'GHZ',
    format: 'MA',
    parameterType: 'S',
    referenceImpedanceOhm: 50,
  }
  let optionLineSeen = false
  let version: '1.0' | '2.0' = '1.0'
  let section: 'metadata' | 'network' | 'noise' | 'ended' = 'metadata'
  let informationBlock = false
  let lastMetadataKeyword: string | null = null
  const metadata = new Map<string, { values: string[]; lineNumber: number }>()
  const networkLines: NumericToken[][] = []
  const noiseLines: NumericToken[][] = []

  for (const [lineIndex, rawLine] of text.split(/\r?\n/u).entries()) {
    const lineNumber = lineIndex + 1
    const line = rawLine.split('!', 1)[0]?.trim() ?? ''
    if (!line) continue

    if (line.startsWith('[')) {
      const match = /^\[([^\]]+)\]\s*(.*)$/u.exec(line)
      if (!match)
        throw new TouchstoneParseError('Malformed keyword.', lineNumber)
      const keyword = match[1]!.trim().toUpperCase()
      const values = splitValues(match[2]!)
      if (section === 'ended') {
        throw new TouchstoneParseError(
          'Content appears after [End].',
          lineNumber,
        )
      }
      if (keyword === 'BEGIN INFORMATION') {
        informationBlock = true
        lastMetadataKeyword = null
        continue
      }
      if (keyword === 'END INFORMATION') {
        informationBlock = false
        continue
      }
      if (informationBlock) continue
      if (keyword === 'NETWORK DATA') {
        section = 'network'
        lastMetadataKeyword = null
        continue
      }
      if (keyword === 'NOISE DATA') {
        section = 'noise'
        lastMetadataKeyword = null
        continue
      }
      if (keyword === 'END') {
        section = 'ended'
        lastMetadataKeyword = null
        continue
      }
      if (section !== 'metadata') {
        throw new TouchstoneParseError(
          `Keyword [${match[1]}] is not valid inside data.`,
          lineNumber,
        )
      }
      if (!SUPPORTED_KEYWORDS.has(keyword)) {
        throw new TouchstoneParseError(
          `Unsupported keyword [${match[1]}].`,
          lineNumber,
        )
      }
      if (metadata.has(keyword)) {
        throw new TouchstoneParseError(
          `Keyword [${match[1]}] is duplicated.`,
          lineNumber,
        )
      }
      metadata.set(keyword, { values, lineNumber })
      lastMetadataKeyword = MULTILINE_KEYWORDS.has(keyword) ? keyword : null
      if (keyword === 'VERSION') version = parseVersion(values, lineNumber)
      continue
    }

    if (line.startsWith('#')) {
      if (optionLineSeen) {
        throw new TouchstoneParseError(
          'Only one option line is supported.',
          lineNumber,
        )
      }
      option = parseOptionLine(line, lineNumber)
      optionLineSeen = true
      continue
    }

    if (informationBlock) continue
    if (section === 'ended') {
      throw new TouchstoneParseError('Content appears after [End].', lineNumber)
    }
    if (section === 'metadata') {
      if (!lastMetadataKeyword) {
        if (version === '2.0') {
          throw new TouchstoneParseError(
            'Data appears before [Network Data].',
            lineNumber,
          )
        }
        networkLines.push(parseNumericLine(line, lineNumber))
      } else {
        metadata.get(lastMetadataKeyword)!.values.push(...splitValues(line))
      }
      continue
    }
    const destination = section === 'network' ? networkLines : noiseLines
    destination.push(parseNumericLine(line, lineNumber))
  }

  const portCount = parsePortCount(
    metadata,
    version,
    expectedPortCount ?? extensionPortCount,
  )
  const matrixFormat = parseMatrixFormat(metadata, version)
  const twoPortOrder = parseTwoPortOrder(
    metadata,
    version,
    portCount,
    matrixFormat,
  )
  const numberOfFrequencies = parseRequiredCount(
    metadata,
    'NUMBER OF FREQUENCIES',
    version,
  )
  const numberOfNoiseFrequencies = parseOptionalCount(
    metadata,
    'NUMBER OF NOISE FREQUENCIES',
  )
  const references = parseReferences(metadata, option, portCount)
  const mixedModeOrder = parseMixedModeOrder(metadata, portCount)

  const separated =
    version === '1.0' && portCount === 2 && noiseLines.length === 0
      ? separateVersion1Noise(networkLines, matrixFormat)
      : { networkLines, noiseLines }
  const networkTokens = separated.networkLines.flat()
  const positions = matrixPositions(portCount, matrixFormat, twoPortOrder)
  const valuesPerPoint = 1 + positions.length * 2
  if (networkTokens.length === 0) {
    throw new TouchstoneParseError('The file contains no network data.')
  }
  if (networkTokens.length % valuesPerPoint !== 0) {
    throw new TouchstoneParseError(
      `Incomplete ${portCount}-port record: expected groups of ${valuesPerPoint} numeric values.`,
      networkTokens.at(-1)?.lineNumber,
    )
  }
  const pointCount = networkTokens.length / valuesPerPoint
  if (numberOfFrequencies !== undefined && pointCount !== numberOfFrequencies) {
    throw new TouchstoneParseError(
      `[Number of Frequencies] declares ${numberOfFrequencies}, but ${pointCount} records were found.`,
    )
  }

  const frequencyHz = new Float64Array(pointCount)
  const s = createNPortS(portCount, pointCount)
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const offset = pointIndex * valuesPerPoint
    const frequencyToken = requiredToken(networkTokens, offset)
    const frequency = frequencyToken.value * UNIT_SCALE[option.frequencyUnit]
    if (
      frequency < 0 ||
      (pointIndex > 0 && frequency <= frequencyHz[pointIndex - 1]!)
    ) {
      throw new TouchstoneParseError(
        'Frequencies must be non-negative and strictly increasing.',
        frequencyToken.lineNumber,
      )
    }
    frequencyHz[pointIndex] = frequency
    const rawMatrix = Array.from({ length: portCount * portCount }, () => ({
      re: 0,
      im: 0,
    }))
    for (let valueIndex = 0; valueIndex < positions.length; valueIndex += 1) {
      const [row, column] = positions[valueIndex]!
      const value = pairToComplex(
        option.format,
        requiredToken(networkTokens, offset + 1 + valueIndex * 2).value,
        requiredToken(networkTokens, offset + 2 + valueIndex * 2).value,
      )
      rawMatrix[row * portCount + column] = value
      if (matrixFormat !== 'FULL' && row !== column) {
        rawMatrix[column * portCount + row] = { ...value }
      }
    }
    const scattering = parameterMatrixToScattering(
      rawMatrix,
      option.parameterType,
      references,
    )
    writeScattering(s, pointIndex, scattering)
  }

  const noise = parseNoise(
    separated.noiseLines,
    numberOfNoiseFrequencies,
    version,
    option,
    portCount,
    frequencyHz.at(-1)!,
  )
  if (version === '2.0') validateVersion2Structure(metadata, portCount, noise)

  return {
    frequencyHz,
    portCount,
    referenceImpedancesOhm: references,
    s,
    portLabels:
      mixedModeOrder ??
      Array.from({ length: portCount }, (_, i) => `Port ${i + 1}`),
    ...(sourceName ? { sourceName } : {}),
    version,
    format: option.format,
    frequencyUnit: option.frequencyUnit,
    originalParameterType: option.parameterType,
    matrixFormat,
    ...(mixedModeOrder ? { mixedModeOrder } : {}),
    ...(noise ? { noise } : {}),
  }
}

export function parseTouchstoneS2P(
  text: string,
  sourceName?: string,
): ParsedTouchstone {
  const parsed = parseTouchstone(text, sourceName, 2)
  const network = nPortToTwoPort(parsed)
  return {
    ...network,
    version: parsed.version,
    format: parsed.format,
    frequencyUnit: parsed.frequencyUnit,
    originalParameterType: parsed.originalParameterType,
    ...(parsed.noise ? { noise: parsed.noise } : {}),
  }
}

const SUPPORTED_KEYWORDS = new Set([
  'VERSION',
  'NUMBER OF PORTS',
  'TWO-PORT DATA ORDER',
  'TWO-PORT ORDER',
  'NUMBER OF FREQUENCIES',
  'NUMBER OF NOISE FREQUENCIES',
  'REFERENCE',
  'MATRIX FORMAT',
  'MIXED-MODE ORDER',
])
const MULTILINE_KEYWORDS = new Set(['REFERENCE', 'MIXED-MODE ORDER'])

function parseVersion(values: string[], lineNumber: number): '2.0' {
  if (values.length !== 1 || values[0] !== '2.0') {
    throw new TouchstoneParseError(
      'Only Touchstone version 2.0 is supported.',
      lineNumber,
    )
  }
  return '2.0'
}

function parsePortCount(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  version: '1.0' | '2.0',
  inferred: number | undefined,
): number {
  const item = metadata.get('NUMBER OF PORTS')
  if (version === '2.0' && !item) {
    throw new TouchstoneParseError('Touchstone 2.0 requires [Number of Ports].')
  }
  const value = item
    ? parsePositiveInteger(item.values, '[Number of Ports]', item.lineNumber)
    : inferred
  if (!value) {
    throw new TouchstoneParseError(
      'Port count is required; use an .sNp filename or [Number of Ports].',
    )
  }
  if (inferred !== undefined && inferred !== value) {
    throw new TouchstoneParseError(
      `Filename declares ${inferred} ports but file metadata declares ${value}.`,
    )
  }
  if (value > 64)
    throw new TouchstoneParseError(
      'Touchstone files are limited to 64 ports in the browser.',
    )
  return value
}

function parseMatrixFormat(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  version: '1.0' | '2.0',
): TouchstoneMatrixFormat {
  const item = metadata.get('MATRIX FORMAT')
  if (!item) return 'FULL'
  if (version === '1.0') {
    throw new TouchstoneParseError(
      '[Matrix Format] is only valid in Touchstone 2.0.',
      item.lineNumber,
    )
  }
  const value = item.values[0]?.toUpperCase()
  if (
    item.values.length !== 1 ||
    !['FULL', 'LOWER', 'UPPER'].includes(value ?? '')
  ) {
    throw new TouchstoneParseError(
      '[Matrix Format] must be Full, Lower, or Upper.',
      item.lineNumber,
    )
  }
  return value as TouchstoneMatrixFormat
}

function parseTwoPortOrder(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  version: '1.0' | '2.0',
  portCount: number,
  matrixFormat: TouchstoneMatrixFormat,
): '21_12' | '12_21' {
  const item =
    metadata.get('TWO-PORT DATA ORDER') ?? metadata.get('TWO-PORT ORDER')
  if (!item) {
    if (version === '2.0' && portCount === 2 && matrixFormat === 'FULL') {
      throw new TouchstoneParseError(
        'Touchstone 2.0 full two-port data require [Two-Port Data Order].',
      )
    }
    return '21_12'
  }
  if (version === '1.0' || portCount !== 2) {
    throw new TouchstoneParseError(
      '[Two-Port Data Order] is only valid for Touchstone 2.0 two-port data.',
      item.lineNumber,
    )
  }
  const value = item.values[0]?.toUpperCase()
  if (item.values.length !== 1 || (value !== '21_12' && value !== '12_21')) {
    throw new TouchstoneParseError(
      '[Two-Port Data Order] must be 21_12 or 12_21.',
      item.lineNumber,
    )
  }
  return value
}

function parseRequiredCount(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  keyword: string,
  version: '1.0' | '2.0',
): number | undefined {
  const item = metadata.get(keyword)
  if (version === '2.0' && !item)
    throw new TouchstoneParseError(
      `Touchstone 2.0 requires [${title(keyword)}].`,
    )
  return item
    ? parsePositiveInteger(item.values, `[${title(keyword)}]`, item.lineNumber)
    : undefined
}

function parseOptionalCount(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  keyword: string,
): number | undefined {
  const item = metadata.get(keyword)
  return item
    ? parsePositiveInteger(item.values, `[${title(keyword)}]`, item.lineNumber)
    : undefined
}

function parseReferences(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  option: ParsedOptionLine,
  portCount: number,
): Float64Array {
  const item = metadata.get('REFERENCE')
  if (!item || option.parameterType !== 'S') {
    return new Float64Array(portCount).fill(option.referenceImpedanceOhm)
  }
  if (item.values.length !== portCount) {
    throw new TouchstoneParseError(
      `[Reference] requires ${portCount} positive real values.`,
      item.lineNumber,
    )
  }
  const values = item.values.map(Number)
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new TouchstoneParseError(
      '[Reference] values must be positive real impedances.',
      item.lineNumber,
    )
  }
  return new Float64Array(values)
}

function parseMixedModeOrder(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  portCount: number,
): string[] | undefined {
  const item = metadata.get('MIXED-MODE ORDER')
  if (!item) return undefined
  const values = item.values.map((value) => value.toUpperCase())
  if (
    values.length !== portCount ||
    values.some((value) => !/^(?:S\d+|[CD]\d+,\d+)$/u.test(value))
  ) {
    throw new TouchstoneParseError(
      `[Mixed-Mode Order] requires ${portCount} valid S, C, or D descriptors.`,
      item.lineNumber,
    )
  }
  return values
}

function validateVersion2Structure(
  metadata: Map<string, { values: string[]; lineNumber: number }>,
  portCount: number,
  noise: TouchstoneNoiseData | undefined,
): void {
  if (!metadata.has('VERSION'))
    throw new TouchstoneParseError('Touchstone 2.0 requires [Version] 2.0.')
  const declaredNoise = metadata.has('NUMBER OF NOISE FREQUENCIES')
  if (declaredNoise !== Boolean(noise)) {
    throw new TouchstoneParseError(
      '[Number of Noise Frequencies] and [Noise Data] must either both be present or both be absent.',
    )
  }
  if (noise && portCount !== 2) {
    throw new TouchstoneParseError(
      'Noise parameters are only valid for two-port files.',
    )
  }
}

function matrixPositions(
  portCount: number,
  matrixFormat: TouchstoneMatrixFormat,
  twoPortOrder: '21_12' | '12_21',
): Array<[number, number]> {
  if (matrixFormat === 'FULL' && portCount === 2) {
    return twoPortOrder === '21_12'
      ? [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]
      : [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ]
  }
  const positions: Array<[number, number]> = []
  for (let row = 0; row < portCount; row += 1) {
    for (let column = 0; column < portCount; column += 1) {
      if (
        matrixFormat === 'FULL' ||
        (matrixFormat === 'LOWER' && column <= row) ||
        (matrixFormat === 'UPPER' && column >= row)
      ) {
        positions.push([row, column])
      }
    }
  }
  return positions
}

function parameterMatrixToScattering(
  matrix: ComplexValue[],
  parameterType: TouchstoneParameterType,
  references: Float64Array,
): ComplexValue[] {
  if (parameterType === 'S') return matrix
  if (parameterType === 'Z') return impedanceToScattering(matrix, references)
  if (parameterType === 'Y') return admittanceToScattering(matrix, references)
  if (references.length !== 2)
    throw new TouchstoneParseError(
      `${parameterType}-parameters require two ports.`,
    )
  return impedanceToScattering(
    hybridToImpedance(matrix, parameterType),
    references,
  )
}

function hybridToImpedance(
  matrix: ComplexValue[],
  parameterType: 'H' | 'G',
): ComplexValue[] {
  const [x11, x12, x21, x22] = matrix
  if (!x11 || !x12 || !x21 || !x22)
    throw new TouchstoneParseError('Hybrid matrix must be 2×2.')
  if (parameterType === 'H') {
    return [
      subtractComplex(x11, divideComplex(multiplyComplex(x12, x21), x22)),
      divideComplex(x12, x22),
      scaleComplex(divideComplex(x21, x22), -1),
      divideComplex({ re: 1, im: 0 }, x22),
    ]
  }
  return [
    divideComplex({ re: 1, im: 0 }, x11),
    scaleComplex(divideComplex(x12, x11), -1),
    divideComplex(x21, x11),
    subtractComplex(x22, divideComplex(multiplyComplex(x21, x12), x11)),
  ]
}

function parseNoise(
  lines: NumericToken[][],
  declaredCount: number | undefined,
  version: '1.0' | '2.0',
  option: ParsedOptionLine,
  portCount: number,
  highestNetworkFrequencyHz: number,
): TouchstoneNoiseData | undefined {
  if (lines.length === 0) return undefined
  if (portCount !== 2)
    throw new TouchstoneParseError(
      'Noise parameters are only valid for two-port files.',
    )
  if (lines.some((line) => line.length !== 5)) {
    throw new TouchstoneParseError(
      'Every noise record must contain five numeric values.',
    )
  }
  if (declaredCount !== undefined && declaredCount !== lines.length) {
    throw new TouchstoneParseError(
      `[Number of Noise Frequencies] declares ${declaredCount}, but ${lines.length} records were found.`,
    )
  }
  const frequencyHz = new Float64Array(lines.length)
  const minimumNoiseFigureDb = new Float64Array(lines.length)
  const optimumSourceReflection = createComplexArray(lines.length)
  const effectiveNoiseResistanceOhm = new Float64Array(lines.length)
  for (let index = 0; index < lines.length; index += 1) {
    const [frequency, minimumNoiseFigure, magnitude, phase, resistance] =
      lines[index]!
    const frequencyValue = frequency!.value * UNIT_SCALE[option.frequencyUnit]
    if (
      frequencyValue < 0 ||
      (index > 0 && frequencyValue <= frequencyHz[index - 1]!) ||
      (index === 0 && frequencyValue > highestNetworkFrequencyHz)
    ) {
      throw new TouchstoneParseError(
        'Noise frequencies are invalid or not strictly increasing.',
        frequency!.lineNumber,
      )
    }
    if (
      minimumNoiseFigure!.value < 0 ||
      magnitude!.value < 0 ||
      magnitude!.value > 1 ||
      resistance!.value < 0
    ) {
      throw new TouchstoneParseError(
        'Noise parameters are outside their physical range.',
        frequency!.lineNumber,
      )
    }
    frequencyHz[index] = frequencyValue
    minimumNoiseFigureDb[index] = minimumNoiseFigure!.value
    const gamma = pairToComplex('MA', magnitude!.value, phase!.value)
    optimumSourceReflection.re[index] = gamma.re
    optimumSourceReflection.im[index] = gamma.im
    effectiveNoiseResistanceOhm[index] =
      resistance!.value * (version === '1.0' ? option.referenceImpedanceOhm : 1)
  }
  return {
    frequencyHz,
    minimumNoiseFigureDb,
    optimumSourceReflection,
    effectiveNoiseResistanceOhm,
  }
}

function separateVersion1Noise(
  lines: NumericToken[][],
  matrixFormat: TouchstoneMatrixFormat,
): { networkLines: NumericToken[][]; noiseLines: NumericToken[][] } {
  if (matrixFormat !== 'FULL') return { networkLines: lines, noiseLines: [] }
  for (let split = 1; split < lines.length; split += 1) {
    const network = lines.slice(0, split).flat()
    const noise = lines.slice(split)
    if (
      network.length % 9 === 0 &&
      noise.every((line) => line.length === 5) &&
      noise[0]![0]!.value <= network[network.length - 9]!.value
    ) {
      return { networkLines: lines.slice(0, split), noiseLines: noise }
    }
  }
  return { networkLines: lines, noiseLines: [] }
}

function parseOptionLine(line: string, lineNumber: number): ParsedOptionLine {
  let frequencyUnit: TouchstoneFrequencyUnit = 'GHZ'
  let format: TouchstoneDataFormat = 'MA'
  let parameterType: TouchstoneParameterType = 'S'
  let referenceImpedanceOhm = 50
  const tokens = line
    .slice(1)
    .trim()
    .toUpperCase()
    .split(/\s+/u)
    .filter(Boolean)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token in UNIT_SCALE) frequencyUnit = token as TouchstoneFrequencyUnit
    else if (['S', 'Y', 'Z', 'H', 'G'].includes(token))
      parameterType = token as TouchstoneParameterType
    else if (token === 'RI' || token === 'MA' || token === 'DB') format = token
    else if (token === 'R') {
      const resistance = Number(tokens[index + 1])
      if (!Number.isFinite(resistance) || resistance <= 0) {
        throw new TouchstoneParseError(
          'Reference resistance must be a positive number.',
          lineNumber,
        )
      }
      referenceImpedanceOhm = resistance
      index += 1
    } else {
      throw new TouchstoneParseError(
        `Unsupported option "${token}".`,
        lineNumber,
      )
    }
  }
  return { frequencyUnit, format, parameterType, referenceImpedanceOhm }
}

function parseNumericLine(line: string, lineNumber: number): NumericToken[] {
  return line.split(/\s+/u).map((token) => {
    const value = Number(token.replace(/[dD]/u, 'E'))
    if (!Number.isFinite(value)) {
      throw new TouchstoneParseError(
        `Invalid numeric value "${token}".`,
        lineNumber,
      )
    }
    return { value, lineNumber }
  })
}

function pairToComplex(
  format: TouchstoneDataFormat,
  first: number,
  second: number,
): ComplexValue {
  if (format === 'RI') return { re: first, im: second }
  const magnitude = format === 'DB' ? 10 ** (first / 20) : first
  const angleRadians = (second * Math.PI) / 180
  return {
    re: magnitude * Math.cos(angleRadians),
    im: magnitude * Math.sin(angleRadians),
  }
}

function writeScattering(
  destination: ComplexArray[],
  pointIndex: number,
  values: ComplexValue[],
): void {
  for (let index = 0; index < values.length; index += 1) {
    destination[index]!.re[pointIndex] = values[index]!.re
    destination[index]!.im[pointIndex] = values[index]!.im
  }
}

function parsePositiveInteger(
  values: string[],
  label: string,
  lineNumber: number,
): number {
  const value = Number(values[0])
  if (values.length !== 1 || !Number.isInteger(value) || value <= 0) {
    throw new TouchstoneParseError(
      `${label} must be one positive integer.`,
      lineNumber,
    )
  }
  return value
}

function splitValues(value: string): string[] {
  return value.trim() ? value.trim().split(/\s+/u) : []
}

function portCountFromName(sourceName: string | undefined): number | undefined {
  const match = sourceName ? /\.s(\d+)p$/iu.exec(sourceName.trim()) : null
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function requiredToken(tokens: NumericToken[], index: number): NumericToken {
  const token = tokens[index]
  if (!token) throw new TouchstoneParseError('Unexpected end of file.')
  return token
}

function createComplexArray(length: number): ComplexArray {
  return { re: new Float64Array(length), im: new Float64Array(length) }
}

function multiplyComplex(
  left: ComplexValue,
  right: ComplexValue,
): ComplexValue {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re,
  }
}

function divideComplex(
  numerator: ComplexValue,
  denominator: ComplexValue,
): ComplexValue {
  const scale =
    denominator.re * denominator.re + denominator.im * denominator.im
  if (scale < 1e-28)
    throw new TouchstoneParseError('Hybrid parameter conversion is singular.')
  return {
    re: (numerator.re * denominator.re + numerator.im * denominator.im) / scale,
    im: (numerator.im * denominator.re - numerator.re * denominator.im) / scale,
  }
}

function subtractComplex(
  left: ComplexValue,
  right: ComplexValue,
): ComplexValue {
  return { re: left.re - right.re, im: left.im - right.im }
}

function scaleComplex(value: ComplexValue, scale: number): ComplexValue {
  return { re: value.re * scale, im: value.im * scale }
}

function title(value: string): string {
  return value
    .toLowerCase()
    .replace(/(?:^|\s)\S/gu, (character) => character.toUpperCase())
}
