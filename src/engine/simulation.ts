import { cascadeTwoPorts } from './cascade'
import { calculateRFBudget, type BudgetStageInput } from './budget'
import { magnitudeDb } from './complex'
import { deriveSimulationCurves, magnitudeDbArray } from './derivedMetrics'
import {
  deviceTableOverridesParameter,
  deviceMetricAt,
  devicePowerTransferAt,
  parseDeviceTableCsv,
  type DeviceTable,
} from './deviceTable'
import { calculateFrequencyPlan } from './frequencyPlan'
import {
  createIdealAmplifier,
  createIdealAttenuator,
  createIdealDiplexer,
  createIdealDirectionalCoupler,
  createIdealDivider,
  createIdealFilter,
  createIdealIsolator,
  createIdealPhaseShifter,
  createIdealRFSwitch,
  createMatchingNetwork,
  createTabulatedAmplifier,
  createTransmissionLine,
  createThroughNetwork,
} from './idealNetworks'
import {
  solveNPortInterconnection,
  solveNPortIncidentWaveAt,
  solveNPortNoiseCorrelationAt,
  solveNPortWaveAt,
  type NetworkBlock,
  type NetworkConnection,
  type NetworkPortReference,
} from './interconnect'
import {
  buildCommonFrequencyGrid,
  interpolateNetwork,
  interpolateNPortNetwork,
} from './interpolation'
import {
  calculateNonlinearSweep,
  DEFAULT_TWO_TONE_SPACING_HZ,
} from './nonlinear'
import { calculateNetworkChecks } from './networkChecks'
import { parseMixerProductCsv } from './mixerProducts'
import { noiseFigureFromParameters } from './noiseParameters'
import {
  noiseFigureFromCorrelation,
  outputNoiseCorrelationAt,
  passiveNoiseCorrelationAt,
  touchstoneNoiseCorrelationAt,
} from './noiseWaves'
import {
  nPortToTwoPort,
  renormalizeNPortNetwork,
  twoPortToNPort,
  type ComplexValue,
} from './nport'
import {
  isLoadTerminal,
  isSourceTerminal,
  portsForNode,
  resolveEdgePort,
} from './ports'
import { enforceNPortPassivity } from './passivity'
import { parseTouchstone, type TouchstoneNoiseData } from './touchstone'
import { calculateTransducerGain } from './transducer'
import { deembedTwoPortNetwork } from './twoPortParameters'
import type {
  IdealFilterType,
  MatchingResponse,
  MatchingTopology,
  MonteCarloMetricSummary,
  MonteCarloSensitivity,
  ParametricMetric,
  RFAnalysisSettings,
  RFProjectNode,
  NPortNetwork,
  SimulationInput,
  SimulationOutput,
  SimulationProbeResult,
  SimulationStageSummary,
  TwoPortNetwork,
} from './types'
import { validateLinearGraph, type GraphIssue } from './validation'

export class SimulationError extends Error {
  readonly graphIssues: GraphIssue[]

  constructor(message: string, graphIssues: GraphIssue[] = []) {
    super(message)
    this.name = 'SimulationError'
    this.graphIssues = graphIssues
  }
}

export function simulateLinearChain(input: SimulationInput): SimulationOutput {
  const result = simulateDeterministic(input)
  return {
    ...result,
    monteCarlo: calculateMonteCarlo(input),
    parametricSweep: calculateParametricSweep(input),
  }
}

function simulateDeterministic(input: SimulationInput): SimulationOutput {
  const validation = validateLinearGraph(input.nodes, input.edges)
  if (!validation.valid) {
    throw new SimulationError(
      validation.issues.map((issue) => issue.message).join(' '),
      validation.issues,
    )
  }

  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  const orderedNodes = validation.orderedNodeIds.map((nodeId) => {
    const node = nodesById.get(nodeId)
    if (!node)
      throw new SimulationError(`Validated node "${nodeId}" is missing.`)
    return node
  })

  validateBlockReferenceImpedances(
    orderedNodes,
    input.analysis.referenceImpedanceOhm,
  )
  const parsedNetworks = new Map<string, TwoPortNetwork>()
  const parsedNPortNetworks = new Map<string, NPortNetwork>()
  const noiseParameters = new Map<
    string,
    { data: TouchstoneNoiseData; referenceImpedanceOhm: number }
  >()
  const passivityCorrections: string[] = []
  const deviceTables = new Map<string, DeviceTable>()
  for (const node of orderedNodes) {
    if (
      node.data.type === 'idealAmplifier' &&
      typeof node.data.parameters.deviceTableContent === 'string'
    ) {
      deviceTables.set(
        node.id,
        parseDeviceTableCsv(
          node.data.parameters.deviceTableContent,
          typeof node.data.parameters.deviceTableFileName === 'string'
            ? node.data.parameters.deviceTableFileName
            : node.data.label,
        ),
      )
    }
    const content =
      node.data.type === 'touchstone2Port'
        ? node.data.parameters.content
        : node.data.type === 'idealAmplifier'
          ? node.data.parameters.sParameterContent
          : undefined
    if (content === undefined || content === null) continue
    if (typeof content !== 'string') {
      throw new SimulationError(
        `Touchstone data at "${node.data.label}" are invalid.`,
      )
    }
    const fileName =
      node.data.type === 'touchstone2Port'
        ? node.data.parameters.fileName
        : node.data.parameters.sParameterFileName
    const sourceName = typeof fileName === 'string' ? fileName : node.data.label
    const imported = parseTouchstone(
      content,
      sourceName,
      node.data.type === 'idealAmplifier'
        ? 2
        : Number.isInteger(node.data.parameters.portCount)
          ? (node.data.parameters.portCount as number)
          : 2,
    )
    if (imported.noise) {
      noiseParameters.set(node.id, {
        data: imported.noise,
        referenceImpedanceOhm: imported.referenceImpedancesOhm[0]!,
      })
    }
    const normalized = referencesMatch(
      imported.referenceImpedancesOhm,
      input.analysis.referenceImpedanceOhm,
    )
      ? imported
      : renormalizeNPortNetwork(imported, input.analysis.referenceImpedanceOhm)
    let network =
      node.data.type === 'touchstone2Port' && normalized.portCount === 2
        ? deembedImportedNetwork(
            normalized,
            node,
            input.analysis.referenceImpedanceOhm,
          )
        : normalized
    if (node.data.parameters.enforcePassivity === true) {
      const enforcement = enforceNPortPassivity(network)
      network = enforcement.network
      if (enforcement.correctedPointCount > 0) {
        passivityCorrections.push(
          `${node.data.label}: passivity scaling corrected ${enforcement.correctedPointCount} frequency points (original maximum σ = ${enforcement.maximumOriginalSingularValue.toFixed(4)}).`,
        )
      }
    }
    parsedNPortNetworks.set(node.id, network)
    if (network.portCount === 2) {
      parsedNetworks.set(node.id, nPortToTwoPort(network))
    }
  }

  const localFrequencyOffsetsHz = calculateLocalFrequencyOffsets(
    orderedNodes,
    input.edges,
  )

  const commonGrid = buildCommonFrequencyGrid(
    [...parsedNPortNetworks].map(([nodeId, network]) => ({
      network,
      inputFrequencyOffsetHz: localFrequencyOffsetsHz.get(nodeId) ?? 0,
    })),
    input.analysis,
  )
  const warnings = [...commonGrid.warnings]
  warnings.push(
    ...passivityCorrections.map((message) => ({
      code: 'PASSIVITY_ENFORCED' as const,
      message: `${message} Pointwise scaling is conservative and can alter causality; compare against the original measurement.`,
    })),
  )
  const source = orderedNodes.find(isSourceTerminal)!
  const requestedOperatingFrequencyHz = sourceOperatingFrequency(source)
  if (
    requestedOperatingFrequencyHz !== null &&
    (requestedOperatingFrequencyHz < commonGrid.frequencyHz[0]! ||
      requestedOperatingFrequencyHz > commonGrid.frequencyHz.at(-1)!)
  ) {
    warnings.push({
      code: 'RANGE_CLIPPED',
      message: `${source.data.label}: requested operating frequency ${requestedOperatingFrequencyHz} Hz lies outside the analysis sweep; the nearest sweep endpoint is used for the RF budget.`,
      frequencyHz: requestedOperatingFrequencyHz,
    })
  }
  if (validation.branched) {
    return simulateBranchedNetwork(
      input,
      orderedNodes,
      nodesById,
      commonGrid.frequencyHz,
      parsedNetworks,
      parsedNPortNetworks,
      deviceTables,
      noiseParameters,
      localFrequencyOffsetsHz,
      warnings,
    )
  }
  const load = orderedNodes.find(isLoadTerminal)!
  const operatingIndex = operatingPointIndex(commonGrid.frequencyHz, source)
  const mixerNodes = orderedNodes.filter(
    (node) => node.data.type === 'idealMixer',
  )
  const frequencyPlan = calculateFrequencyPlan(
    commonGrid.frequencyHz,
    mixerNodes.map((node) => ({
      nodeId: node.id,
      label: node.data.label,
      mode: mixerMode(node),
      loFrequencyHz: finiteParameter(node, 'loFrequencyHz'),
      conversionLossDb: finiteParameter(node, 'conversionLossDb'),
      productModels:
        typeof node.data.parameters.productTableContent === 'string'
          ? parseMixerProductCsv(node.data.parameters.productTableContent)
          : [],
      loPowerDbm: optionalFiniteParameter(node, 'loPowerDbm'),
      imageRejectionDb: optionalFiniteParameter(node, 'imageRejectionDb', 0),
      loToOutputIsolationDb: optionalFiniteParameter(
        node,
        'loToOutputIsolationDb',
        0,
      ),
    })),
    optionalFiniteParameter(source, 'powerDbm'),
    requestedOperatingFrequencyHz,
  )
  if (mixerNodes.length > 0) {
    warnings.push({
      code: 'FREQUENCY_CONVERSION_MODEL',
      message:
        'The selected mixer product defines the conversion envelope versus input frequency. Declared product levels/phases propagate through later mixers; image and undeclared low-order products remain planning frequencies without invented amplitudes.',
    })
  }
  let cumulative = createThroughNetwork(
    commonGrid.frequencyHz,
    input.analysis.referenceImpedanceOhm,
    'Chain input',
  )
  const stageSummaries: SimulationStageSummary[] = []
  const probeResults: SimulationProbeResult[] = []
  const budgetStages: BudgetStageInput[] = []
  const noiseBlocks: NetworkBlock[] = []
  const sourceImpedanceOhm = impedanceParameter(
    source,
    'sourceImpedanceOhm',
    input.analysis.referenceImpedanceOhm,
  )
  let prefixTransducerGainDb = 0

  for (const node of orderedNodes) {
    if (isSourceTerminal(node) || isLoadTerminal(node)) continue

    if (node.data.type === 'probe') {
      probeResults.push({
        nodeId: node.id,
        label: node.data.label,
        s21Db: magnitudeDbArray(cumulative.s21),
      })
    } else {
      const stageNetwork = networkForNode(
        node,
        commonGrid.frequencyHz,
        localFrequencyOffsetsHz.get(node.id) ?? 0,
        input.analysis.referenceImpedanceOhm,
        parsedNetworks,
        deviceTables,
      )
      const cascade = cascadeTwoPorts(cumulative, stageNetwork)
      cumulative = cascade.network
      warnings.push(...cascade.warnings)
      const stage = budgetStage(
        node,
        stageNetwork,
        localFrequencyOffsetsHz.get(node.id) ?? 0,
        deviceTables.get(node.id),
        noiseParameters.get(node.id),
        budgetStages.length === 0
          ? sourceImpedanceOhm
          : input.analysis.referenceImpedanceOhm,
      )
      noiseBlocks.push({
        nodeId: node.id,
        portIds: ['input', 'output'],
        network: twoPortToNPort(stageNetwork),
        noiseCorrelationAt: (pointIndex) =>
          noiseCorrelationForTwoPortNode(
            node,
            stageNetwork,
            pointIndex,
            localFrequencyOffsetsHz.get(node.id) ?? 0,
            deviceTables.get(node.id),
            noiseParameters.get(node.id),
            input.analysis.referenceImpedanceOhm,
          ),
      })
      const prefixGainDb = calculateTransducerGain(
        cumulative,
        operatingIndex,
        sourceImpedanceOhm,
        input.analysis.referenceImpedanceOhm,
      ).transducerGainDb
      if (
        Number.isFinite(prefixGainDb) &&
        Number.isFinite(prefixTransducerGainDb)
      ) {
        stage.gainDb = prefixGainDb - prefixTransducerGainDb
      }
      prefixTransducerGainDb = prefixGainDb
      budgetStages.push(stage)
    }

    stageSummaries.push(summarizeStage(node, cumulative, operatingIndex))
  }

  const loadImpedanceOhm = impedanceParameter(
    load,
    'loadImpedanceOhm',
    input.analysis.referenceImpedanceOhm,
  )
  const finalTransducerGainDb = calculateTransducerGain(
    cumulative,
    operatingIndex,
    sourceImpedanceOhm,
    loadImpedanceOhm,
  ).transducerGainDb
  const lastBudgetStage = budgetStages.at(-1)
  if (
    lastBudgetStage &&
    lastBudgetStage.gainDb !== null &&
    Number.isFinite(finalTransducerGainDb) &&
    Number.isFinite(prefixTransducerGainDb)
  ) {
    lastBudgetStage.gainDb += finalTransducerGainDb - prefixTransducerGainDb
  }
  const noiseCorrelation =
    noiseBlocks.length === 0
      ? [
          { re: 0, im: 0 },
          { re: 0, im: 0 },
          { re: 0, im: 0 },
          { re: 0, im: 0 },
        ]
      : solveNPortNoiseCorrelationAt(
          noiseBlocks,
          noiseBlocks.slice(1).map((block, index) => ({
            first: { nodeId: noiseBlocks[index]!.nodeId, portId: 'output' },
            second: { nodeId: block.nodeId, portId: 'input' },
          })),
          { nodeId: noiseBlocks[0]!.nodeId, portId: 'input' },
          { nodeId: noiseBlocks.at(-1)!.nodeId, portId: 'output' },
          input.analysis.referenceImpedanceOhm,
          operatingIndex,
        )
  const cascadedNoiseFigureDb = noiseCorrelation
    ? noiseFigureFromCorrelation(
        cumulative,
        operatingIndex,
        noiseCorrelation,
        sourceImpedanceOhm,
        loadImpedanceOhm,
      )
    : null
  const derived = deriveSimulationCurves(cumulative)
  if (mixerNodes.length > 0) {
    derived.curves.s21PhaseDeg.fill(Number.NaN)
    derived.curves.s21GroupDelayS.fill(Number.NaN)
  }
  warnings.push(...derived.warnings)
  const budget = calculateRFBudget(
    commonGrid.frequencyHz[operatingIndex]!,
    optionalFiniteParameter(source, 'powerDbm'),
    budgetStages,
    {
      network: cumulative,
      pointIndex: operatingIndex,
      sourceImpedanceOhm,
      loadImpedanceOhm,
      noiseFigureDb: cascadedNoiseFigureDb,
    },
  )
  const nonlinear = calculateNonlinearSweep(
    budget,
    budgetStages,
    frequencyPlan.output.centerHz,
    optionalFiniteParameter(source, 'twoToneSpacingHz', 1) ??
      DEFAULT_TWO_TONE_SPACING_HZ,
  )
  if (nonlinear.available) {
    const measuredCompression = budgetStages.some(
      (stage) => stage.powerTransfer,
    )
    warnings.push({
      code: 'NONLINEAR_MODEL',
      message:
        (measuredCompression
          ? 'Measured Pout(Pin) curves are interpolated inside their frequency and input-power domains; the P1dB law is used outside the measured power range. '
          : 'A smooth P1dB-calibrated compression estimate is propagated through each behavioral stage. ') +
        'Two-tone IM3 is a third-order extrapolation from per-stage OIP3 and coherently combines the configured IM3 contribution phases; measured AM/PM is propagated when supplied. Memory, bias/thermal dynamics, even-order harmonics, load-pull, and transistor-level behavior are not modeled.',
    })
  }
  return {
    total: cumulative,
    curves: derived.curves,
    networkChecks: calculateNetworkChecks(cumulative),
    stageSummaries,
    probeResults,
    budget,
    nonlinear,
    frequencyPlan,
    monteCarlo: emptyMonteCarlo(input.analysis),
    parametricSweep: emptyParametricSweep(input.analysis),
    warnings,
  }
}

function deembedImportedNetwork(
  measured: NPortNetwork,
  node: RFProjectNode,
  referenceImpedanceOhm: number,
): NPortNetwork {
  const fixtures = (
    [
      ['leftFixtureContent', 'leftFixtureFileName'],
      ['rightFixtureContent', 'rightFixtureFileName'],
    ] as const
  ).map(([contentKey, fileNameKey]) => {
    const content = node.data.parameters[contentKey]
    if (content === undefined || content === null) return undefined
    if (typeof content !== 'string') {
      throw new SimulationError(
        `${node.data.label}: de-embedding fixture data are invalid.`,
      )
    }
    const parsed = parseTouchstone(
      content,
      typeof node.data.parameters[fileNameKey] === 'string'
        ? (node.data.parameters[fileNameKey] as string)
        : undefined,
      2,
    )
    return referencesMatch(parsed.referenceImpedancesOhm, referenceImpedanceOhm)
      ? parsed
      : renormalizeNPortNetwork(parsed, referenceImpedanceOhm)
  })
  if (!fixtures[0] && !fixtures[1]) return measured
  const ranges = [
    measured,
    ...fixtures.filter((fixture) => fixture !== undefined),
  ]
  const startHz = Math.max(...ranges.map((network) => network.frequencyHz[0]!))
  const stopHz = Math.min(
    ...ranges.map((network) => network.frequencyHz.at(-1)!),
  )
  const frequencyHz = Float64Array.from(
    Array.from(measured.frequencyHz).filter(
      (frequency) => frequency >= startHz && frequency <= stopHz,
    ),
  )
  if (frequencyHz.length < 2) {
    throw new SimulationError(
      `${node.data.label}: DUT and fixture files need at least two overlapping frequency points.`,
    )
  }
  const measuredTwoPort = nPortToTwoPort(
    interpolateNPortNetwork(measured, frequencyHz),
  )
  const left = fixtures[0]
    ? nPortToTwoPort(interpolateNPortNetwork(fixtures[0], frequencyHz))
    : undefined
  const right = fixtures[1]
    ? nPortToTwoPort(interpolateNPortNetwork(fixtures[1], frequencyHz))
    : undefined
  return twoPortToNPort(deembedTwoPortNetwork(measuredTwoPort, left, right))
}

function simulateBranchedNetwork(
  input: SimulationInput,
  orderedNodes: RFProjectNode[],
  nodesById: Map<string, RFProjectNode>,
  frequencyHz: Float64Array,
  parsedNetworks: Map<string, TwoPortNetwork>,
  parsedNPortNetworks: Map<string, NPortNetwork>,
  deviceTables: Map<string, DeviceTable>,
  noiseParameters: Map<
    string,
    { data: TouchstoneNoiseData; referenceImpedanceOhm: number }
  >,
  localFrequencyOffsetsHz: Map<string, number>,
  warnings: SimulationOutput['warnings'],
): SimulationOutput {
  const referenceImpedanceOhm = input.analysis.referenceImpedanceOhm
  const blocks: NetworkBlock[] = []
  for (const node of orderedNodes) {
    if (isSourceTerminal(node) || isLoadTerminal(node)) continue
    const portIds = portsForNode(node).map((port) => port.id)
    if (node.data.type === 'touchstone2Port') {
      const imported = parsedNPortNetworks.get(node.id)
      if (!imported) {
        throw new SimulationError(
          `Missing parsed network for "${node.data.label}".`,
        )
      }
      const evaluatedNetwork = {
        ...interpolateNPortNetwork(
          imported,
          Float64Array.from(
            frequencyHz,
            (value) => value + (localFrequencyOffsetsHz.get(node.id) ?? 0),
          ),
        ),
        frequencyHz,
      }
      blocks.push({
        nodeId: node.id,
        portIds,
        network: evaluatedNetwork,
        noiseCorrelationAt: (pointIndex) =>
          evaluatedNetwork.portCount === 2
            ? noiseCorrelationForTwoPortNode(
                node,
                nPortToTwoPort(evaluatedNetwork),
                pointIndex,
                localFrequencyOffsetsHz.get(node.id) ?? 0,
                undefined,
                noiseParameters.get(node.id),
                referenceImpedanceOhm,
              )
            : passiveNoiseCorrelationAt(evaluatedNetwork, pointIndex),
      })
      continue
    }
    if (
      node.data.type === 'idealSplitter' ||
      node.data.type === 'idealCombiner' ||
      node.data.type === 'idealDirectionalCoupler' ||
      node.data.type === 'idealDiplexer' ||
      node.data.type === 'idealBalun'
    ) {
      const localFrequencyHz = Float64Array.from(
        frequencyHz,
        (value) => value + (localFrequencyOffsetsHz.get(node.id) ?? 0),
      )
      const divider =
        node.data.type === 'idealDirectionalCoupler'
          ? createIdealDirectionalCoupler(
              localFrequencyHz,
              finiteParameter(node, 'couplingDb'),
              finiteParameter(node, 'excessLossDb'),
              referenceImpedanceOhm,
              node.data.label,
            )
          : node.data.type === 'idealDiplexer'
            ? createIdealDiplexer(
                localFrequencyHz,
                finiteParameter(node, 'crossoverFrequencyHz'),
                finiteParameter(node, 'order'),
                finiteParameter(node, 'insertionLossDb'),
                referenceImpedanceOhm,
                node.data.label,
              )
            : node.data.type === 'idealBalun'
              ? createIdealDivider(
                  frequencyHz,
                  0,
                  finiteParameter(node, 'excessLossDb'),
                  finiteParameter(node, 'amplitudeImbalanceDb'),
                  180 + finiteParameter(node, 'phaseErrorDeg'),
                  finiteParameter(node, 'isolationDb'),
                  referenceImpedanceOhm,
                  node.data.label,
                )
            : createIdealDivider(
                frequencyHz,
                node.data.type === 'idealSplitter' ? 0 : 2,
                finiteParameter(node, 'excessLossDb'),
                finiteParameter(node, 'amplitudeImbalanceDb'),
                finiteParameter(node, 'phaseImbalanceDeg'),
                finiteParameter(node, 'isolationDb'),
                referenceImpedanceOhm,
                node.data.label,
              )
      const evaluatedDivider = { ...divider, frequencyHz }
      blocks.push({
        nodeId: node.id,
        portIds,
        network: evaluatedDivider,
        noiseCorrelationAt: (pointIndex) =>
          passiveNoiseCorrelationAt(evaluatedDivider, pointIndex),
      })
      continue
    }
    const network =
      node.data.type === 'probe'
        ? createThroughNetwork(
            frequencyHz,
            referenceImpedanceOhm,
            node.data.label,
          )
        : networkForNode(
            node,
            frequencyHz,
            localFrequencyOffsetsHz.get(node.id) ?? 0,
            referenceImpedanceOhm,
            parsedNetworks,
            deviceTables,
          )
    blocks.push({
      nodeId: node.id,
      portIds,
      network: twoPortToNPort(network),
      noiseCorrelationAt: (pointIndex) =>
        noiseCorrelationForTwoPortNode(
          node,
          network,
          pointIndex,
          localFrequencyOffsetsHz.get(node.id) ?? 0,
          deviceTables.get(node.id),
          noiseParameters.get(node.id),
          referenceImpedanceOhm,
        ),
    })
  }

  const connections: NetworkConnection[] = []
  let externalInput: NetworkPortReference | undefined
  let externalOutput: NetworkPortReference | undefined
  for (const edge of input.edges) {
    const source = nodesById.get(edge.source)!
    const target = nodesById.get(edge.target)!
    const sourcePort = resolveEdgePort(source, 'output', edge.sourceHandle)!
    const targetPort = resolveEdgePort(target, 'input', edge.targetHandle)!
    if (isSourceTerminal(source)) {
      externalInput = { nodeId: target.id, portId: targetPort.id }
    } else if (isLoadTerminal(target)) {
      externalOutput = { nodeId: source.id, portId: sourcePort.id }
    } else {
      connections.push({
        first: { nodeId: source.id, portId: sourcePort.id },
        second: { nodeId: target.id, portId: targetPort.id },
      })
    }
  }
  if (!externalInput || !externalOutput) {
    throw new SimulationError('Branched network external ports are missing.')
  }
  const total = solveNPortInterconnection(
    blocks,
    connections,
    externalInput,
    externalOutput,
    referenceImpedanceOhm,
  )
  const probeResults = orderedNodes
    .filter((node) => node.data.type === 'probe')
    .map((node): SimulationProbeResult => ({
      nodeId: node.id,
      label: node.data.label,
      s21Db: magnitudeDbArray(
        solveNPortWaveAt(
          blocks,
          connections,
          externalInput,
          externalOutput,
          { nodeId: node.id, portId: 'output' },
          referenceImpedanceOhm,
        ),
      ),
    }))
  const curves = deriveSimulationCurves(total)
  warnings.push(...curves.warnings, {
    code: 'BRANCHED_NETWORK_MODEL',
    message:
      'The N-port solver includes coherent branch recombination, mismatch, internal reflections, passive/declared noise waves, internal probe waves, and frequency-converting envelope paths when all signals meeting at a combiner have the same translated frequency. Branch-aware compression remains a behavioral approximation.',
  })
  const source = orderedNodes.find(isSourceTerminal)!
  const load = orderedNodes.find(isLoadTerminal)!
  const centerIndex = operatingPointIndex(frequencyHz, source)
  const sourceImpedanceOhm = impedanceParameter(
    source,
    'sourceImpedanceOhm',
    referenceImpedanceOhm,
  )
  const loadImpedanceOhm = impedanceParameter(
    load,
    'loadImpedanceOhm',
    referenceImpedanceOhm,
  )
  const noiseCorrelation = solveNPortNoiseCorrelationAt(
    blocks,
    connections,
    externalInput,
    externalOutput,
    referenceImpedanceOhm,
    centerIndex,
  )
  const cascadedNoiseFigureDb = noiseCorrelation
    ? noiseFigureFromCorrelation(
        total,
        centerIndex,
        noiseCorrelation,
        sourceImpedanceOhm,
        loadImpedanceOhm,
      )
    : null
  const equivalentStage = branchedEquivalentNonlinearStage(
    orderedNodes,
    blocks,
    connections,
    externalInput,
    externalOutput,
    total,
    centerIndex,
    sourceImpedanceOhm,
    loadImpedanceOhm,
    referenceImpedanceOhm,
    localFrequencyOffsetsHz,
    deviceTables,
    cascadedNoiseFigureDb,
  )
  const budgetStages = equivalentStage ? [equivalentStage] : []
  const budget = calculateRFBudget(
    frequencyHz[centerIndex]!,
    optionalFiniteParameter(source, 'powerDbm'),
    budgetStages,
    {
      network: total,
      pointIndex: centerIndex,
      sourceImpedanceOhm,
      loadImpedanceOhm,
      noiseFigureDb: cascadedNoiseFigureDb,
    },
  )
  const frequencyPlan = calculateFrequencyPlan(
    frequencyHz,
    [],
    optionalFiniteParameter(source, 'powerDbm'),
    sourceOperatingFrequency(source),
  )
  const outputOffsetHz = localFrequencyOffsetsHz.get(load.id) ?? 0
  if (outputOffsetHz !== 0) {
    frequencyPlan.outputFrequencyHz = Float64Array.from(
      frequencyHz,
      (value) => value + outputOffsetHz,
    )
    frequencyPlan.output = {
      startHz: frequencyPlan.outputFrequencyHz[0]!,
      centerHz: frequencyPlan.input.centerHz + outputOffsetHz,
      stopHz: frequencyPlan.outputFrequencyHz.at(-1)!,
    }
    frequencyPlan.spectralLines = [
      {
        frequencyHz: frequencyPlan.output.centerHz,
        powerDbm: budget.deliveredLoadPowerDbm,
        phaseDeg: null,
        path: 'Coherent branched conversion envelope',
      },
    ]
  }
  return {
    total,
    curves: curves.curves,
    networkChecks: calculateNetworkChecks(total),
    stageSummaries: [],
    probeResults,
    budget,
    nonlinear: calculateNonlinearSweep(
      budget,
      budgetStages,
      frequencyPlan.output.centerHz,
      optionalFiniteParameter(source, 'twoToneSpacingHz', 1) ??
        DEFAULT_TWO_TONE_SPACING_HZ,
    ),
    frequencyPlan,
    monteCarlo: emptyMonteCarlo(input.analysis),
    parametricSweep: emptyParametricSweep(input.analysis),
    warnings,
  }
}

function branchedEquivalentNonlinearStage(
  nodes: RFProjectNode[],
  blocks: NetworkBlock[],
  connections: NetworkConnection[],
  externalInput: NetworkPortReference,
  externalOutput: NetworkPortReference,
  total: TwoPortNetwork,
  centerIndex: number,
  sourceImpedanceOhm: number,
  loadImpedanceOhm: number,
  referenceImpedanceOhm: number,
  localFrequencyOffsetsHz: Map<string, number>,
  deviceTables: Map<string, DeviceTable>,
  noiseFigureDb: number | null,
): BudgetStageInput | null {
  const totalGainDb = calculateTransducerGain(
    total,
    centerIndex,
    sourceImpedanceOhm,
    loadImpedanceOhm,
  ).transducerGainDb
  let inputP1Dbm = Number.POSITIVE_INFINITY
  let reciprocalIp3 = { re: 0, im: 0 }
  let nonlinearBlockCount = 0
  for (const node of nodes) {
    const block = blocks.find((candidate) => candidate.nodeId === node.id)
    if (!block || block.network.portCount !== 2) continue
    const network = nPortToTwoPort(block.network)
    const metadata = budgetStage(
      node,
      network,
      localFrequencyOffsetsHz.get(node.id) ?? 0,
      deviceTables.get(node.id),
    )
    if (
      !Number.isFinite(metadata.outputP1Dbm) &&
      !Number.isFinite(metadata.outputIp3Dbm)
    ) {
      continue
    }
    const inputPort = portsForNode(node).find((port) => port.role === 'input')
    if (!inputPort || metadata.gainDb === null) continue
    const incident = solveNPortIncidentWaveAt(
      blocks,
      connections,
      externalInput,
      externalOutput,
      { nodeId: node.id, portId: inputPort.id },
      referenceImpedanceOhm,
    )
    const incidentPower =
      incident.re[centerIndex]! ** 2 + incident.im[centerIndex]! ** 2
    if (!(incidentPower > 0)) continue
    const inputTransferDb = 10 * Math.log10(incidentPower)
    if (Number.isFinite(metadata.outputP1Dbm)) {
      inputP1Dbm = Math.min(
        inputP1Dbm,
        metadata.outputP1Dbm! + 1 - metadata.gainDb - inputTransferDb,
      )
    }
    if (Number.isFinite(metadata.outputIp3Dbm)) {
      const referredInputIp3Dbm =
        metadata.outputIp3Dbm! - metadata.gainDb - inputTransferDb
      const magnitude = 1 / 10 ** (referredInputIp3Dbm / 10)
      const phaseRad = ((metadata.im3PhaseDeg ?? 0) * Math.PI) / 180
      reciprocalIp3 = {
        re: reciprocalIp3.re + magnitude * Math.cos(phaseRad),
        im: reciprocalIp3.im + magnitude * Math.sin(phaseRad),
      }
    }
    nonlinearBlockCount += 1
  }
  if (nonlinearBlockCount === 0) return null
  const reciprocalIp3Magnitude = Math.hypot(reciprocalIp3.re, reciprocalIp3.im)
  const inputIp3Dbm =
    reciprocalIp3Magnitude > 0
      ? 10 * Math.log10(1 / reciprocalIp3Magnitude)
      : Number.POSITIVE_INFINITY
  return {
    nodeId: 'branched-equivalent',
    label: 'Equivalent branched network',
    type: 'idealAmplifier',
    gainDb: totalGainDb,
    noiseFigureDb,
    outputP1Dbm: Number.isFinite(inputP1Dbm)
      ? inputP1Dbm + totalGainDb - 1
      : null,
    outputIp3Dbm: Number.isFinite(inputIp3Dbm)
      ? inputIp3Dbm + totalGainDb
      : inputIp3Dbm,
    im3PhaseDeg:
      (Math.atan2(reciprocalIp3.im, reciprocalIp3.re) * 180) / Math.PI,
  }
}

function budgetStage(
  node: RFProjectNode,
  network: TwoPortNetwork,
  localFrequencyOffsetHz: number,
  deviceTable?: DeviceTable,
  noiseParameters?: {
    data: TouchstoneNoiseData
    referenceImpedanceOhm: number
  },
  noiseSourceImpedanceOhm?: number,
): BudgetStageInput {
  const centerIndex = Math.floor(network.frequencyHz.length / 2)
  const gainDb = magnitudeDb({
    re: network.s21.re[centerIndex]!,
    im: network.s21.im[centerIndex]!,
  })
  const stageGainDb = Number.isFinite(gainDb) ? gainDb : null
  const localCenterFrequencyHz =
    network.frequencyHz[centerIndex]! + localFrequencyOffsetHz

  if (isPassiveIdealTwoPort(node)) {
    return {
      nodeId: node.id,
      label: node.data.label,
      type: node.data.type,
      gainDb: stageGainDb,
      noiseFigureDb: stageGainDb === null ? null : Math.max(0, -stageGainDb),
      outputP1Dbm: Number.POSITIVE_INFINITY,
      outputIp3Dbm: Number.POSITIVE_INFINITY,
    }
  }
  return {
    nodeId: node.id,
    label: node.data.label,
    type: node.data.type,
    gainDb: stageGainDb,
    noiseFigureDb:
      (noiseParameters &&
      noiseSourceImpedanceOhm &&
      localCenterFrequencyHz >= noiseParameters.data.frequencyHz[0]! &&
      localCenterFrequencyHz <= noiseParameters.data.frequencyHz.at(-1)!
        ? noiseFigureFromParameters(
            noiseParameters.data,
            localCenterFrequencyHz,
            noiseSourceImpedanceOhm,
            noiseParameters.referenceImpedanceOhm,
          )
        : deviceTable
          ? deviceMetricAt(deviceTable, 'noiseFigureDb', localCenterFrequencyHz)
          : null) ?? optionalFiniteParameter(node, 'noiseFigureDb', 0),
    outputP1Dbm:
      (deviceTable
        ? deviceMetricAt(deviceTable, 'outputP1Dbm', localCenterFrequencyHz)
        : null) ?? optionalFiniteParameter(node, 'outputP1Dbm'),
    outputIp3Dbm:
      (deviceTable
        ? deviceMetricAt(deviceTable, 'outputIp3Dbm', localCenterFrequencyHz)
        : null) ?? optionalFiniteParameter(node, 'outputIp3Dbm'),
    im3PhaseDeg: optionalFiniteParameter(node, 'im3PhaseDeg'),
    powerTransfer: deviceTable
      ? devicePowerTransferAt(deviceTable, localCenterFrequencyHz)
      : null,
  }
}

function noiseCorrelationForTwoPortNode(
  node: RFProjectNode,
  network: TwoPortNetwork,
  pointIndex: number,
  localFrequencyOffsetHz: number,
  deviceTable: DeviceTable | undefined,
  noiseParameters:
    { data: TouchstoneNoiseData; referenceImpedanceOhm: number } | undefined,
  analysisReferenceImpedanceOhm: number,
): ComplexValue[] | null {
  const localFrequencyHz =
    network.frequencyHz[pointIndex]! + localFrequencyOffsetHz
  if (
    noiseParameters &&
    Math.abs(
      noiseParameters.referenceImpedanceOhm - analysisReferenceImpedanceOhm,
    ) <=
      Math.max(
        1,
        noiseParameters.referenceImpedanceOhm,
        analysisReferenceImpedanceOhm,
      ) *
        1e-12 &&
    localFrequencyHz >= noiseParameters.data.frequencyHz[0]! &&
    localFrequencyHz <= noiseParameters.data.frequencyHz.at(-1)!
  ) {
    return touchstoneNoiseCorrelationAt(
      network,
      pointIndex,
      noiseParameters.data,
      localFrequencyHz,
      noiseParameters.referenceImpedanceOhm,
    )
  }
  if (isPassiveIdealTwoPort(node)) {
    return passiveNoiseCorrelationAt(twoPortToNPort(network), pointIndex)
  }
  const noiseFigureDb =
    (deviceTable
      ? deviceMetricAt(deviceTable, 'noiseFigureDb', localFrequencyHz)
      : null) ?? optionalFiniteParameter(node, 'noiseFigureDb', 0)
  if (noiseFigureDb !== null) {
    return outputNoiseCorrelationAt(network, pointIndex, noiseFigureDb)
  }
  return passiveNoiseCorrelationAt(twoPortToNPort(network), pointIndex)
}

function networkForNode(
  node: RFProjectNode,
  frequencyHz: Float64Array,
  localFrequencyOffsetHz: number,
  referenceImpedanceOhm: number,
  parsedNetworks: Map<string, TwoPortNetwork>,
  deviceTables: Map<string, DeviceTable>,
): TwoPortNetwork {
  switch (node.data.type) {
    case 'touchstone2Port': {
      const network = parsedNetworks.get(node.id)
      if (!network)
        throw new SimulationError(
          `Missing parsed network for "${node.data.label}".`,
        )
      return interpolateLocalNetwork(
        network,
        frequencyHz,
        localFrequencyOffsetHz,
      )
    }
    case 'idealAmplifier': {
      const network = parsedNetworks.get(node.id)
      if (network) {
        return interpolateLocalNetwork(
          network,
          frequencyHz,
          localFrequencyOffsetHz,
        )
      }
      const table = deviceTables.get(node.id)
      if (table) {
        const localFrequencyHz = Float64Array.from(
          frequencyHz,
          (value) => value + localFrequencyOffsetHz,
        )
        const gainDb = Float64Array.from(localFrequencyHz, (value) => {
          const gain = deviceMetricAt(table, 'gainDb', value)
          return gain ?? finiteParameter(node, 'gainDb')
        })
        return createTabulatedAmplifier(
          frequencyHz,
          gainDb,
          finiteParameter(node, 'phaseDeg'),
          referenceImpedanceOhm,
          node.data.label,
        )
      }
      return createIdealAmplifier(
        frequencyHz,
        finiteParameter(node, 'gainDb'),
        finiteParameter(node, 'phaseDeg'),
        referenceImpedanceOhm,
        node.data.label,
      )
    }
    case 'idealAttenuator':
      return createIdealAttenuator(
        frequencyHz,
        finiteParameter(node, 'attenuationDb'),
        finiteParameter(node, 'phaseDeg'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'idealFilter': {
      const type = filterType(node)
      const localFrequencyHz = Float64Array.from(
        frequencyHz,
        (value) => value + localFrequencyOffsetHz,
      )
      const network = createIdealFilter(
        localFrequencyHz,
        type,
        finiteParameter(
          node,
          type === 'lowpass' || type === 'highpass'
            ? 'cutoffFrequencyHz'
            : 'centerFrequencyHz',
        ),
        finiteParameter(node, 'bandwidthHz'),
        finiteParameter(node, 'order'),
        finiteParameter(node, 'insertionLossDb'),
        referenceImpedanceOhm,
        node.data.label,
      )
      return { ...network, frequencyHz }
    }
    case 'idealPhaseShifter':
      return createIdealPhaseShifter(
        frequencyHz,
        finiteParameter(node, 'phaseDeg'),
        finiteParameter(node, 'insertionLossDb'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'idealIsolator':
      return createIdealIsolator(
        frequencyHz,
        finiteParameter(node, 'forwardLossDb'),
        finiteParameter(node, 'reverseIsolationDb'),
        finiteParameter(node, 'phaseDeg'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'idealRFSwitch':
      return createIdealRFSwitch(
        frequencyHz,
        node.data.parameters.enabled === true,
        finiteParameter(node, 'insertionLossDb'),
        finiteParameter(node, 'isolationDb'),
        finiteParameter(node, 'phaseDeg'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'transmissionLine':
      return createTransmissionLine(
        frequencyHz,
        finiteParameter(node, 'delayS'),
        finiteParameter(node, 'insertionLossDb'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'matchingNetwork':
      return createMatchingNetwork(
        frequencyHz,
        matchingTopology(node),
        matchingResponse(node),
        finiteParameter(node, 'inductanceH'),
        finiteParameter(node, 'capacitanceF'),
        finiteParameter(node, 'componentQ'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'idealMixer':
      return createIdealAttenuator(
        frequencyHz,
        finiteParameter(node, 'conversionLossDb'),
        selectedMixerPhaseDeg(node),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'idealSplitter':
    case 'idealCombiner':
    case 'idealDirectionalCoupler':
    case 'idealDiplexer':
    case 'idealBalun':
      throw new SimulationError(
        `Block "${node.data.label}" must be evaluated by the N-port graph solver.`,
      )
    case 'probe':
    case 'source':
    case 'load':
    case 'vcoSource':
    case 'rxAntenna':
    case 'txAntenna':
      throw new SimulationError(
        `Block "${node.data.label}" is not a two-port stage.`,
      )
  }
}

function selectedMixerPhaseDeg(node: RFProjectNode): number {
  const content = node.data.parameters.productTableContent
  if (typeof content !== 'string') return 0
  const desiredLoCoefficient = mixerMode(node) === 'downconvert' ? -1 : 1
  return (
    parseMixerProductCsv(content).find(
      (product) =>
        product.inputCoefficient === 1 &&
        product.loCoefficient === desiredLoCoefficient,
    )?.phaseDeg ?? 0
  )
}

function calculateLocalFrequencyOffsets(
  orderedNodes: RFProjectNode[],
  edges: SimulationInput['edges'],
): Map<string, number> {
  const outputOffsets = new Map<string, number>()
  const inputOffsets = new Map<string, number>()
  for (const node of orderedNodes) {
    const incoming = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => outputOffsets.get(edge.source))
      .filter((value): value is number => value !== undefined)
    const inputOffset = incoming[0] ?? 0
    if (
      incoming.some(
        (value) =>
          Math.abs(value - inputOffset) >
          Math.max(1, Math.abs(value), Math.abs(inputOffset)) * 1e-12,
      )
    ) {
      throw new SimulationError(
        `${node.data.label}: branches meeting at this block have different translated frequencies. Add a mixer so the bands coincide before recombination.`,
      )
    }
    inputOffsets.set(node.id, inputOffset)
    outputOffsets.set(
      node.id,
      inputOffset +
        (node.data.type === 'idealMixer'
          ? (mixerMode(node) === 'upconvert' ? 1 : -1) *
            finiteParameter(node, 'loFrequencyHz')
          : 0),
    )
  }
  return inputOffsets
}

function interpolateLocalNetwork(
  network: TwoPortNetwork,
  frequencyHz: Float64Array,
  localFrequencyOffsetHz: number,
): TwoPortNetwork {
  const localFrequencyHz = Float64Array.from(
    frequencyHz,
    (value) => value + localFrequencyOffsetHz,
  )
  localFrequencyHz[0] = Math.max(localFrequencyHz[0]!, network.frequencyHz[0]!)
  localFrequencyHz[localFrequencyHz.length - 1] = Math.min(
    localFrequencyHz.at(-1)!,
    network.frequencyHz.at(-1)!,
  )
  return { ...interpolateNetwork(network, localFrequencyHz), frequencyHz }
}

function summarizeStage(
  node: RFProjectNode,
  cumulative: TwoPortNetwork,
  centerIndex: number,
): SimulationStageSummary {
  return {
    nodeId: node.id,
    label: node.data.label,
    s21DbAtCenter: magnitudeDb({
      re: cumulative.s21.re[centerIndex]!,
      im: cumulative.s21.im[centerIndex]!,
    }),
  }
}

function validateBlockReferenceImpedances(
  nodes: RFProjectNode[],
  expectedOhm: number,
): void {
  for (const node of nodes) {
    if (
      node.data.type !== 'idealAmplifier' &&
      node.data.type !== 'idealAttenuator' &&
      node.data.type !== 'idealFilter' &&
      node.data.type !== 'idealPhaseShifter' &&
      node.data.type !== 'idealIsolator' &&
      node.data.type !== 'idealRFSwitch' &&
      node.data.type !== 'idealDirectionalCoupler' &&
      node.data.type !== 'idealDiplexer' &&
      node.data.type !== 'transmissionLine' &&
      node.data.type !== 'matchingNetwork' &&
      node.data.type !== 'idealBalun' &&
      node.data.type !== 'idealMixer' &&
      node.data.type !== 'idealSplitter' &&
      node.data.type !== 'idealCombiner' &&
      !isLoadTerminal(node)
    ) {
      continue
    }
    assertReferenceImpedance(
      finiteParameter(node, 'referenceImpedanceOhm'),
      expectedOhm,
      node.data.label,
    )
  }
}

function mixerMode(node: RFProjectNode): 'downconvert' | 'upconvert' {
  const value = node.data.parameters.mixerMode
  if (value !== 'downconvert' && value !== 'upconvert') {
    throw new SimulationError(`Mixer mode is invalid at "${node.data.label}".`)
  }
  return value
}

function filterType(node: RFProjectNode): IdealFilterType {
  const value = node.data.parameters.filterType
  if (
    value !== 'lowpass' &&
    value !== 'highpass' &&
    value !== 'bandpass' &&
    value !== 'bandstop'
  ) {
    throw new SimulationError(`Filter type is invalid at "${node.data.label}".`)
  }
  return value
}

function matchingTopology(node: RFProjectNode): MatchingTopology {
  const value = node.data.parameters.topology
  if (value !== 'l' && value !== 'pi' && value !== 't') {
    throw new SimulationError(
      `Matching topology is invalid at "${node.data.label}".`,
    )
  }
  return value
}

function matchingResponse(node: RFProjectNode): MatchingResponse {
  const value = node.data.parameters.response
  if (value !== 'lowpass' && value !== 'highpass') {
    throw new SimulationError(
      `Matching response is invalid at "${node.data.label}".`,
    )
  }
  return value
}

function isPassiveIdealTwoPort(node: RFProjectNode): boolean {
  return (
    node.data.type === 'idealAttenuator' ||
    node.data.type === 'idealFilter' ||
    node.data.type === 'idealPhaseShifter' ||
    node.data.type === 'idealIsolator' ||
    node.data.type === 'idealRFSwitch' ||
    node.data.type === 'transmissionLine' ||
    node.data.type === 'matchingNetwork'
  )
}

function operatingPointIndex(
  frequencyHz: Float64Array,
  source: RFProjectNode,
): number {
  const requested = sourceOperatingFrequency(source)
  if (requested === null) {
    return Math.floor(frequencyHz.length / 2)
  }
  let nearest = 0
  for (let index = 1; index < frequencyHz.length; index += 1) {
    if (
      Math.abs(frequencyHz[index]! - requested) <
      Math.abs(frequencyHz[nearest]! - requested)
    ) {
      nearest = index
    }
  }
  return nearest
}

function sourceOperatingFrequency(source: RFProjectNode): number | null {
  const requested =
    source.data.type === 'vcoSource'
      ? Number(source.data.parameters.freeRunningFrequencyHz) +
        Number(source.data.parameters.tuningSensitivityHzPerV) *
          Number(source.data.parameters.controlVoltageV)
      : source.data.parameters.centerFrequencyHz
  return typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : null
}

function assertReferenceImpedance(
  actualOhm: number,
  expectedOhm: number,
  label: string,
): void {
  if (
    !Number.isFinite(expectedOhm) ||
    expectedOhm <= 0 ||
    Math.abs(actualOhm - expectedOhm) >
      Math.max(1, actualOhm, expectedOhm) * 1e-12
  ) {
    throw new SimulationError(
      `Reference impedance mismatch at "${label}": ${actualOhm} Ω versus analysis ${expectedOhm} Ω.`,
    )
  }
}

function referencesMatch(
  referencesOhm: Float64Array,
  expectedOhm: number,
): boolean {
  return Array.from(referencesOhm).every(
    (actualOhm) =>
      Math.abs(actualOhm - expectedOhm) <=
      Math.max(1, actualOhm, expectedOhm) * 1e-12,
  )
}

function finiteParameter(node: RFProjectNode, key: string): number {
  const value = node.data.parameters[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SimulationError(
      `Parameter "${key}" is invalid at "${node.data.label}".`,
    )
  }
  return value
}

function optionalFiniteParameter(
  node: RFProjectNode,
  key: string,
  minimum?: number,
): number | null {
  const value = node.data.parameters[key]
  if (value === undefined || value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new SimulationError(
      `Optional parameter "${key}" is invalid at "${node.data.label}".`,
    )
  }
  return value
}

function impedanceParameter(
  node: RFProjectNode,
  key: string,
  fallback: number,
): number {
  const value = node.data.parameters[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new SimulationError(
      `Impedance parameter "${key}" is invalid at "${node.data.label}".`,
    )
  }
  return value
}

const TOLERANCE_PARAMETERS = [
  ['gainDb', 'gainToleranceDb', false],
  ['phaseDeg', 'phaseToleranceDeg', false],
  ['noiseFigureDb', 'noiseFigureToleranceDb', true],
  ['outputP1Dbm', 'outputP1ToleranceDb', false],
  ['outputIp3Dbm', 'outputIp3ToleranceDb', false],
  ['attenuationDb', 'attenuationToleranceDb', true],
  ['insertionLossDb', 'insertionLossToleranceDb', true],
  ['forwardLossDb', 'forwardLossToleranceDb', true],
  ['conversionLossDb', 'conversionLossToleranceDb', true],
  ['excessLossDb', 'excessLossToleranceDb', true],
  ['amplitudeImbalanceDb', 'amplitudeImbalanceToleranceDb', false],
  ['phaseImbalanceDeg', 'phaseImbalanceToleranceDeg', false],
  ['sourceImpedanceOhm', 'sourceImpedanceToleranceOhm', true],
  ['loadImpedanceOhm', 'loadImpedanceToleranceOhm', true],
] as const

function calculateMonteCarlo(
  input: SimulationInput,
): SimulationOutput['monteCarlo'] {
  const runs = input.analysis.monteCarloRuns ?? 0
  const seed = input.analysis.monteCarloSeed ?? 1
  if (!Number.isInteger(runs) || runs < 0 || runs > 500) {
    throw new SimulationError(
      'Monte Carlo runs must be an integer from 0 to 500.',
    )
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new SimulationError(
      'Monte Carlo seed must be a 32-bit unsigned integer.',
    )
  }
  if (runs < 2) return emptyMonteCarlo(input.analysis)

  const random = seededRandom(seed)
  const samples = new Map<MonteCarloMetricSummary['key'], number[]>([
    ['s21Db', []],
    ['noiseFigureDb', []],
    ['inputP1Dbm', []],
    ['loadPowerDbm', []],
  ])
  const parameterSamples = new Map<string, number[]>()
  const constraint = constraintFromAnalysis(input.analysis)
  let evaluatedConstraintRuns = 0
  let passingRuns = 0
  const centerHz = (input.analysis.startHz + input.analysis.stopHz) / 2
  const halfSpanHz = Math.max(
    1,
    (input.analysis.stopHz - input.analysis.startHz) * 1e-6,
  )
  for (let run = 0; run < runs; run += 1) {
    const sampledNodes = input.nodes.map((node) => {
      const parameters = { ...node.data.parameters }
      for (const [
        valueKey,
        toleranceKey,
        clampPositive,
      ] of TOLERANCE_PARAMETERS) {
        const nominal = parameters[valueKey]
        const tolerance = parameters[toleranceKey]
        if (tolerance === undefined || tolerance === null) continue
        if (
          typeof tolerance !== 'number' ||
          !Number.isFinite(tolerance) ||
          tolerance < 0
        ) {
          throw new SimulationError(
            `${node.data.label}: tolerance "${toleranceKey}" must be non-negative.`,
          )
        }
        if (typeof nominal !== 'number' || !Number.isFinite(nominal)) continue
        const sampled = nominal + tolerance * standardNormal(random)
        parameters[valueKey] = clampPositive
          ? Math.max(1e-12, sampled)
          : sampled
        const key = `${node.data.label}: ${valueKey}`
        const values = parameterSamples.get(key) ?? []
        values.push(parameters[valueKey] as number)
        parameterSamples.set(key, values)
      }
      return { ...node, data: { ...node.data, parameters } }
    })
    const output = simulateDeterministic({
      ...input,
      nodes: sampledNodes,
      analysis: {
        ...input.analysis,
        startHz: centerHz - halfSpanHz,
        stopHz: centerHz + halfSpanHz,
        points: 3,
        monteCarloRuns: 0,
      },
    })
    const centerIndex = 1
    pushSample(samples.get('s21Db')!, output.curves.s21Db[centerIndex])
    pushSample(
      samples.get('noiseFigureDb')!,
      output.budget.cascadedNoiseFigureDb,
    )
    pushSample(samples.get('inputP1Dbm')!, output.nonlinear.inputP1Dbm)
    pushSample(
      samples.get('loadPowerDbm')!,
      output.budget.deliveredLoadPowerDbm,
    )
    if (constraint) {
      const value = parametricMetric(output, constraint.metric)
      if (Number.isFinite(value)) {
        evaluatedConstraintRuns += 1
        if (constraintSatisfied(value, constraint)) passingRuns += 1
      }
    }
  }
  const definitions = [
    ['s21Db', 'Center S21', 'dB'],
    ['noiseFigureDb', 'Cascaded noise figure', 'dB'],
    ['inputP1Dbm', 'Input P1dB', 'dBm'],
    ['loadPowerDbm', 'Delivered load power', 'dBm'],
  ] as const
  const metrics = definitions.flatMap(([key, label, unit]) => {
    const values = samples.get(key)!.filter(Number.isFinite)
    return values.length < 2 ? [] : [summarizeSamples(key, label, unit, values)]
  })
  const metricLabels = new Map(
    metrics.map((metric) => [metric.key, metric.label]),
  )
  const sensitivities: MonteCarloSensitivity[] = []
  for (const [parameter, parameterValues] of parameterSamples) {
    for (const [metricKey, metricValues] of samples) {
      const correlation = pearsonCorrelation(parameterValues, metricValues)
      if (correlation !== null) {
        sensitivities.push({
          parameter,
          metricKey,
          metricLabel: metricLabels.get(metricKey) ?? metricKey,
          correlation,
        })
      }
    }
  }
  sensitivities.sort(
    (left, right) => Math.abs(right.correlation) - Math.abs(left.correlation),
  )
  return {
    available: metrics.length > 0,
    runs,
    seed,
    metrics,
    sensitivities: sensitivities.slice(0, 20),
    yieldPercent:
      constraint && evaluatedConstraintRuns > 0
        ? (100 * passingRuns) / evaluatedConstraintRuns
        : null,
    passingRuns: constraint ? passingRuns : null,
  }
}

function emptyMonteCarlo(
  analysis: RFAnalysisSettings,
): SimulationOutput['monteCarlo'] {
  return {
    available: false,
    runs: analysis.monteCarloRuns ?? 0,
    seed: analysis.monteCarloSeed ?? 1,
    metrics: [],
    sensitivities: [],
    yieldPercent: null,
    passingRuns: null,
  }
}

function summarizeSamples(
  key: MonteCarloMetricSummary['key'],
  label: string,
  unit: MonteCarloMetricSummary['unit'],
  values: number[],
): MonteCarloMetricSummary {
  values.sort((left, right) => left - right)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1)
  return {
    key,
    label,
    unit,
    mean,
    standardDeviation: Math.sqrt(variance),
    percentile05: quantile(values, 0.05),
    percentile50: quantile(values, 0.5),
    percentile95: quantile(values, 0.95),
  }
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return sorted[lower]! + weight * (sorted[upper]! - sorted[lower]!)
}

function pushSample(
  destination: number[],
  value: number | null | undefined,
): void {
  destination.push(
    typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN,
  )
}

function pearsonCorrelation(left: number[], right: number[]): number | null {
  const pairs = left.flatMap((value, index) =>
    Number.isFinite(value) && Number.isFinite(right[index])
      ? [[value, right[index]!] as const]
      : [],
  )
  if (pairs.length < 3) return null
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length
  let numerator = 0
  let leftVariance = 0
  let rightVariance = 0
  for (const [leftValue, rightValue] of pairs) {
    const leftDelta = leftValue - leftMean
    const rightDelta = rightValue - rightMean
    numerator += leftDelta * rightDelta
    leftVariance += leftDelta * leftDelta
    rightVariance += rightDelta * rightDelta
  }
  const denominator = Math.sqrt(leftVariance * rightVariance)
  return denominator > 0 ? numerator / denominator : null
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function standardNormal(random: () => number): number {
  const first = Math.max(Number.MIN_VALUE, random())
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random())
}

function calculateParametricSweep(
  input: SimulationInput,
): SimulationOutput['parametricSweep'] {
  if (
    !input.analysis.sweepSecondNodeId &&
    !input.analysis.sweepConstraintMetric
  ) {
    return calculateOneDimensionalSweep(input)
  }
  return calculateConstrainedGridOptimization(input)
}

function calculateOneDimensionalSweep(
  input: SimulationInput,
): SimulationOutput['parametricSweep'] {
  const nodeId = input.analysis.sweepNodeId
  const parameter = input.analysis.sweepParameter
  if (!nodeId || !parameter) return emptyParametricSweep(input.analysis)
  const node = input.nodes.find((candidate) => candidate.id === nodeId)
  if (!node)
    throw new SimulationError('Parametric-sweep node no longer exists.')
  if (!sweepParameterIsEffective(node, parameter)) {
    throw new SimulationError(
      `Cannot sweep "${parameter}" on "${node.data.label}" because imported measured data overrides that fallback parameter.`,
    )
  }
  const nominal = node.data.parameters[parameter]
  const start = input.analysis.sweepStart
  const stop = input.analysis.sweepStop
  const points = input.analysis.sweepPoints ?? 11
  const metric = input.analysis.sweepMetric ?? 's21Db'
  const objective =
    input.analysis.sweepObjective ??
    (metric === 'noiseFigureDb' ? 'minimize' : 'maximize')
  if (
    typeof nominal !== 'number' ||
    !Number.isFinite(nominal) ||
    typeof start !== 'number' ||
    !Number.isFinite(start) ||
    typeof stop !== 'number' ||
    !Number.isFinite(stop) ||
    start >= stop ||
    !Number.isInteger(points) ||
    points < 2 ||
    points > 101
  ) {
    throw new SimulationError(
      'Parametric sweep requires a numeric parameter, start < stop, and 2–101 points.',
    )
  }
  const parameterValues = new Float64Array(points)
  const metricValues = new Float64Array(points)
  const centerHz = (input.analysis.startHz + input.analysis.stopHz) / 2
  const halfSpanHz = Math.max(
    1,
    (input.analysis.stopHz - input.analysis.startHz) * 1e-6,
  )
  for (let index = 0; index < points; index += 1) {
    const value = start + ((stop - start) * index) / (points - 1)
    parameterValues[index] = value
    const output = simulateDeterministic({
      ...input,
      nodes: input.nodes.map((candidate) =>
        candidate.id === nodeId
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                parameters: {
                  ...candidate.data.parameters,
                  [parameter]: value,
                },
              },
            }
          : candidate,
      ),
      analysis: {
        ...input.analysis,
        startHz: centerHz - halfSpanHz,
        stopHz: centerHz + halfSpanHz,
        points: 3,
        monteCarloRuns: 0,
        sweepNodeId: null,
        sweepParameter: null,
      },
    })
    metricValues[index] = parametricMetric(output, metric)
  }
  let bestIndex = -1
  for (let index = 0; index < points; index += 1) {
    if (!Number.isFinite(metricValues[index])) continue
    if (
      bestIndex < 0 ||
      (objective === 'maximize'
        ? metricValues[index]! > metricValues[bestIndex]!
        : metricValues[index]! < metricValues[bestIndex]!)
    ) {
      bestIndex = index
    }
  }
  return {
    available: bestIndex >= 0,
    nodeId,
    nodeLabel: node.data.label,
    parameter,
    metric,
    objective,
    parameterValues,
    metricValues,
    bestParameterValue: bestIndex < 0 ? null : parameterValues[bestIndex]!,
    bestMetricValue: bestIndex < 0 ? null : metricValues[bestIndex]!,
    variables: [
      {
        nodeId,
        nodeLabel: node.data.label,
        parameter,
        start,
        stop,
        points,
      },
    ],
    samples: Array.from(parameterValues, (value, index) => ({
      parameterValues: [value],
      metricValue: metricValues[index]!,
      constraintValue: null,
      feasible: Number.isFinite(metricValues[index]),
    })),
    bestParameterValues: bestIndex < 0 ? [] : [parameterValues[bestIndex]!],
    constraint: null,
  }
}

function calculateConstrainedGridOptimization(
  input: SimulationInput,
): SimulationOutput['parametricSweep'] {
  const variables = [
    optimizationVariable(
      input,
      input.analysis.sweepNodeId,
      input.analysis.sweepParameter,
      input.analysis.sweepStart,
      input.analysis.sweepStop,
      input.analysis.sweepPoints ?? 11,
      101,
    ),
    optimizationVariable(
      input,
      input.analysis.sweepSecondNodeId,
      input.analysis.sweepSecondParameter,
      input.analysis.sweepSecondStart,
      input.analysis.sweepSecondStop,
      input.analysis.sweepSecondPoints ?? 5,
      51,
    ),
  ].filter((variable) => variable !== null)
  if (variables.length === 0) return emptyParametricSweep(input.analysis)
  const evaluationCount = variables.reduce(
    (product, variable) => product * variable.points,
    1,
  )
  if (evaluationCount > 1000) {
    throw new SimulationError(
      'Multidimensional optimization is limited to 1,000 grid evaluations.',
    )
  }
  const metric = input.analysis.sweepMetric ?? 's21Db'
  const objective =
    input.analysis.sweepObjective ??
    (metric === 'noiseFigureDb' ? 'minimize' : 'maximize')
  const constraint = constraintFromAnalysis(input.analysis)
  const centerHz = (input.analysis.startHz + input.analysis.stopHz) / 2
  const halfSpanHz = Math.max(
    1,
    (input.analysis.stopHz - input.analysis.startHz) * 1e-6,
  )
  const samples: SimulationOutput['parametricSweep']['samples'] = []
  for (let sampleIndex = 0; sampleIndex < evaluationCount; sampleIndex += 1) {
    let quotient = sampleIndex
    const parameterValues = variables.map((variable) => {
      const index = quotient % variable.points
      quotient = Math.floor(quotient / variable.points)
      return (
        variable.start +
        ((variable.stop - variable.start) * index) / (variable.points - 1)
      )
    })
    const overrides = new Map<string, Record<string, number>>()
    variables.forEach((variable, index) => {
      overrides.set(variable.nodeId, {
        ...(overrides.get(variable.nodeId) ?? {}),
        [variable.parameter]: parameterValues[index]!,
      })
    })
    const output = simulateDeterministic({
      ...input,
      nodes: input.nodes.map((candidate) => {
        const override = overrides.get(candidate.id)
        return override
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                parameters: { ...candidate.data.parameters, ...override },
              },
            }
          : candidate
      }),
      analysis: {
        ...input.analysis,
        startHz: centerHz - halfSpanHz,
        stopHz: centerHz + halfSpanHz,
        points: 3,
        monteCarloRuns: 0,
        sweepNodeId: null,
        sweepParameter: null,
        sweepSecondNodeId: null,
        sweepSecondParameter: null,
      },
    })
    const metricValue = parametricMetric(output, metric)
    const constraintValue = constraint
      ? parametricMetric(output, constraint.metric)
      : null
    samples.push({
      parameterValues,
      metricValue,
      constraintValue,
      feasible:
        Number.isFinite(metricValue) &&
        (!constraint ||
          (constraintValue !== null &&
            Number.isFinite(constraintValue) &&
            constraintSatisfied(constraintValue, constraint))),
    })
  }
  let bestIndex = -1
  for (let index = 0; index < samples.length; index += 1) {
    if (!samples[index]!.feasible) continue
    if (
      bestIndex < 0 ||
      (objective === 'maximize'
        ? samples[index]!.metricValue > samples[bestIndex]!.metricValue
        : samples[index]!.metricValue < samples[bestIndex]!.metricValue)
    ) {
      bestIndex = index
    }
  }
  const first = variables[0]!
  const parameterValues = Float64Array.from(
    { length: first.points },
    (_, index) =>
      first.start + ((first.stop - first.start) * index) / (first.points - 1),
  )
  const metricValues = Float64Array.from(parameterValues, (value) => {
    const candidates = samples.filter(
      (sample) =>
        sample.feasible && Math.abs(sample.parameterValues[0]! - value) < 1e-12,
    )
    if (candidates.length === 0) return Number.NaN
    return objective === 'maximize'
      ? Math.max(...candidates.map((sample) => sample.metricValue))
      : Math.min(...candidates.map((sample) => sample.metricValue))
  })
  const bestParameterValues =
    bestIndex < 0 ? [] : [...samples[bestIndex]!.parameterValues]
  return {
    available: bestIndex >= 0,
    nodeId: first.nodeId,
    nodeLabel: first.nodeLabel,
    parameter: first.parameter,
    metric,
    objective,
    parameterValues,
    metricValues,
    bestParameterValue: bestParameterValues[0] ?? null,
    bestMetricValue: bestIndex < 0 ? null : samples[bestIndex]!.metricValue,
    variables,
    samples,
    bestParameterValues,
    constraint,
  }
}

function optimizationVariable(
  input: SimulationInput,
  nodeId: string | null | undefined,
  parameter: string | null | undefined,
  start: number | undefined,
  stop: number | undefined,
  points: number,
  maximumPoints: number,
): SimulationOutput['parametricSweep']['variables'][number] | null {
  if (!nodeId || !parameter) return null
  const node = input.nodes.find((candidate) => candidate.id === nodeId)
  const nominal = node?.data.parameters[parameter]
  if (!node)
    throw new SimulationError('Parametric-sweep node no longer exists.')
  if (!sweepParameterIsEffective(node, parameter)) {
    throw new SimulationError(
      `Cannot sweep "${parameter}" on "${node.data.label}" because imported measured data overrides that fallback parameter.`,
    )
  }
  if (
    typeof nominal !== 'number' ||
    !Number.isFinite(nominal) ||
    typeof start !== 'number' ||
    !Number.isFinite(start) ||
    typeof stop !== 'number' ||
    !Number.isFinite(stop) ||
    start >= stop ||
    !Number.isInteger(points) ||
    points < 2 ||
    points > maximumPoints
  ) {
    throw new SimulationError(
      'Each optimization variable requires a numeric parameter, start < stop, and a valid point count.',
    )
  }
  return {
    nodeId,
    nodeLabel: node.data.label,
    parameter,
    start,
    stop,
    points,
  }
}

function sweepParameterIsEffective(
  node: RFProjectNode,
  parameter: string,
): boolean {
  if (node.data.type !== 'idealAmplifier') return true
  if (
    typeof node.data.parameters.sParameterContent === 'string' &&
    ['gainDb', 'phaseDeg'].includes(parameter)
  ) {
    return false
  }
  const content = node.data.parameters.deviceTableContent
  if (typeof content !== 'string') return true
  return !deviceTableOverridesParameter(parseDeviceTableCsv(content), parameter)
}

function parametricMetric(
  output: SimulationOutput,
  metric: ParametricMetric,
): number {
  const centerIndex = Math.floor(output.total.frequencyHz.length / 2)
  const value = {
    s21Db: output.curves.s21Db[centerIndex],
    noiseFigureDb: output.budget.cascadedNoiseFigureDb,
    inputP1Dbm: output.nonlinear.inputP1Dbm,
    loadPowerDbm: output.budget.deliveredLoadPowerDbm,
  }[metric]
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.NaN
}

function constraintFromAnalysis(
  analysis: RFAnalysisSettings,
): SimulationOutput['parametricSweep']['constraint'] {
  if (!analysis.sweepConstraintMetric) return null
  const value = analysis.sweepConstraintValue
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SimulationError(
      'Optimization/yield constraint value must be finite.',
    )
  }
  return {
    metric: analysis.sweepConstraintMetric,
    direction: analysis.sweepConstraintDirection ?? 'minimum',
    value,
  }
}

function constraintSatisfied(
  value: number,
  constraint: NonNullable<SimulationOutput['parametricSweep']['constraint']>,
): boolean {
  return constraint.direction === 'minimum'
    ? value >= constraint.value
    : value <= constraint.value
}

function emptyParametricSweep(
  analysis: RFAnalysisSettings,
): SimulationOutput['parametricSweep'] {
  return {
    available: false,
    nodeId: analysis.sweepNodeId ?? null,
    nodeLabel: null,
    parameter: analysis.sweepParameter ?? null,
    metric: analysis.sweepMetric ?? 's21Db',
    objective: analysis.sweepObjective ?? 'maximize',
    parameterValues: new Float64Array(),
    metricValues: new Float64Array(),
    bestParameterValue: null,
    bestMetricValue: null,
    variables: [],
    samples: [],
    bestParameterValues: [],
    constraint: constraintFromAnalysis(analysis),
  }
}
