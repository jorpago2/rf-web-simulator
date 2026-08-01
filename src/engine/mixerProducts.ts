export interface MixerProductModel {
  inputCoefficient: number
  loCoefficient: number
  relativeLevelDb: number
  phaseDeg: number
  label?: string
}

export class MixerProductTableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MixerProductTableError'
  }
}

export function parseMixerProductCsv(content: string): MixerProductModel[] {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
  if (lines.length < 2 || lines.length > 102) {
    throw new MixerProductTableError(
      'Mixer table requires 1 to 100 product rows.',
    )
  }
  const headers = lines[0]!.split(',').map(normalize)
  const required = ['m', 'n', 'relativeleveldb']
  const indices = Object.fromEntries(
    required.map((header) => [header, headers.indexOf(header)]),
  ) as Record<string, number>
  if (required.some((header) => indices[header] === -1)) {
    throw new MixerProductTableError(
      'Mixer table requires m, n, and relative_level_db columns.',
    )
  }
  const phaseIndex = headers.indexOf('phasedeg')
  const labelIndex = headers.indexOf('label')
  const seen = new Set<string>()
  return lines.slice(1).map((line, rowIndex) => {
    const values = line.split(',').map((value) => value.trim())
    const m = Number(values[indices.m!])
    const n = Number(values[indices.n!])
    const relativeLevelDb = Number(values[indices.relativeleveldb!])
    const phaseDeg =
      phaseIndex >= 0 && values[phaseIndex] ? Number(values[phaseIndex]) : 0
    if (
      !Number.isInteger(m) ||
      !Number.isInteger(n) ||
      (m === 0 && n === 0) ||
      Math.abs(m) + Math.abs(n) > 15 ||
      !Number.isFinite(relativeLevelDb) ||
      relativeLevelDb > 0 ||
      !Number.isFinite(phaseDeg)
    ) {
      throw new MixerProductTableError(
        `Line ${rowIndex + 2}: invalid mixer product.`,
      )
    }
    const key = `${m},${n}`
    if (seen.has(key))
      throw new MixerProductTableError(
        `Line ${rowIndex + 2}: duplicate product ${key}.`,
      )
    seen.add(key)
    const label = labelIndex >= 0 ? values[labelIndex] : undefined
    return {
      inputCoefficient: m,
      loCoefficient: n,
      relativeLevelDb,
      phaseDeg,
      ...(label ? { label } : {}),
    }
  })
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '')
}
