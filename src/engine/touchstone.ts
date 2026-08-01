import type { ComplexArray, TwoPortNetwork } from './types'

export type TouchstoneDataFormat = 'RI' | 'MA' | 'DB'
export type TouchstoneFrequencyUnit = 'HZ' | 'KHZ' | 'MHZ' | 'GHZ'

export interface ParsedTouchstone extends TwoPortNetwork {
  format: TouchstoneDataFormat
  frequencyUnit: TouchstoneFrequencyUnit
}

interface NumericToken {
  value: number
  lineNumber: number
}

const UNIT_SCALE: Record<TouchstoneFrequencyUnit, number> = {
  HZ: 1,
  KHZ: 1e3,
  MHZ: 1e6,
  GHZ: 1e9,
}

const DATA_VALUES_PER_POINT = 9

export class TouchstoneParseError extends Error {
  readonly lineNumber: number | undefined

  constructor(message: string, lineNumber?: number) {
    super(lineNumber ? `${message} (line ${lineNumber})` : message)
    this.name = 'TouchstoneParseError'
    this.lineNumber = lineNumber
  }
}

export function parseTouchstoneS2P(
  text: string,
  sourceName?: string,
): ParsedTouchstone {
  let frequencyUnit: TouchstoneFrequencyUnit = 'GHZ'
  let format: TouchstoneDataFormat = 'MA'
  let referenceImpedanceOhm = 50
  let optionLineSeen = false
  const numericTokens: NumericToken[] = []

  for (const [lineIndex, rawLine] of text.split(/\r?\n/u).entries()) {
    const lineNumber = lineIndex + 1
    const line = rawLine.split('!', 1)[0]?.trim() ?? ''
    if (!line) continue

    if (line.startsWith('[')) {
      throw new TouchstoneParseError(
        'Touchstone 2.0 keywords are not supported.',
        lineNumber,
      )
    }

    if (line.startsWith('#')) {
      if (optionLineSeen) {
        throw new TouchstoneParseError(
          'Only one option line is supported.',
          lineNumber,
        )
      }
      ;({ frequencyUnit, format, referenceImpedanceOhm } = parseOptionLine(
        line,
        lineNumber,
      ))
      optionLineSeen = true
      continue
    }

    for (const token of line.split(/\s+/u)) {
      const value = Number(token.replace(/[dD]/u, 'E'))
      if (!Number.isFinite(value)) {
        throw new TouchstoneParseError(
          `Invalid numeric value "${token}".`,
          lineNumber,
        )
      }
      numericTokens.push({ value, lineNumber })
    }
  }

  if (numericTokens.length === 0) {
    throw new TouchstoneParseError('The file contains no network data.')
  }
  if (numericTokens.length % DATA_VALUES_PER_POINT !== 0) {
    const lastToken = numericTokens.at(-1)
    throw new TouchstoneParseError(
      `Incomplete two-port record: expected groups of ${DATA_VALUES_PER_POINT} numeric values.`,
      lastToken?.lineNumber,
    )
  }

  const pointCount = numericTokens.length / DATA_VALUES_PER_POINT
  const frequencyHz = new Float64Array(pointCount)
  const s11 = createComplexArray(pointCount)
  const s21 = createComplexArray(pointCount)
  const s12 = createComplexArray(pointCount)
  const s22 = createComplexArray(pointCount)

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const offset = pointIndex * DATA_VALUES_PER_POINT
    const frequencyToken = requiredToken(numericTokens, offset)
    const frequency = frequencyToken.value * UNIT_SCALE[frequencyUnit]
    if (pointIndex > 0 && frequency <= frequencyHz[pointIndex - 1]!) {
      throw new TouchstoneParseError(
        'Frequencies must be strictly increasing.',
        frequencyToken.lineNumber,
      )
    }
    frequencyHz[pointIndex] = frequency

    writePair(s11, pointIndex, format, numericTokens, offset + 1)
    writePair(s21, pointIndex, format, numericTokens, offset + 3)
    writePair(s12, pointIndex, format, numericTokens, offset + 5)
    writePair(s22, pointIndex, format, numericTokens, offset + 7)
  }

  return {
    frequencyHz,
    referenceImpedanceOhm,
    s11,
    s21,
    s12,
    s22,
    ...(sourceName ? { sourceName } : {}),
    format,
    frequencyUnit,
  }
}

function parseOptionLine(
  line: string,
  lineNumber: number,
): {
  frequencyUnit: TouchstoneFrequencyUnit
  format: TouchstoneDataFormat
  referenceImpedanceOhm: number
} {
  let frequencyUnit: TouchstoneFrequencyUnit = 'GHZ'
  let format: TouchstoneDataFormat = 'MA'
  let referenceImpedanceOhm = 50
  let parameterType = 'S'
  const tokens = line.slice(1).trim().toUpperCase().split(/\s+/u)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token && token in UNIT_SCALE) {
      frequencyUnit = token as TouchstoneFrequencyUnit
    } else if (token === 'S' || ['Y', 'Z', 'H', 'G'].includes(token ?? '')) {
      parameterType = token ?? ''
    } else if (token === 'RI' || token === 'MA' || token === 'DB') {
      format = token
    } else if (token === 'R') {
      const resistanceToken = tokens[index + 1]
      const resistance = Number(resistanceToken)
      if (!resistanceToken || !Number.isFinite(resistance) || resistance <= 0) {
        throw new TouchstoneParseError(
          'Reference resistance must be a positive number.',
          lineNumber,
        )
      }
      referenceImpedanceOhm = resistance
      index += 1
    } else if (token) {
      throw new TouchstoneParseError(
        `Unsupported option "${token}".`,
        lineNumber,
      )
    }
  }

  if (parameterType !== 'S') {
    throw new TouchstoneParseError(
      `Only S-parameters are supported; found ${parameterType}.`,
      lineNumber,
    )
  }

  return { frequencyUnit, format, referenceImpedanceOhm }
}

function createComplexArray(length: number): ComplexArray {
  return { re: new Float64Array(length), im: new Float64Array(length) }
}

function requiredToken(tokens: NumericToken[], index: number): NumericToken {
  const token = tokens[index]
  if (!token) throw new TouchstoneParseError('Unexpected end of file.')
  return token
}

function writePair(
  destination: ComplexArray,
  pointIndex: number,
  format: TouchstoneDataFormat,
  tokens: NumericToken[],
  offset: number,
): void {
  const first = requiredToken(tokens, offset).value
  const second = requiredToken(tokens, offset + 1).value

  if (format === 'RI') {
    destination.re[pointIndex] = first
    destination.im[pointIndex] = second
    return
  }

  const magnitude = format === 'DB' ? 10 ** (first / 20) : first
  const angleRadians = (second * Math.PI) / 180
  destination.re[pointIndex] = magnitude * Math.cos(angleRadians)
  destination.im[pointIndex] = magnitude * Math.sin(angleRadians)
}
