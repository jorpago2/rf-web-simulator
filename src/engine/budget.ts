import type { RFBudgetResult, RFNodeType, TwoPortNetwork } from './types'
import type { DevicePowerTransfer } from './deviceTable'
import { calculateTransducerGain } from './transducer'

export interface BudgetStageInput {
  nodeId: string
  label: string
  type: RFNodeType
  gainDb: number | null
  noiseFigureDb: number | null
  outputP1Dbm: number | null
  outputIp3Dbm: number | null
  im3PhaseDeg?: number | null
  powerTransfer?: DevicePowerTransfer | null
}

export function calculateRFBudget(
  centerFrequencyHz: number,
  sourcePowerDbm: number | null,
  stages: BudgetStageInput[],
  system?: {
    network: TwoPortNetwork
    pointIndex: number
    sourceImpedanceOhm: number
    loadImpedanceOhm: number
    noiseFigureDb?: number | null
  },
): RFBudgetResult {
  if (!Number.isFinite(centerFrequencyHz) || centerFrequencyHz <= 0) {
    throw new RangeError('RF budget center frequency must be positive.')
  }
  if (sourcePowerDbm !== null && !Number.isFinite(sourcePowerDbm)) {
    throw new RangeError('RF budget source power must be finite when supplied.')
  }

  let cumulativeGainDb: number | null = 0
  let cumulativeGainLinear: number | null = 1
  let cumulativeNoiseFactor: number | null = 1
  let cumulativeInputP1Dbm: number | null = Number.POSITIVE_INFINITY
  let reciprocalInputIp3Milliwatt: number | null = 0
  const warnings: string[] =
    sourcePowerDbm === null ? ['Source power is missing.'] : []

  const budgetStages = stages.map((stage) => {
    validateStage(stage)
    const previousGainLinear = cumulativeGainLinear

    if (stage.gainDb === null || cumulativeGainDb === null) {
      cumulativeGainDb = null
      cumulativeGainLinear = null
    } else {
      cumulativeGainDb += stage.gainDb
      cumulativeGainLinear = dbToLinear(cumulativeGainDb)
    }

    if (
      cumulativeNoiseFactor === null ||
      stage.noiseFigureDb === null ||
      previousGainLinear === null
    ) {
      cumulativeNoiseFactor = null
    } else {
      cumulativeNoiseFactor +=
        (dbToLinear(stage.noiseFigureDb) - 1) / previousGainLinear
    }

    if (
      cumulativeInputP1Dbm !== null &&
      stage.outputP1Dbm !== null &&
      cumulativeGainDb !== null
    ) {
      cumulativeInputP1Dbm = Math.min(
        cumulativeInputP1Dbm,
        stage.outputP1Dbm + 1 - cumulativeGainDb,
      )
    } else {
      cumulativeInputP1Dbm = null
    }

    if (
      reciprocalInputIp3Milliwatt !== null &&
      stage.outputIp3Dbm !== null &&
      stage.gainDb !== null &&
      previousGainLinear !== null
    ) {
      const stageInputIp3Milliwatt = dbmToMilliwatt(
        stage.outputIp3Dbm - stage.gainDb,
      )
      reciprocalInputIp3Milliwatt += previousGainLinear / stageInputIp3Milliwatt
    } else {
      reciprocalInputIp3Milliwatt = null
    }

    const missing = [
      stage.gainDb === null ? 'gain' : '',
      stage.noiseFigureDb === null ? 'NF' : '',
      stage.outputP1Dbm === null ? 'P1dB' : '',
      stage.outputIp3Dbm === null ? 'IP3' : '',
    ].filter(Boolean)
    if (missing.length > 0) {
      warnings.push(`${stage.label}: missing ${missing.join(', ')} metadata.`)
    }
    if (
      stage.outputP1Dbm !== null &&
      stage.outputIp3Dbm !== null &&
      Number.isFinite(stage.outputP1Dbm) &&
      stage.outputIp3Dbm <= stage.outputP1Dbm
    ) {
      warnings.push(
        `${stage.label}: output IP3 should normally exceed output P1dB.`,
      )
    }

    const cumulativeInputIp3Dbm =
      reciprocalInputIp3Milliwatt === null
        ? null
        : reciprocalInputIp3Milliwatt === 0
          ? Number.POSITIVE_INFINITY
          : milliwattToDbm(1 / reciprocalInputIp3Milliwatt)
    const outputPowerDbm =
      sourcePowerDbm === null || cumulativeGainDb === null
        ? null
        : sourcePowerDbm + cumulativeGainDb
    const cumulativeOutputP1Dbm =
      cumulativeInputP1Dbm === null || cumulativeGainDb === null
        ? null
        : cumulativeInputP1Dbm + cumulativeGainDb - 1

    if (
      outputPowerDbm !== null &&
      cumulativeOutputP1Dbm !== null &&
      Number.isFinite(cumulativeOutputP1Dbm) &&
      outputPowerDbm >= cumulativeOutputP1Dbm
    ) {
      warnings.push(
        `${stage.label}: estimated output power reaches or exceeds cumulative P1dB; the linear budget is invalid here.`,
      )
    }

    return {
      nodeId: stage.nodeId,
      label: stage.label,
      type: stage.type,
      stageGainDb: stage.gainDb,
      cumulativeGainDb,
      outputPowerDbm,
      cumulativeNoiseFigureDb:
        cumulativeNoiseFactor === null
          ? null
          : linearToDb(cumulativeNoiseFactor),
      cumulativeInputP1Dbm,
      cumulativeOutputP1Dbm,
      cumulativeInputIp3Dbm,
      cumulativeOutputIp3Dbm:
        cumulativeInputIp3Dbm === null || cumulativeGainDb === null
          ? null
          : cumulativeInputIp3Dbm + cumulativeGainDb,
    }
  })

  const sourceImpedanceOhm =
    system?.sourceImpedanceOhm ?? system?.network.referenceImpedanceOhm ?? 50
  const loadImpedanceOhm =
    system?.loadImpedanceOhm ?? system?.network.referenceImpedanceOhm ?? 50
  const transducer = system
    ? calculateTransducerGain(
        system.network,
        system.pointIndex,
        sourceImpedanceOhm,
        loadImpedanceOhm,
      )
    : null
  const hasNoiseOverride = system !== undefined && 'noiseFigureDb' in system
  const cascadedNoiseFigureDb = hasNoiseOverride
    ? (system.noiseFigureDb ?? null)
    : (budgetStages.at(-1)?.cumulativeNoiseFigureDb ??
      (stages.length === 0 ? 0 : null))
  if (hasNoiseOverride && budgetStages.length > 0) {
    budgetStages[budgetStages.length - 1]!.cumulativeNoiseFigureDb =
      system.noiseFigureDb ?? null
  }
  return {
    centerFrequencyHz,
    sourcePowerDbm,
    sourceImpedanceOhm,
    loadImpedanceOhm,
    transducerGainDb: transducer?.transducerGainDb ?? null,
    deliveredLoadPowerDbm:
      sourcePowerDbm !== null && transducer
        ? sourcePowerDbm + transducer.transducerGainDb
        : null,
    cascadedNoiseFigureDb,
    stages: budgetStages,
    warnings,
  }
}

function validateStage(stage: BudgetStageInput): void {
  if (stage.gainDb !== null && !Number.isFinite(stage.gainDb)) {
    throw new RangeError(`${stage.label}: gain must be finite.`)
  }
  if (
    stage.noiseFigureDb !== null &&
    (!Number.isFinite(stage.noiseFigureDb) || stage.noiseFigureDb < 0)
  ) {
    throw new RangeError(`${stage.label}: noise figure must be at least 0 dB.`)
  }
  for (const [label, value] of [
    ['output P1dB', stage.outputP1Dbm],
    ['output IP3', stage.outputIp3Dbm],
  ] as const) {
    if (value !== null && Number.isNaN(value)) {
      throw new RangeError(`${stage.label}: ${label} is invalid.`)
    }
  }
}

function dbToLinear(valueDb: number): number {
  return 10 ** (valueDb / 10)
}

function linearToDb(value: number): number {
  return 10 * Math.log10(value)
}

function dbmToMilliwatt(valueDbm: number): number {
  return 10 ** (valueDbm / 10)
}

function milliwattToDbm(valueMilliwatt: number): number {
  return 10 * Math.log10(valueMilliwatt)
}
