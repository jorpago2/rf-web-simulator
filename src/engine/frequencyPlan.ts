import type {
  FrequencyConversionStage,
  FrequencyPlanResult,
  FrequencyRange,
  FrequencySpectralLine,
  MixerProduct,
  MixerMode,
} from './types'
import type { MixerProductModel } from './mixerProducts'

export interface FrequencyMixerInput {
  nodeId: string
  label: string
  mode: MixerMode
  loFrequencyHz: number
  conversionLossDb?: number
  loPowerDbm?: number | null
  imageRejectionDb?: number | null
  loToOutputIsolationDb?: number | null
  productModels?: MixerProductModel[]
}

const PRODUCT_TERMS = [
  ['RF feedthrough', 'fIN', 1, 0, 'feedthrough'],
  ['LO leakage', 'fLO', 0, 1, 'leakage'],
  ['Difference', '|fIN - fLO|', 1, -1, 'alternate'],
  ['Sum', 'fIN + fLO', 1, 1, 'alternate'],
  ['Second harmonic', '2fIN', 2, 0, 'spur'],
  ['Second harmonic', '2fLO', 0, 2, 'spur'],
  ['Third order', '|2fIN - fLO|', 2, -1, 'spur'],
  ['Third order', '2fIN + fLO', 2, 1, 'spur'],
  ['Third order', '|fIN - 2fLO|', 1, -2, 'spur'],
  ['Third order', 'fIN + 2fLO', 1, 2, 'spur'],
  ['Third harmonic', '3fIN', 3, 0, 'spur'],
  ['Third harmonic', '3fLO', 0, 3, 'spur'],
] as const

export function calculateFrequencyPlan(
  inputFrequencyHz: Float64Array,
  mixers: FrequencyMixerInput[],
  inputPowerDbm: number | null = null,
  operatingInputFrequencyHz: number | null = null,
): FrequencyPlanResult {
  validateGrid(inputFrequencyHz)
  if (
    operatingInputFrequencyHz !== null &&
    (!Number.isFinite(operatingInputFrequencyHz) ||
      operatingInputFrequencyHz <= 0)
  ) {
    throw new RangeError('Operating input frequency must be positive.')
  }
  let operatingFrequencyHz =
    operatingInputFrequencyHz ?? range(inputFrequencyHz).centerHz
  const input = { ...range(inputFrequencyHz), centerHz: operatingFrequencyHz }
  let current = new Float64Array(inputFrequencyHz)
  let spectralLines: FrequencySpectralLine[] = [
    {
      frequencyHz: operatingFrequencyHz,
      powerDbm: inputPowerDbm,
      phaseDeg: inputPowerDbm === null ? null : 0,
      path: 'Input',
    },
  ]
  const stages = mixers.map((mixer): FrequencyConversionStage => {
    if (!Number.isFinite(mixer.loFrequencyHz) || mixer.loFrequencyHz <= 0) {
      throw new RangeError(`${mixer.label}: LO frequency must be positive.`)
    }
    const loPowerDbm = optionalNumber(mixer.loPowerDbm, mixer.label)
    const conversionLossDb =
      optionalNumber(mixer.conversionLossDb, mixer.label, 0) ?? 0
    const imageRejectionDb = optionalNumber(
      mixer.imageRejectionDb,
      mixer.label,
      0,
    )
    const loToOutputIsolationDb = optionalNumber(
      mixer.loToOutputIsolationDb,
      mixer.label,
      0,
    )
    const mixerInput = { ...range(current), centerHz: operatingFrequencyHz }
    const output = new Float64Array(current.length)
    for (let index = 0; index < current.length; index += 1) {
      const inputHz = current[index]!
      const outputHz =
        mixer.mode === 'upconvert'
          ? inputHz + mixer.loFrequencyHz
          : inputHz - mixer.loFrequencyHz
      if (!Number.isFinite(outputHz) || outputHz <= 0) {
        throw new RangeError(
          `${mixer.label}: difference conversion requires every input frequency to exceed the LO frequency.`,
        )
      }
      output[index] = outputHz
    }
    operatingFrequencyHz =
      mixer.mode === 'upconvert'
        ? operatingFrequencyHz + mixer.loFrequencyHz
        : operatingFrequencyHz - mixer.loFrequencyHz
    if (operatingFrequencyHz <= 0) {
      throw new RangeError(
        `${mixer.label}: tuned input frequency must exceed the LO frequency for difference conversion.`,
      )
    }
    const mixerOutput = { ...range(output), centerHz: operatingFrequencyHz }
    const imageFrequencyHz =
      mixer.mode === 'downconvert'
        ? 2 * mixer.loFrequencyHz - mixerInput.centerHz
        : Math.abs(mixer.loFrequencyHz - mixerInput.centerHz)
    const customProducts = new Map(
      (mixer.productModels ?? []).map((product) => [
        `${product.inputCoefficient},${product.loCoefficient}`,
        product,
      ]),
    )
    const products: MixerProduct[] = PRODUCT_TERMS.map(
      ([
        label,
        formula,
        inputCoefficient,
        loCoefficient,
        kind,
      ]): MixerProduct => {
        const desired =
          (mixer.mode === 'downconvert' && loCoefficient === -1) ||
          (mixer.mode === 'upconvert' && loCoefficient === 1)
        const custom = customProducts.get(
          `${inputCoefficient},${loCoefficient}`,
        )
        customProducts.delete(`${inputCoefficient},${loCoefficient}`)
        return {
          label: custom?.label ?? label,
          formula,
          frequencyHz: Math.abs(
            inputCoefficient * mixerInput.centerHz +
              loCoefficient * mixer.loFrequencyHz,
          ),
          order: Math.abs(inputCoefficient) + Math.abs(loCoefficient),
          inputCoefficient,
          loCoefficient,
          relativeLevelDb:
            custom?.relativeLevelDb ??
            (desired && inputCoefficient === 1 ? -conversionLossDb : null),
          phaseDeg: custom?.phaseDeg ?? (desired ? 0 : null),
          kind: desired && inputCoefficient === 1 ? 'desired' : kind,
        }
      },
    )
    products.push(
      ...Array.from(customProducts.values(), (custom): MixerProduct => {
        const desired =
          custom.inputCoefficient === 1 &&
          ((mixer.mode === 'downconvert' && custom.loCoefficient === -1) ||
            (mixer.mode === 'upconvert' && custom.loCoefficient === 1))
        return {
          label: custom.label ?? 'Measured product',
          formula: coefficientFormula(
            custom.inputCoefficient,
            custom.loCoefficient,
          ),
          frequencyHz: Math.abs(
            custom.inputCoefficient * mixerInput.centerHz +
              custom.loCoefficient * mixer.loFrequencyHz,
          ),
          order:
            Math.abs(custom.inputCoefficient) + Math.abs(custom.loCoefficient),
          inputCoefficient: custom.inputCoefficient,
          loCoefficient: custom.loCoefficient,
          relativeLevelDb: custom.relativeLevelDb,
          phaseDeg: custom.phaseDeg,
          kind: desired ? 'desired' : 'spur',
        }
      }),
    )
    spectralLines = propagateMixerProducts(
      spectralLines,
      products,
      mixer.loFrequencyHz,
      mixer.label,
      loPowerDbm,
      loToOutputIsolationDb,
    )
    current = output
    return {
      nodeId: mixer.nodeId,
      label: mixer.label,
      mode: mixer.mode,
      loFrequencyHz: mixer.loFrequencyHz,
      input: mixerInput,
      output: mixerOutput,
      imageLocation: mixer.mode === 'downconvert' ? 'input' : 'output',
      imageFrequencyHz: imageFrequencyHz >= 0 ? imageFrequencyHz : null,
      imageRejectionDb,
      loPowerDbm,
      loToOutputIsolationDb,
      estimatedLoLeakagePowerDbm:
        loPowerDbm !== null && loToOutputIsolationDb !== null
          ? loPowerDbm - loToOutputIsolationDb
          : null,
      products,
    }
  })

  return {
    input,
    output: { ...range(current), centerHz: operatingFrequencyHz },
    outputFrequencyHz: current,
    stages,
    spectralLines,
  }
}

function propagateMixerProducts(
  inputs: FrequencySpectralLine[],
  products: MixerProduct[],
  loFrequencyHz: number,
  mixerLabel: string,
  loPowerDbm: number | null,
  loIsolationDb: number | null,
): FrequencySpectralLine[] {
  const outputs = inputs.flatMap((input) =>
    products.flatMap((product): FrequencySpectralLine[] => {
      if (product.inputCoefficient === 0 || product.relativeLevelDb === null)
        return []
      const frequencyHz = Math.abs(
        product.inputCoefficient * input.frequencyHz +
          product.loCoefficient * loFrequencyHz,
      )
      if (frequencyHz <= 0) return []
      return [
        {
          frequencyHz,
          powerDbm:
            input.powerDbm === null
              ? null
              : input.powerDbm + product.relativeLevelDb,
          phaseDeg:
            input.phaseDeg === null || product.phaseDeg === null
              ? null
              : normalizePhase(input.phaseDeg + product.phaseDeg),
          path: `${input.path} → ${mixerLabel}: ${product.label}`,
        },
      ]
    }),
  )
  if (loPowerDbm !== null && loIsolationDb !== null) {
    outputs.push({
      frequencyHz: loFrequencyHz,
      powerDbm: loPowerDbm - loIsolationDb,
      phaseDeg: null,
      path: `${mixerLabel}: LO leakage`,
    })
  }
  // ponytail: cap combinatorial spur growth; use a sparse-spectrum solver above 512 retained paths.
  return outputs
    .sort(
      (left, right) =>
        (right.powerDbm ?? -Infinity) - (left.powerDbm ?? -Infinity),
    )
    .slice(0, 512)
}

function normalizePhase(valueDeg: number): number {
  return ((((valueDeg + 180) % 360) + 360) % 360) - 180
}

function coefficientFormula(
  inputCoefficient: number,
  loCoefficient: number,
): string {
  const sign = loCoefficient < 0 ? '−' : '+'
  return `|${inputCoefficient}fIN ${sign} ${Math.abs(loCoefficient)}fLO|`
}

function optionalNumber(
  value: number | null | undefined,
  label: string,
  minimum?: number,
): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new RangeError(`${label}: mixer planning metadata is invalid.`)
  }
  return value
}

function validateGrid(frequencyHz: Float64Array): void {
  if (frequencyHz.length === 0) {
    throw new RangeError('Frequency plan requires a non-empty input grid.')
  }
  for (let index = 0; index < frequencyHz.length; index += 1) {
    const value = frequencyHz[index]!
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (index > 0 && value <= frequencyHz[index - 1]!)
    ) {
      throw new RangeError(
        'Frequency plan input must be non-negative, finite, and strictly increasing.',
      )
    }
  }
}

function range(frequencyHz: Float64Array): FrequencyRange {
  return {
    startHz: frequencyHz[0]!,
    centerHz: frequencyHz[Math.floor(frequencyHz.length / 2)]!,
    stopHz: frequencyHz.at(-1)!,
  }
}
