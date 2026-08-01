export type DeviceMetric =
  'gainDb' | 'noiseFigureDb' | 'outputP1Dbm' | 'outputIp3Dbm'

interface DevicePoint {
  frequencyHz: number
  value: number
}

interface DevicePowerCurve {
  frequencyHz: number
  inputPowerDbm: number[]
  outputPowerDbm: number[]
  outputPhaseDeg: Array<number | null>
}

export interface DevicePowerTransfer {
  lower: DevicePowerCurve
  upper: DevicePowerCurve
  frequencyWeight: number
}

export interface DeviceTable {
  sourceName: string
  rowCount: number
  metrics: Record<DeviceMetric, DevicePoint[]>
  powerCurves: DevicePowerCurve[]
}

export function deviceTableOverridesParameter(
  table: DeviceTable,
  parameter: string,
): boolean {
  switch (parameter) {
    case 'gainDb':
      return table.metrics.gainDb.length > 0 || table.powerCurves.length > 0
    case 'noiseFigureDb':
      return table.metrics.noiseFigureDb.length > 0
    case 'outputP1Dbm':
      return (
        table.metrics.outputP1Dbm.length > 0 || table.powerCurves.length > 0
      )
    case 'outputIp3Dbm':
      return table.metrics.outputIp3Dbm.length > 0
    default:
      return false
  }
}

export const MAX_DEVICE_TABLE_CHARACTERS = 2 * 1024 * 1024
const MAX_ROWS = 50_000

const HEADER_ALIASES: Record<string, { key: string; scale?: number }> = {
  frequencyhz: { key: 'frequencyHz', scale: 1 },
  freqhz: { key: 'frequencyHz', scale: 1 },
  frequencymhz: { key: 'frequencyHz', scale: 1e6 },
  freqmhz: { key: 'frequencyHz', scale: 1e6 },
  frequencyghz: { key: 'frequencyHz', scale: 1e9 },
  freqghz: { key: 'frequencyHz', scale: 1e9 },
  gaindb: { key: 'gainDb' },
  s21db: { key: 'gainDb' },
  noisefiguredb: { key: 'noiseFigureDb' },
  nfdb: { key: 'noiseFigureDb' },
  outputp1dbm: { key: 'outputP1Dbm' },
  op1dbm: { key: 'outputP1Dbm' },
  p1dbm: { key: 'outputP1Dbm' },
  outputip3dbm: { key: 'outputIp3Dbm' },
  oip3dbm: { key: 'outputIp3Dbm' },
  ip3dbm: { key: 'outputIp3Dbm' },
  inputpowerdbm: { key: 'inputPowerDbm' },
  pindbm: { key: 'inputPowerDbm' },
  outputpowerdbm: { key: 'outputPowerDbm' },
  poutdbm: { key: 'outputPowerDbm' },
  outputphasedeg: { key: 'outputPhaseDeg' },
  ampmdeg: { key: 'outputPhaseDeg' },
}

export class DeviceTableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceTableError'
  }
}

export function parseDeviceTableCsv(
  content: string,
  sourceName = 'device table',
): DeviceTable {
  if (content.length > MAX_DEVICE_TABLE_CHARACTERS) {
    throw new DeviceTableError('Device table exceeds the 2 MiB limit.')
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
  if (lines.length < 2) {
    throw new DeviceTableError('Device table requires a header and data rows.')
  }
  if (lines.length - 1 > MAX_ROWS) {
    throw new DeviceTableError(`Device table exceeds ${MAX_ROWS} data rows.`)
  }

  const rawHeaders = splitCsvLine(lines[0]!)
  const columns = new Map<string, { index: number; scale: number }>()
  rawHeaders.forEach((header, index) => {
    const alias = HEADER_ALIASES[normalizeHeader(header)]
    if (!alias) return
    if (columns.has(alias.key)) {
      throw new DeviceTableError(`Duplicate column for "${alias.key}".`)
    }
    columns.set(alias.key, { index, scale: alias.scale ?? 1 })
  })
  if (!columns.has('frequencyHz')) {
    throw new DeviceTableError(
      'Device table requires frequency_hz, frequency_mhz, or frequency_ghz.',
    )
  }

  const metrics: DeviceTable['metrics'] = {
    gainDb: [],
    noiseFigureDb: [],
    outputP1Dbm: [],
    outputIp3Dbm: [],
  }
  const powerRows = new Map<
    number,
    Array<{
      inputPowerDbm: number
      outputPowerDbm: number
      outputPhaseDeg: number | null
    }>
  >()

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = splitCsvLine(lines[lineIndex]!)
    const frequencyHz = requiredNumber(
      values,
      columns,
      'frequencyHz',
      lineIndex,
    )
    if (frequencyHz <= 0) {
      throw new DeviceTableError(
        `Line ${lineIndex + 1}: frequency must be positive.`,
      )
    }

    let hasData = false
    for (const metric of Object.keys(metrics) as DeviceMetric[]) {
      const value = optionalNumber(values, columns, metric, lineIndex)
      if (value === null) continue
      if (metric === 'noiseFigureDb' && value < 0) {
        throw new DeviceTableError(
          `Line ${lineIndex + 1}: noise figure cannot be negative.`,
        )
      }
      metrics[metric].push({ frequencyHz, value })
      hasData = true
    }

    const inputPowerDbm = optionalNumber(
      values,
      columns,
      'inputPowerDbm',
      lineIndex,
    )
    const outputPowerDbm = optionalNumber(
      values,
      columns,
      'outputPowerDbm',
      lineIndex,
    )
    const outputPhaseDeg = optionalNumber(
      values,
      columns,
      'outputPhaseDeg',
      lineIndex,
    )
    if ((inputPowerDbm === null) !== (outputPowerDbm === null)) {
      throw new DeviceTableError(
        `Line ${lineIndex + 1}: input and output power must be supplied together.`,
      )
    }
    if (outputPhaseDeg !== null && inputPowerDbm === null) {
      throw new DeviceTableError(
        `Line ${lineIndex + 1}: output phase requires input and output power.`,
      )
    }
    if (inputPowerDbm !== null && outputPowerDbm !== null) {
      const curve = powerRows.get(frequencyHz) ?? []
      curve.push({ inputPowerDbm, outputPowerDbm, outputPhaseDeg })
      powerRows.set(frequencyHz, curve)
      hasData = true
    }
    if (!hasData) {
      throw new DeviceTableError(
        `Line ${lineIndex + 1}: no supported performance value was found.`,
      )
    }
  }

  for (const [metric, points] of Object.entries(metrics)) {
    points.sort((a, b) => a.frequencyHz - b.frequencyHz)
    assertUnique(
      points.map((point) => point.frequencyHz),
      `${metric} frequency`,
    )
  }
  const powerCurves = [...powerRows].map(([frequencyHz, rows]) => {
    if (rows.length < 2) {
      throw new DeviceTableError(
        `Power curve at ${frequencyHz} Hz requires at least two points.`,
      )
    }
    rows.sort((a, b) => a.inputPowerDbm - b.inputPowerDbm)
    assertUnique(
      rows.map((row) => row.inputPowerDbm),
      `input power at ${frequencyHz} Hz`,
    )
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index]!.outputPowerDbm < rows[index - 1]!.outputPowerDbm) {
        throw new DeviceTableError(
          `Power curve at ${frequencyHz} Hz must have nondecreasing output power.`,
        )
      }
    }
    return {
      frequencyHz,
      inputPowerDbm: rows.map((row) => row.inputPowerDbm),
      outputPowerDbm: rows.map((row) => row.outputPowerDbm),
      outputPhaseDeg: rows.map((row) => row.outputPhaseDeg),
    }
  })
  powerCurves.sort((a, b) => a.frequencyHz - b.frequencyHz)

  if (
    Object.values(metrics).every((points) => points.length === 0) &&
    powerCurves.length === 0
  ) {
    throw new DeviceTableError('Device table contains no supported data.')
  }
  return { sourceName, rowCount: lines.length - 1, metrics, powerCurves }
}

export function deviceMetricAt(
  table: DeviceTable,
  metric: DeviceMetric,
  frequencyHz: number,
): number | null {
  const explicit = table.metrics[metric]
  const points =
    explicit.length > 0
      ? explicit
      : metric === 'gainDb'
        ? table.powerCurves.map((curve) => ({
            frequencyHz: curve.frequencyHz,
            value: smallSignalGainDb(curve),
          }))
        : metric === 'outputP1Dbm'
          ? table.powerCurves.flatMap((curve) => {
              const value = outputP1Dbm(curve)
              return value === null
                ? []
                : [{ frequencyHz: curve.frequencyHz, value }]
            })
          : []
  if (points.length === 0) return null
  return interpolateFrequency(points, frequencyHz, metric, table.sourceName)
}

export function devicePowerTransferAt(
  table: DeviceTable,
  frequencyHz: number,
): DevicePowerTransfer | null {
  const curves = table.powerCurves
  if (curves.length === 0) return null
  const [lower, upper] = frequencyBracket(
    curves,
    frequencyHz,
    'power transfer',
    table.sourceName,
  )
  return {
    lower,
    upper,
    frequencyWeight:
      lower === upper
        ? 0
        : (frequencyHz - lower.frequencyHz) /
          (upper.frequencyHz - lower.frequencyHz),
  }
}

export function interpolateDeviceOutputPower(
  transfer: DevicePowerTransfer,
  inputPowerDbm: number,
): number | null {
  const lowerOutput = interpolatePowerCurve(transfer.lower, inputPowerDbm)
  const upperOutput = interpolatePowerCurve(transfer.upper, inputPowerDbm)
  if (lowerOutput === null || upperOutput === null) return null
  return lowerOutput + transfer.frequencyWeight * (upperOutput - lowerOutput)
}

export function interpolateDeviceOutputPhase(
  transfer: DevicePowerTransfer,
  inputPowerDbm: number,
): number | null {
  const lowerPhase = interpolatePhaseCurve(transfer.lower, inputPowerDbm)
  const upperPhase = interpolatePhaseCurve(transfer.upper, inputPowerDbm)
  if (lowerPhase == null || upperPhase == null) return null
  return lowerPhase + transfer.frequencyWeight * (upperPhase - lowerPhase)
}

export function deviceTableSummary(table: DeviceTable): string {
  const labels = [
    table.metrics.gainDb.length > 0 || table.powerCurves.length > 0
      ? 'gain'
      : '',
    table.metrics.noiseFigureDb.length > 0 ? 'NF' : '',
    table.metrics.outputP1Dbm.length > 0 || table.powerCurves.length > 0
      ? 'P1dB'
      : '',
    table.metrics.outputIp3Dbm.length > 0 ? 'OIP3' : '',
    table.powerCurves.length > 0 ? 'Pout(Pin)' : '',
    table.powerCurves.some((curve) =>
      curve.outputPhaseDeg.some((value) => value !== null),
    )
      ? 'AM/PM'
      : '',
  ].filter(Boolean)
  return `${table.rowCount} rows; ${labels.join(', ')}`
}

function interpolateFrequency(
  points: DevicePoint[],
  frequencyHz: number,
  label: string,
  sourceName: string,
): number {
  const [lower, upper] = frequencyBracket(
    points,
    frequencyHz,
    label,
    sourceName,
  )
  if (lower === upper) return lower.value
  const weight =
    (frequencyHz - lower.frequencyHz) / (upper.frequencyHz - lower.frequencyHz)
  return lower.value + weight * (upper.value - lower.value)
}

function frequencyBracket<T extends { frequencyHz: number }>(
  points: T[],
  frequencyHz: number,
  label: string,
  sourceName: string,
): [T, T] {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    throw new RangeError('Device evaluation frequency must be positive.')
  }
  const first = points[0]!
  const last = points.at(-1)!
  if (points.length === 1) {
    if (!nearlyEqual(frequencyHz, first.frequencyHz)) {
      throw new RangeError(
        `${sourceName}: ${label} is available only at ${first.frequencyHz} Hz.`,
      )
    }
    return [first, first]
  }
  if (frequencyHz < first.frequencyHz || frequencyHz > last.frequencyHz) {
    throw new RangeError(
      `${sourceName}: ${label} covers ${first.frequencyHz} to ${last.frequencyHz} Hz; extrapolation is disabled.`,
    )
  }
  const exact = points.find((point) =>
    nearlyEqual(point.frequencyHz, frequencyHz),
  )
  if (exact) return [exact, exact]
  const upperIndex = points.findIndex(
    (point) => point.frequencyHz > frequencyHz,
  )
  return [points[upperIndex - 1]!, points[upperIndex]!]
}

function interpolatePowerCurve(
  curve: DevicePowerCurve,
  inputPowerDbm: number,
): number | null {
  const inputs = curve.inputPowerDbm
  if (inputPowerDbm < inputs[0]! || inputPowerDbm > inputs.at(-1)!) return null
  const exactIndex = inputs.findIndex((value) =>
    nearlyEqual(value, inputPowerDbm),
  )
  if (exactIndex >= 0) return curve.outputPowerDbm[exactIndex]!
  const upperIndex = inputs.findIndex((value) => value > inputPowerDbm)
  const lowerInput = inputs[upperIndex - 1]!
  const weight =
    (inputPowerDbm - lowerInput) / (inputs[upperIndex]! - lowerInput)
  return (
    curve.outputPowerDbm[upperIndex - 1]! +
    weight *
      (curve.outputPowerDbm[upperIndex]! -
        curve.outputPowerDbm[upperIndex - 1]!)
  )
}

function interpolatePhaseCurve(
  curve: DevicePowerCurve,
  inputPowerDbm: number,
): number | null {
  const inputs = curve.inputPowerDbm
  if (inputPowerDbm < inputs[0]! || inputPowerDbm > inputs.at(-1)!) return null
  const exactIndex = inputs.findIndex((value) =>
    nearlyEqual(value, inputPowerDbm),
  )
  if (exactIndex >= 0) return curve.outputPhaseDeg[exactIndex] ?? null
  const upperIndex = inputs.findIndex((value) => value > inputPowerDbm)
  const lowerPhase = curve.outputPhaseDeg[upperIndex - 1]
  const upperPhase = curve.outputPhaseDeg[upperIndex]
  if (lowerPhase == null || upperPhase == null) return null
  const lowerInput = inputs[upperIndex - 1]!
  const weight =
    (inputPowerDbm - lowerInput) / (inputs[upperIndex]! - lowerInput)
  return lowerPhase + weight * (upperPhase - lowerPhase)
}

function smallSignalGainDb(curve: DevicePowerCurve): number {
  return Math.max(
    ...curve.outputPowerDbm.map(
      (outputPowerDbm, index) => outputPowerDbm - curve.inputPowerDbm[index]!,
    ),
  )
}

function outputP1Dbm(curve: DevicePowerCurve): number | null {
  const gainDb = smallSignalGainDb(curve)
  for (let index = 1; index < curve.inputPowerDbm.length; index += 1) {
    const previousCompression =
      gainDb -
      (curve.outputPowerDbm[index - 1]! - curve.inputPowerDbm[index - 1]!)
    const compression =
      gainDb - (curve.outputPowerDbm[index]! - curve.inputPowerDbm[index]!)
    if (previousCompression <= 1 && compression >= 1) {
      if (compression === previousCompression) {
        return curve.outputPowerDbm[index - 1]!
      }
      const weight =
        (1 - previousCompression) / (compression - previousCompression)
      const inputP1Dbm =
        curve.inputPowerDbm[index - 1]! +
        weight * (curve.inputPowerDbm[index]! - curve.inputPowerDbm[index - 1]!)
      return inputP1Dbm + gainDb - 1
    }
  }
  return null
}

function requiredNumber(
  values: string[],
  columns: Map<string, { index: number; scale: number }>,
  key: string,
  lineIndex: number,
): number {
  const value = optionalNumber(values, columns, key, lineIndex)
  if (value === null) {
    throw new DeviceTableError(`Line ${lineIndex + 1}: ${key} is required.`)
  }
  return value
}

function optionalNumber(
  values: string[],
  columns: Map<string, { index: number; scale: number }>,
  key: string,
  lineIndex: number,
): number | null {
  const column = columns.get(key)
  if (!column) return null
  const raw = values[column.index]?.trim() ?? ''
  if (raw === '') return null
  const value = Number(raw) * column.scale
  if (!Number.isFinite(value)) {
    throw new DeviceTableError(
      `Line ${lineIndex + 1}: ${key} must be a finite number.`,
    )
  }
  return value
}

function splitCsvLine(line: string): string[] {
  return line.split(',').map((value) => value.trim())
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function assertUnique(values: number[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === values[index - 1]) {
      throw new DeviceTableError(`Duplicate ${label}: ${values[index]}.`)
    }
  }
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-12
}
