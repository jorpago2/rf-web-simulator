import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  FileUploaderButton,
  FormGroup,
  InlineNotification,
  Link,
  NumberInput,
  Select,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  TextInput,
  Tile,
} from '@carbon/react'
import {
  ScientificOutcomeSummary,
  ScientificTaskPanel,
  useScientificResultTransition,
} from '@jorpago2/scientific-ui'
import { blockDescriptors } from './diagram/nodeRegistry'
import { RFBlockSymbol } from './diagram/RFBlockSymbol'
import { parseTouchstone } from './engine/touchstone'
import {
  deviceTableOverridesParameter,
  deviceTableSummary,
  parseDeviceTableCsv,
  type DeviceTable,
} from './engine/deviceTable'
import { magnitudeDb, phaseDegrees } from './engine/complex'
import { twoPortParametersAt } from './engine/twoPortParameters'
import { parseMixerProductCsv } from './engine/mixerProducts'
import type {
  FrequencyPlanResult,
  FrequencyRange,
  MixerProduct,
  NonlinearSweepResult,
  RFAnalysisSettings,
  RFProjectNode,
  RFNodeType,
  RFBudgetResult,
  SimulationOutput,
} from './engine/types'
import { RFPlot, type FrequencyUnit, type PlotView } from './plots/RFPlot'
import { nonlinearSweepToCsv, simulationOutputToCsv } from './persistence/csv'
import { downloadTextFile, safeFileName } from './persistence/download'
import { useRFEditorStore } from './app/store'
import { strings } from './app/strings'

export function BlockLibrary({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const addNode = useRFEditorStore((state) => state.addNode)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')

  const blockCategories = useMemo(
    () => [
      {
        id: 'sources',
        label: 'Sources',
        types: ['source', 'vcoSource'] as RFNodeType[],
      },
      {
        id: 'passive',
        label: 'Passive 2-port',
        types: [
          'touchstone2Port',
          'idealAttenuator',
          'idealFilter',
          'idealPhaseShifter',
          'idealIsolator',
          'idealRFSwitch',
          'transmissionLine',
          'matchingNetwork',
        ] as RFNodeType[],
      },
      {
        id: 'multiport',
        label: 'Multi-port',
        types: [
          'idealDirectionalCoupler',
          'idealDiplexer',
          'idealBalun',
          'idealSplitter',
          'idealCombiner',
        ] as RFNodeType[],
      },
      {
        id: 'active',
        label: 'Active',
        types: ['idealAmplifier'] as RFNodeType[],
      },
      {
        id: 'conversion',
        label: 'Frequency conversion',
        types: ['idealMixer'] as RFNodeType[],
      },
      {
        id: 'terminals',
        label: 'Antennas and terminations',
        types: ['rxAntenna', 'txAntenna', 'load', 'probe'] as RFNodeType[],
      },
    ],
    [],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleBlocks = blockDescriptors.filter((block) => {
    const inCategory =
      category === 'all' ||
      blockCategories
        .find((candidate) => candidate.id === category)
        ?.types.includes(block.type)
    const matchesQuery =
      !normalizedQuery ||
      `${block.label} ${block.description}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    return inCategory && matchesQuery
  })

  const startDrag = (event: DragEvent, type: RFNodeType) => {
    event.dataTransfer.setData('application/rf-node-type', type)
    event.dataTransfer.effectAllowed = 'copy'
  }

  if (!open) return null

  return (
    <ScientificTaskPanel
      id="workflow-panel"
      className="panel block-library"
      titleId="library-title"
      title={strings.libraryTitle}
      eyebrow="Library"
      closeLabel="Close"
      onClose={onClose}
    >
      <p className="workflow-panel__description">{strings.libraryHint}</p>
      <div className="block-library__filters">
        <TextInput
          id="component-search"
          labelText="Search components"
          placeholder="Name or function"
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          id="component-category"
          labelText="Category"
          size="sm"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All categories</option>
          {blockCategories.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </div>
      <p className="block-library__count" aria-live="polite">
        {visibleBlocks.length}{' '}
        {visibleBlocks.length === 1 ? 'component' : 'components'}
      </p>
      <div className="block-list">
        {visibleBlocks.map((block) => (
          <Button
            className="block-card"
            draggable
            kind="ghost"
            size="sm"
            key={block.type}
            onDragStart={(event) => startDrag(event, block.type)}
            onClick={() => addNode(block.type)}
            type="button"
          >
            <span
              className="block-card__symbol"
              style={{ '--block-accent': block.accent } as React.CSSProperties}
              aria-hidden="true"
            >
              <RFBlockSymbol type={block.type} />
            </span>
            <span>
              <strong>{block.label}</strong>
              <small>{block.description}</small>
            </span>
          </Button>
        ))}
        {visibleBlocks.length === 0 && (
          <p className="block-library__empty">
            No components match this search.
          </p>
        )}
      </div>
    </ScientificTaskPanel>
  )
}

interface FileStatus {
  nodeId: string
  kind: 'success' | 'error'
  message: string
}

export function PropertiesPanel({ onClose }: { onClose: () => void }) {
  const selectedNodeId = useRFEditorStore((state) => state.selectedNodeId)
  const node = useRFEditorStore((state) =>
    state.nodes.find((candidate) => candidate.id === state.selectedNodeId),
  )
  const updateLabel = useRFEditorStore((state) => state.updateNodeLabel)
  const updateParameters = useRFEditorStore(
    (state) => state.updateNodeParameters,
  )
  const removeSelectedNode = useRFEditorStore(
    (state) => state.removeSelectedNode,
  )
  const [fileStatus, setFileStatus] = useState<FileStatus | null>(null)
  const nodeType = node?.data.type
  const nodeLabel = node?.data.label
  const deviceTableContent = node?.data.parameters.deviceTableContent
  const deviceTableFileName = node?.data.parameters.deviceTableFileName
  const amplifierTable = useMemo(() => {
    if (
      nodeType !== 'idealAmplifier' ||
      typeof deviceTableContent !== 'string'
    ) {
      return null
    }
    try {
      return parseDeviceTableCsv(
        deviceTableContent,
        typeof deviceTableFileName === 'string'
          ? deviceTableFileName
          : nodeLabel,
      )
    } catch {
      return null
    }
  }, [deviceTableContent, deviceTableFileName, nodeLabel, nodeType])

  if (!node || !selectedNodeId) {
    return null
  }

  const setNumber = (key: string, value: number) => {
    if (Number.isFinite(value)) updateParameters(node.id, { [key]: value })
  }

  const loadTouchstone = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const network = parseTouchstone(content, file.name)
      const existingRoles = Array.isArray(node.data.parameters.portRoles)
        ? node.data.parameters.portRoles
        : []
      const portRoles = Array.from({ length: network.portCount }, (_, index) =>
        existingRoles[index] === 'input' || existingRoles[index] === 'output'
          ? existingRoles[index]
          : index === 0
            ? 'input'
            : 'output',
      )
      updateParameters(node.id, {
        fileName: file.name,
        content,
        pointCount: network.frequencyHz.length,
        startHz: network.frequencyHz[0],
        stopHz: network.frequencyHz.at(-1),
        referenceImpedancesOhm: Array.from(network.referenceImpedancesOhm),
        format: network.format,
        touchstoneVersion: network.version,
        originalParameterType: network.originalParameterType,
        noisePointCount: network.noise?.frequencyHz.length ?? 0,
        portCount: network.portCount,
        portLabels: network.portLabels,
        portRoles,
      })
      setFileStatus({
        nodeId: node.id,
        kind: 'success',
        message: `${file.name}: ${network.frequencyHz.length} valid ${network.originalParameterType}-parameter points (Touchstone ${network.version}).`,
      })
    } catch (error) {
      setFileStatus({
        nodeId: node.id,
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Invalid Touchstone file.',
      })
    }
  }

  const loadAmplifierSParameters = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const network = parseTouchstone(content, file.name, 2)
      updateParameters(node.id, {
        sParameterFileName: file.name,
        sParameterContent: content,
        sParameterPointCount: network.frequencyHz.length,
        sParameterReferenceImpedancesOhm: Array.from(
          network.referenceImpedancesOhm,
        ),
      })
      setFileStatus({
        nodeId: node.id,
        kind: 'success',
        message: `${file.name}: ${network.frequencyHz.length} valid S-parameter points.`,
      })
    } catch (error) {
      setFileStatus({
        nodeId: node.id,
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Invalid Touchstone file.',
      })
    }
  }

  const loadDeembeddingFixture =
    (side: 'left' | 'right') =>
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      try {
        const content = await file.text()
        const network = parseTouchstone(content, file.name, 2)
        updateParameters(node.id, {
          [`${side}FixtureFileName`]: file.name,
          [`${side}FixtureContent`]: content,
        })
        setFileStatus({
          nodeId: node.id,
          kind: 'success',
          message: `${file.name}: ${side} fixture with ${network.frequencyHz.length} valid points.`,
        })
      } catch (error) {
        setFileStatus({
          nodeId: node.id,
          kind: 'error',
          message:
            error instanceof Error ? error.message : 'Invalid fixture file.',
        })
      }
    }

  const loadMixerProductTable = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const products = parseMixerProductCsv(content)
      updateParameters(node.id, {
        productTableFileName: file.name,
        productTableContent: content,
        productTableCount: products.length,
      })
      setFileStatus({
        nodeId: node.id,
        kind: 'success',
        message: `${file.name}: ${products.length} measured mixer products.`,
      })
    } catch (error) {
      setFileStatus({
        nodeId: node.id,
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Invalid mixer table.',
      })
    }
  }

  const loadDeviceTable = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const table = parseDeviceTableCsv(content, file.name)
      updateParameters(node.id, {
        deviceTableFileName: file.name,
        deviceTableContent: content,
        deviceTableSummary: deviceTableSummary(table),
      })
      setFileStatus({
        nodeId: node.id,
        kind: 'success',
        message: `${file.name}: ${deviceTableSummary(table)}.`,
      })
    } catch (error) {
      setFileStatus({
        nodeId: node.id,
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Invalid device table.',
      })
    }
  }

  return (
    <ScientificTaskPanel
      id="rf-properties"
      className="panel properties"
      titleId="properties-title"
      title={strings.propertiesTitle}
      eyebrow="Inspector"
      closeLabel="Close"
      onClose={onClose}
    >
      <p className="workflow-panel__description">{node.data.label}</p>
      <TextInput
        className="field"
        id={`block-name-${node.id}`}
        labelText="Block name"
        size="sm"
        value={node.data.label}
        onChange={(event) => updateLabel(node.id, event.target.value)}
      />

      {node.data.type === 'source' && (
        <>
          <NumberField
            label="Center frequency"
            unit="Hz"
            value={numberValue(node.data.parameters.centerFrequencyHz, 1e9)}
            onChange={(value) => setNumber('centerFrequencyHz', value)}
          />
          <NumberField
            label="Power"
            unit="dBm"
            value={numberValue(node.data.parameters.powerDbm, 0)}
            onChange={(value) => setNumber('powerDbm', value)}
          />
          <NumberField
            label="Source impedance"
            unit="Ω"
            min={0.01}
            value={numberValue(node.data.parameters.sourceImpedanceOhm, 50)}
            onChange={(value) => setNumber('sourceImpedanceOhm', value)}
          />
          <OptionalNumberField
            label="Source impedance σ"
            unit="Ω"
            min={0}
            value={node.data.parameters.sourceImpedanceToleranceOhm}
            onChange={(value) =>
              updateParameters(node.id, { sourceImpedanceToleranceOhm: value })
            }
          />
          <NumberField
            label="Two-tone spacing"
            unit="Hz"
            min={1}
            value={numberValue(node.data.parameters.twoToneSpacingHz, 10e6)}
            onChange={(value) => setNumber('twoToneSpacingHz', value)}
          />
        </>
      )}

      {(node.data.type === 'load' || node.data.type === 'txAntenna') && (
        <>
          <NumberField
            label="Load impedance"
            unit="Ω"
            min={0.01}
            value={numberValue(node.data.parameters.loadImpedanceOhm, 50)}
            onChange={(value) => setNumber('loadImpedanceOhm', value)}
          />
          <OptionalNumberField
            label="Load impedance σ"
            unit="Ω"
            min={0}
            value={node.data.parameters.loadImpedanceToleranceOhm}
            onChange={(value) =>
              updateParameters(node.id, { loadImpedanceToleranceOhm: value })
            }
          />
        </>
      )}

      {node.data.type === 'rxAntenna' && (
        <>
          <NumberField
            label="Received center frequency"
            unit="Hz"
            min={Number.MIN_VALUE}
            value={numberValue(node.data.parameters.centerFrequencyHz, 1e9)}
            onChange={(value) => setNumber('centerFrequencyHz', value)}
          />
          <NumberField
            label="Available received power"
            unit="dBm"
            value={numberValue(node.data.parameters.powerDbm, -80)}
            onChange={(value) => setNumber('powerDbm', value)}
          />
          <NumberField
            label="Antenna source impedance"
            unit="Ω"
            min={0.01}
            value={numberValue(node.data.parameters.sourceImpedanceOhm, 50)}
            onChange={(value) => setNumber('sourceImpedanceOhm', value)}
          />
        </>
      )}

      {(node.data.type === 'rxAntenna' || node.data.type === 'txAntenna') && (
        <>
          <NumberField
            label="Radiation efficiency"
            unit="%"
            min={Number.MIN_VALUE}
            max={100}
            value={numberValue(node.data.parameters.efficiencyPercent, 70)}
            onChange={(value) => setNumber('efficiencyPercent', value)}
          />
          <NumberField
            label="Cosine pattern exponent"
            unit=""
            min={0}
            value={numberValue(node.data.parameters.patternExponent, 2)}
            onChange={(value) => setNumber('patternExponent', value)}
          />
          <NumberField
            label="Front-to-back ratio"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.frontToBackDb, 20)}
            onChange={(value) => setNumber('frontToBackDb', value)}
          />
          <p className="empty-state">
            Axisymmetric cosine-power far-field model; no polarization,
            coupling, mismatch or 3D geometry.
          </p>
        </>
      )}

      {node.data.type === 'vcoSource' && (
        <>
          <NumberField
            label="Free-running frequency"
            unit="Hz"
            min={Number.MIN_VALUE}
            value={numberValue(
              node.data.parameters.freeRunningFrequencyHz,
              0.9e9,
            )}
            onChange={(value) => setNumber('freeRunningFrequencyHz', value)}
          />
          <NumberField
            label="Tuning sensitivity"
            unit="Hz/V"
            value={numberValue(
              node.data.parameters.tuningSensitivityHzPerV,
              100e6,
            )}
            onChange={(value) => setNumber('tuningSensitivityHzPerV', value)}
          />
          <NumberField
            label="Control voltage"
            unit="V"
            value={numberValue(node.data.parameters.controlVoltageV, 1)}
            onChange={(value) => setNumber('controlVoltageV', value)}
          />
          <p className="empty-state">
            Tuned frequency:{' '}
            {formatFrequency(
              numberValue(node.data.parameters.freeRunningFrequencyHz, 0.9e9) +
                numberValue(
                  node.data.parameters.tuningSensitivityHzPerV,
                  100e6,
                ) *
                  numberValue(node.data.parameters.controlVoltageV, 1),
            )}
          </p>
          <NumberField
            label="Output power"
            unit="dBm"
            value={numberValue(node.data.parameters.powerDbm, 10)}
            onChange={(value) => setNumber('powerDbm', value)}
          />
          <NumberField
            label="Source impedance"
            unit="Ω"
            min={0.01}
            value={numberValue(node.data.parameters.sourceImpedanceOhm, 50)}
            onChange={(value) => setNumber('sourceImpedanceOhm', value)}
          />
          <NumberField
            label="Phase noise at 1 MHz"
            unit="dBc/Hz"
            value={numberValue(
              node.data.parameters.phaseNoiseAt1MHzDbcHz,
              -120,
            )}
            onChange={(value) => setNumber('phaseNoiseAt1MHzDbcHz', value)}
          />
          <NumberField
            label="Phase-noise slope"
            unit="dB/dec"
            max={0}
            value={numberValue(
              node.data.parameters.phaseNoiseSlopeDbPerDecade,
              -20,
            )}
            onChange={(value) => setNumber('phaseNoiseSlopeDbPerDecade', value)}
          />
          <NumberField
            label="Phase-noise floor"
            unit="dBc/Hz"
            value={numberValue(node.data.parameters.phaseNoiseFloorDbcHz, -160)}
            onChange={(value) => setNumber('phaseNoiseFloorDbcHz', value)}
          />
          <NumberField
            label="Integration start"
            unit="Hz"
            min={Number.MIN_VALUE}
            value={numberValue(
              node.data.parameters.phaseNoiseIntegrationStartHz,
              100,
            )}
            onChange={(value) =>
              setNumber('phaseNoiseIntegrationStartHz', value)
            }
          />
          <NumberField
            label="Integration stop"
            unit="Hz"
            min={Number.MIN_VALUE}
            value={numberValue(
              node.data.parameters.phaseNoiseIntegrationStopHz,
              10e6,
            )}
            onChange={(value) =>
              setNumber('phaseNoiseIntegrationStopHz', value)
            }
          />
          <Checkbox
            className="field checkbox-field"
            id={`pll-enabled-${node.id}`}
            labelText="Close first-order PLL loop"
            checked={node.data.parameters.pllEnabled === true}
            onChange={(_, { checked }) =>
              updateParameters(node.id, { pllEnabled: checked })
            }
          />
          <NumberField
            label="PLL loop bandwidth"
            unit="Hz"
            min={Number.MIN_VALUE}
            value={numberValue(node.data.parameters.pllLoopBandwidthHz, 100e3)}
            onChange={(value) => setNumber('pllLoopBandwidthHz', value)}
          />
          <NumberField
            label="In-band output phase noise"
            unit="dBc/Hz"
            value={numberValue(
              node.data.parameters.pllInBandPhaseNoiseDbcHz,
              -140,
            )}
            onChange={(value) => setNumber('pllInBandPhaseNoiseDbcHz', value)}
          />
          <p className="empty-state">
            Behavioral SSB model; excludes reference spurs, divider noise, lock
            acquisition and nonlinear loop dynamics.
          </p>
        </>
      )}

      {node.data.type === 'idealAmplifier' && (
        <>
          <AmplifierModelSources
            table={amplifierTable}
            touchstoneFileName={node.data.parameters.sParameterFileName}
          />
          <FileUploaderButton
            accept={['.s2p', '.ts', 'text/plain']}
            buttonKind="secondary"
            className="field file-field"
            id={`amplifier-touchstone-${node.id}`}
            labelText="Small-signal Touchstone (optional)"
            multiple={false}
            size="sm"
            onChange={loadAmplifierSParameters}
          />
          {typeof node.data.parameters.sParameterFileName === 'string' && (
            <>
              <dl className="file-summary">
                <div>
                  <dt>S-parameters</dt>
                  <dd>{node.data.parameters.sParameterFileName}</dd>
                </div>
                <div>
                  <dt>Points</dt>
                  <dd>{String(node.data.parameters.sParameterPointCount)}</dd>
                </div>
              </dl>
              <Button
                className="file-reset-button"
                kind="ghost"
                size="sm"
                type="button"
                onClick={() =>
                  updateParameters(node.id, {
                    sParameterFileName: null,
                    sParameterContent: null,
                    sParameterPointCount: null,
                  })
                }
              >
                Use matched gain instead
              </Button>
            </>
          )}
          <Checkbox
            className="field checkbox-field"
            id={`amplifier-passivity-${node.id}`}
            labelText="Conservatively enforce imported S-parameter passivity"
            checked={node.data.parameters.enforcePassivity === true}
            disabled={
              typeof node.data.parameters.sParameterContent !== 'string'
            }
            onChange={(_, { checked }) =>
              updateParameters(node.id, { enforcePassivity: checked })
            }
          />
          <FormGroup
            className="field file-field"
            legendText="Datasheet / measured table (optional)"
          >
            <FileUploaderButton
              aria-describedby={`device-table-help-${node.id}`}
              buttonKind="secondary"
              id={`device-table-${node.id}`}
              labelText="Choose performance CSV"
              accept={['.csv', 'text/csv', 'text/plain']}
              multiple={false}
              size="sm"
              onChange={loadDeviceTable}
            />
            <small id={`device-table-help-${node.id}`}>
              CSV: frequency plus gain, NF, OP1dB, OIP3, or Pin/Pout columns.
            </small>
            <Link
              href={`${import.meta.env.BASE_URL}examples/device-performance-template.csv`}
              download
            >
              Download CSV template
            </Link>
          </FormGroup>
          {typeof node.data.parameters.deviceTableFileName === 'string' && (
            <>
              <dl className="file-summary">
                <div>
                  <dt>Performance</dt>
                  <dd>{node.data.parameters.deviceTableFileName}</dd>
                </div>
                <div>
                  <dt>Content</dt>
                  <dd>{String(node.data.parameters.deviceTableSummary)}</dd>
                </div>
              </dl>
              <Button
                className="file-reset-button"
                kind="ghost"
                size="sm"
                type="button"
                onClick={() =>
                  updateParameters(node.id, {
                    deviceTableFileName: null,
                    deviceTableContent: null,
                    deviceTableSummary: null,
                  })
                }
              >
                Use analytic metadata instead
              </Button>
            </>
          )}
          <NumberField
            label="Fallback gain"
            unit="dB"
            disabled={
              typeof node.data.parameters.sParameterContent === 'string' ||
              tableHasGain(amplifierTable)
            }
            value={numberValue(node.data.parameters.gainDb, 10)}
            onChange={(value) => setNumber('gainDb', value)}
          />
          <PhaseField
            disabled={
              typeof node.data.parameters.sParameterContent === 'string'
            }
            label="Fallback phase"
            nodeId={node.id}
          />
          <OptionalNumberField
            label="Gain σ"
            unit="dB"
            min={0}
            value={node.data.parameters.gainToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { gainToleranceDb: value })
            }
          />
          <OptionalNumberField
            label="Phase σ"
            unit="deg"
            min={0}
            value={node.data.parameters.phaseToleranceDeg}
            onChange={(value) =>
              updateParameters(node.id, { phaseToleranceDeg: value })
            }
          />
          <BudgetMetadataFields
            fallbackLabels
            nodeId={node.id}
            table={amplifierTable}
          />
        </>
      )}

      {node.data.type === 'idealAttenuator' && (
        <>
          <NumberField
            label="Attenuation"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.attenuationDb, 3)}
            onChange={(value) => setNumber('attenuationDb', value)}
          />
          <PhaseField nodeId={node.id} />
          <OptionalNumberField
            label="Attenuation σ"
            unit="dB"
            min={0}
            value={node.data.parameters.attenuationToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { attenuationToleranceDb: value })
            }
          />
          <OptionalNumberField
            label="Phase σ"
            unit="deg"
            min={0}
            value={node.data.parameters.phaseToleranceDeg}
            onChange={(value) =>
              updateParameters(node.id, { phaseToleranceDeg: value })
            }
          />
        </>
      )}

      {node.data.type === 'idealFilter' && (
        <>
          <Select
            className="field"
            id={`filter-response-${node.id}`}
            labelText="Filter response"
            size="sm"
            value={
              typeof node.data.parameters.filterType === 'string'
                ? node.data.parameters.filterType
                : 'bandpass'
            }
            onChange={(event) =>
              updateParameters(node.id, { filterType: event.target.value })
            }
          >
            <option value="lowpass">Low-pass</option>
            <option value="highpass">High-pass</option>
            <option value="bandpass">Band-pass</option>
            <option value="bandstop">Band-stop</option>
          </Select>
          {node.data.parameters.filterType === 'lowpass' ||
          node.data.parameters.filterType === 'highpass' ? (
            <NumberField
              label="Cutoff frequency"
              unit="Hz"
              min={Number.MIN_VALUE}
              value={numberValue(node.data.parameters.cutoffFrequencyHz, 1e9)}
              onChange={(value) => setNumber('cutoffFrequencyHz', value)}
            />
          ) : (
            <>
              <NumberField
                label="Center frequency"
                unit="Hz"
                min={Number.MIN_VALUE}
                value={numberValue(node.data.parameters.centerFrequencyHz, 1e9)}
                onChange={(value) => setNumber('centerFrequencyHz', value)}
              />
              <NumberField
                label="3 dB bandwidth"
                unit="Hz"
                min={Number.MIN_VALUE}
                value={numberValue(node.data.parameters.bandwidthHz, 200e6)}
                onChange={(value) => setNumber('bandwidthHz', value)}
              />
            </>
          )}
          <NumberField
            label="Butterworth order"
            unit=""
            min={1}
            max={10}
            step={1}
            value={numberValue(node.data.parameters.order, 3)}
            onChange={(value) => setNumber('order', value)}
          />
          <NumberField
            label="Insertion loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.insertionLossDb, 1)}
            onChange={(value) => setNumber('insertionLossDb', value)}
          />
          <OptionalNumberField
            label="Insertion-loss σ"
            unit="dB"
            min={0}
            value={node.data.parameters.insertionLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { insertionLossToleranceDb: value })
            }
          />
        </>
      )}

      {node.data.type === 'idealPhaseShifter' && (
        <>
          <PhaseField nodeId={node.id} label="Narrowband phase shift" />
          <NumberField
            label="Insertion loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.insertionLossDb, 1)}
            onChange={(value) => setNumber('insertionLossDb', value)}
          />
          <OptionalNumberField
            label="Insertion-loss σ"
            unit="dB"
            min={0}
            value={node.data.parameters.insertionLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { insertionLossToleranceDb: value })
            }
          />
          <OptionalNumberField
            label="Phase σ"
            unit="deg"
            min={0}
            value={node.data.parameters.phaseToleranceDeg}
            onChange={(value) =>
              updateParameters(node.id, { phaseToleranceDeg: value })
            }
          />
        </>
      )}

      {node.data.type === 'idealIsolator' && (
        <>
          <NumberField
            label="Forward loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.forwardLossDb, 1)}
            onChange={(value) => setNumber('forwardLossDb', value)}
          />
          <NumberField
            label="Reverse isolation"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.reverseIsolationDb, 30)}
            onChange={(value) => setNumber('reverseIsolationDb', value)}
          />
          <PhaseField nodeId={node.id} />
          <OptionalNumberField
            label="Forward-loss σ"
            unit="dB"
            min={0}
            value={node.data.parameters.forwardLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { forwardLossToleranceDb: value })
            }
          />
          <OptionalNumberField
            label="Phase σ"
            unit="deg"
            min={0}
            value={node.data.parameters.phaseToleranceDeg}
            onChange={(value) =>
              updateParameters(node.id, { phaseToleranceDeg: value })
            }
          />
        </>
      )}

      {node.data.type === 'idealRFSwitch' && (
        <>
          <Checkbox
            className="field checkbox-field"
            id={`switch-enabled-${node.id}`}
            labelText="Conducting (ON)"
            checked={node.data.parameters.enabled === true}
            onChange={(_, { checked }) =>
              updateParameters(node.id, { enabled: checked })
            }
          />
          <NumberField
            label="ON insertion loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.insertionLossDb, 1)}
            onChange={(value) => setNumber('insertionLossDb', value)}
          />
          <NumberField
            label="OFF isolation"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.isolationDb, 40)}
            onChange={(value) => setNumber('isolationDb', value)}
          />
          <PhaseField nodeId={node.id} />
          <OptionalNumberField
            label="Insertion-loss Ïƒ"
            unit="dB"
            min={0}
            value={node.data.parameters.insertionLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { insertionLossToleranceDb: value })
            }
          />
        </>
      )}

      {node.data.type === 'idealDirectionalCoupler' && (
        <>
          <NumberField
            label="Coupling"
            unit="dB"
            min={Number.MIN_VALUE}
            value={numberValue(node.data.parameters.couplingDb, 20)}
            onChange={(value) => setNumber('couplingDb', value)}
          />
          <NumberField
            label="Excess loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.excessLossDb, 0.5)}
            onChange={(value) => setNumber('excessLossDb', value)}
          />
          <OptionalNumberField
            label="Excess-loss Ïƒ"
            unit="dB"
            min={0}
            value={node.data.parameters.excessLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { excessLossToleranceDb: value })
            }
          />
        </>
      )}

      {node.data.type === 'idealDiplexer' && (
        <>
          <NumberField
            label="LP / HP crossover"
            unit="Hz"
            min={Number.MIN_VALUE}
            value={numberValue(node.data.parameters.crossoverFrequencyHz, 1e9)}
            onChange={(value) => setNumber('crossoverFrequencyHz', value)}
          />
          <NumberField
            label="Butterworth order"
            unit=""
            min={1}
            max={10}
            step={1}
            value={numberValue(node.data.parameters.order, 3)}
            onChange={(value) => setNumber('order', value)}
          />
          <NumberField
            label="Insertion loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.insertionLossDb, 1)}
            onChange={(value) => setNumber('insertionLossDb', value)}
          />
          <OptionalNumberField
            label="Insertion-loss Ïƒ"
            unit="dB"
            min={0}
            value={node.data.parameters.insertionLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { insertionLossToleranceDb: value })
            }
          />
        </>
      )}

      {node.data.type === 'transmissionLine' && (
        <>
          <NumberField
            label="Propagation delay"
            unit="s"
            min={0}
            value={numberValue(node.data.parameters.delayS, 1e-9)}
            onChange={(value) => setNumber('delayS', value)}
          />
          <NumberField
            label="Insertion loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.insertionLossDb, 0.5)}
            onChange={(value) => setNumber('insertionLossDb', value)}
          />
        </>
      )}

      {node.data.type === 'matchingNetwork' && (
        <>
          <Select
            className="field"
            id={`matching-topology-${node.id}`}
            labelText="Topology"
            size="sm"
            value={String(node.data.parameters.topology ?? 'l')}
            onChange={(event) =>
              updateParameters(node.id, { topology: event.target.value })
            }
          >
            <option value="l">L network</option>
            <option value="pi">π network (symmetric)</option>
            <option value="t">T network (symmetric)</option>
          </Select>
          <Select
            className="field"
            id={`matching-response-${node.id}`}
            labelText="Reactive arrangement"
            size="sm"
            value={String(node.data.parameters.response ?? 'lowpass')}
            onChange={(event) =>
              updateParameters(node.id, { response: event.target.value })
            }
          >
            <option value="lowpass">Low-pass: series L / shunt C</option>
            <option value="highpass">High-pass: series C / shunt L</option>
          </Select>
          <NumberField
            label="Inductance (each)"
            unit="H"
            min={Number.MIN_VALUE}
            value={numberValue(node.data.parameters.inductanceH, 10e-9)}
            onChange={(value) => setNumber('inductanceH', value)}
          />
          <NumberField
            label="Capacitance (each)"
            unit="F"
            min={Number.MIN_VALUE}
            value={numberValue(node.data.parameters.capacitanceF, 2.5e-12)}
            onChange={(value) => setNumber('capacitanceF', value)}
          />
          <NumberField
            label="Component Q"
            unit=""
            min={Number.MIN_VALUE}
            value={numberValue(node.data.parameters.componentQ, 100)}
            onChange={(value) => setNumber('componentQ', value)}
          />
        </>
      )}

      {node.data.type === 'idealBalun' && (
        <>
          <NumberField
            label="Excess loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.excessLossDb, 1)}
            onChange={(value) => setNumber('excessLossDb', value)}
          />
          <NumberField
            label="Amplitude imbalance N/P"
            unit="dB"
            value={numberValue(node.data.parameters.amplitudeImbalanceDb, 0)}
            onChange={(value) => setNumber('amplitudeImbalanceDb', value)}
          />
          <NumberField
            label="Phase error from 180°"
            unit="deg"
            value={numberValue(node.data.parameters.phaseErrorDeg, 0)}
            onChange={(value) => setNumber('phaseErrorDeg', value)}
          />
          <NumberField
            label="Output isolation"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.isolationDb, 120)}
            onChange={(value) => setNumber('isolationDb', value)}
          />
        </>
      )}

      {(node.data.type === 'idealSplitter' ||
        node.data.type === 'idealCombiner') && (
        <>
          <NumberField
            label="Excess loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.excessLossDb, 0)}
            onChange={(value) => setNumber('excessLossDb', value)}
          />
          <NumberField
            label="Amplitude imbalance B/A"
            unit="dB"
            value={numberValue(node.data.parameters.amplitudeImbalanceDb, 0)}
            onChange={(value) => setNumber('amplitudeImbalanceDb', value)}
          />
          <NumberField
            label="Phase imbalance B−A"
            unit="deg"
            value={numberValue(node.data.parameters.phaseImbalanceDeg, 0)}
            onChange={(value) => setNumber('phaseImbalanceDeg', value)}
          />
          <OptionalNumberField
            label="Excess-loss σ"
            unit="dB"
            min={0}
            value={node.data.parameters.excessLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { excessLossToleranceDb: value })
            }
          />
          <OptionalNumberField
            label="Amplitude-imbalance σ"
            unit="dB"
            min={0}
            value={node.data.parameters.amplitudeImbalanceToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, {
                amplitudeImbalanceToleranceDb: value,
              })
            }
          />
          <OptionalNumberField
            label="Phase-imbalance σ"
            unit="deg"
            min={0}
            value={node.data.parameters.phaseImbalanceToleranceDeg}
            onChange={(value) =>
              updateParameters(node.id, { phaseImbalanceToleranceDeg: value })
            }
          />
          <NumberField
            label="Output isolation"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.isolationDb, 120)}
            onChange={(value) => setNumber('isolationDb', value)}
          />
        </>
      )}

      {node.data.type === 'idealMixer' && (
        <>
          <NumberField
            label="LO frequency"
            unit="Hz"
            min={0}
            value={numberValue(node.data.parameters.loFrequencyHz, 0.7e9)}
            onChange={(value) => setNumber('loFrequencyHz', value)}
          />
          <NumberField
            label="Conversion loss"
            unit="dB"
            min={0}
            value={numberValue(node.data.parameters.conversionLossDb, 7)}
            onChange={(value) => setNumber('conversionLossDb', value)}
          />
          <OptionalNumberField
            label="Conversion-loss σ"
            unit="dB"
            min={0}
            value={node.data.parameters.conversionLossToleranceDb}
            onChange={(value) =>
              updateParameters(node.id, { conversionLossToleranceDb: value })
            }
          />
          <Select
            className="field"
            id={`mixer-mode-${node.id}`}
            labelText="Conversion mode"
            size="sm"
            value={
              node.data.parameters.mixerMode === 'upconvert'
                ? 'upconvert'
                : 'downconvert'
            }
            onChange={(event) =>
              updateParameters(node.id, { mixerMode: event.target.value })
            }
          >
            <option value="downconvert">Difference (input − LO)</option>
            <option value="upconvert">Sum (input + LO)</option>
          </Select>
          <OptionalNumberField
            label="LO drive power"
            unit="dBm"
            value={node.data.parameters.loPowerDbm}
            onChange={(value) =>
              updateParameters(node.id, { loPowerDbm: value })
            }
          />
          <OptionalNumberField
            label="Image rejection"
            unit="dB"
            min={0}
            value={node.data.parameters.imageRejectionDb}
            onChange={(value) =>
              updateParameters(node.id, { imageRejectionDb: value })
            }
          />
          <OptionalNumberField
            label="LO-to-output isolation"
            unit="dB"
            min={0}
            value={node.data.parameters.loToOutputIsolationDb}
            onChange={(value) =>
              updateParameters(node.id, { loToOutputIsolationDb: value })
            }
          />
          <BudgetMetadataFields nodeId={node.id} />
          <FormGroup
            className="field file-field"
            legendText="Measured conversion products (optional CSV)"
          >
            <FileUploaderButton
              aria-describedby={`mixer-products-help-${node.id}`}
              buttonKind="secondary"
              id={`mixer-products-${node.id}`}
              labelText="Choose mixer-products CSV"
              accept={['.csv', 'text/csv', 'text/plain']}
              multiple={false}
              size="sm"
              onChange={loadMixerProductTable}
            />
            <small id={`mixer-products-help-${node.id}`}>
              Columns: m, n, relative_level_db, phase_deg, label.
            </small>
            {typeof node.data.parameters.productTableFileName === 'string' && (
              <Button
                className="file-reset-button"
                kind="ghost"
                size="sm"
                type="button"
                onClick={() =>
                  updateParameters(node.id, {
                    productTableFileName: null,
                    productTableContent: null,
                    productTableCount: null,
                  })
                }
              >
                Remove measured products
              </Button>
            )}
          </FormGroup>
        </>
      )}

      {node.data.type === 'touchstone2Port' && (
        <>
          <FileUploaderButton
            buttonKind="secondary"
            className="field file-field"
            id={`touchstone-file-${node.id}`}
            labelText="Touchstone 1.0/2.0 N-port file"
            multiple={false}
            size="sm"
            onChange={loadTouchstone}
          />
          <Checkbox
            className="field checkbox-field"
            id={`touchstone-passivity-${node.id}`}
            checked={node.data.parameters.enforcePassivity === true}
            onChange={(_, { checked }) =>
              updateParameters(node.id, { enforcePassivity: checked })
            }
            labelText={
              <span>
                Conservatively enforce passivity (pointwise σmax scaling)
              </span>
            }
          />
          {typeof node.data.parameters.fileName === 'string' && (
            <dl className="file-summary">
              <div>
                <dt>File</dt>
                <dd>{node.data.parameters.fileName}</dd>
              </div>
              <div>
                <dt>Points</dt>
                <dd>{String(node.data.parameters.pointCount)}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>
                  {Array.isArray(node.data.parameters.referenceImpedancesOhm)
                    ? node.data.parameters.referenceImpedancesOhm.join(' / ')
                    : '50'}{' '}
                  Ω
                </dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>
                  Touchstone {String(node.data.parameters.touchstoneVersion)} ·{' '}
                  {String(node.data.parameters.originalParameterType)}
                </dd>
              </div>
              {numberValue(node.data.parameters.noisePointCount, 0) > 0 && (
                <div>
                  <dt>Noise points</dt>
                  <dd>{String(node.data.parameters.noisePointCount)}</dd>
                </div>
              )}
            </dl>
          )}
          {numberValue(node.data.parameters.portCount, 2) > 2 &&
            Array.from(
              { length: numberValue(node.data.parameters.portCount, 2) },
              (_, index) => (
                <Select
                  className="field"
                  id={`port-role-${node.id}-${index}`}
                  key={`port-role-${index}`}
                  labelText={`Port ${index + 1} diagram role`}
                  size="sm"
                  value={
                    Array.isArray(node.data.parameters.portRoles) &&
                    node.data.parameters.portRoles[index] === 'input'
                      ? 'input'
                      : 'output'
                  }
                  onChange={(event) => {
                    const roles = Array.isArray(node.data.parameters.portRoles)
                      ? [...node.data.parameters.portRoles]
                      : []
                    roles[index] = event.target.value
                    updateParameters(node.id, { portRoles: roles })
                  }}
                >
                  <option value="input">Input side</option>
                  <option value="output">Output side</option>
                </Select>
              ),
            )}
          {numberValue(node.data.parameters.portCount, 2) === 2 && (
            <Accordion className="file-field" size="sm">
              <AccordionItem title="Optional fixture de-embedding">
                {(['left', 'right'] as const).map((side) => (
                  <FormGroup
                    className="field file-field"
                    key={side}
                    legendText={`${side === 'left' ? 'Input' : 'Output'} fixture (.s2p)`}
                  >
                    <FileUploaderButton
                      buttonKind="secondary"
                      id={`${side}-fixture-${node.id}`}
                      labelText={`Choose ${side} fixture`}
                      accept={['.s2p', '.ts', 'text/plain']}
                      multiple={false}
                      size="sm"
                      onChange={loadDeembeddingFixture(side)}
                    />
                    {typeof node.data.parameters[`${side}FixtureFileName`] ===
                      'string' && (
                      <Button
                        className="file-reset-button"
                        kind="ghost"
                        size="sm"
                        type="button"
                        onClick={() =>
                          updateParameters(node.id, {
                            [`${side}FixtureFileName`]: null,
                            [`${side}FixtureContent`]: null,
                          })
                        }
                      >
                        Remove {side} fixture
                      </Button>
                    )}
                  </FormGroup>
                ))}
              </AccordionItem>
            </Accordion>
          )}
          <BudgetMetadataFields nodeId={node.id} />
        </>
      )}

      {fileStatus?.nodeId === node.id && (
        <InlineNotification
          className="message"
          hideCloseButton
          kind={fileStatus.kind}
          lowContrast
          title={fileStatus.kind === 'success' ? 'File loaded' : 'File error'}
          subtitle={fileStatus.message}
        />
      )}

      <Button
        className="danger-button"
        dangerDescription="Delete the selected RF block and its connections"
        kind="danger--tertiary"
        size="sm"
        type="button"
        onClick={removeSelectedNode}
      >
        Delete block
      </Button>
    </ScientificTaskPanel>
  )
}

function AmplifierModelSources({
  table,
  touchstoneFileName,
}: {
  table: DeviceTable | null
  touchstoneFileName: unknown
}) {
  const hasTouchstone = typeof touchstoneFileName === 'string'
  const smallSignalSource = hasTouchstone
    ? `Touchstone · ${touchstoneFileName}`
    : tableHasGain(table)
      ? `Measured gain · ${table!.sourceName}; analytic phase`
      : 'Analytic gain and phase'
  const compressionSource = table?.powerCurves.length
    ? `Measured Pout(Pin)${tableHasAmpm(table) ? ' + AM/PM' : ''} · ${table.sourceName}`
    : tableHasMetric(table, 'outputP1Dbm')
      ? `Measured P1dB · ${table!.sourceName}`
      : 'Analytic P1dB fallback'

  return (
    <section className="model-sources" aria-labelledby="model-sources-title">
      <h3 id="model-sources-title">Active model sources</h3>
      <dl>
        <div>
          <dt>Small signal</dt>
          <dd>{smallSignalSource}</dd>
        </div>
        <div>
          <dt>Noise figure</dt>
          <dd>
            {tableHasMetric(table, 'noiseFigureDb')
              ? `Measured CSV · ${table!.sourceName}`
              : 'Analytic fallback'}
          </dd>
        </div>
        <div>
          <dt>Compression</dt>
          <dd>{compressionSource}</dd>
        </div>
        <div>
          <dt>IP3 / IM3</dt>
          <dd>
            {tableHasMetric(table, 'outputIp3Dbm')
              ? `Measured OIP3 · ${table!.sourceName}`
              : 'Analytic OIP3 fallback'}
          </dd>
        </div>
      </dl>
      <p>Loaded file data override only the matching fallback fields.</p>
    </section>
  )
}

function tableHasMetric(
  table: DeviceTable | null,
  metric: keyof DeviceTable['metrics'],
): boolean {
  return (table?.metrics[metric].length ?? 0) > 0
}

function tableHasGain(table: DeviceTable | null): boolean {
  return tableHasMetric(table, 'gainDb') || (table?.powerCurves.length ?? 0) > 0
}

function tableHasAmpm(table: DeviceTable | null): boolean {
  return (
    table?.powerCurves.some((curve) =>
      curve.outputPhaseDeg.some((value) => value !== null),
    ) ?? false
  )
}

function PhaseField({
  nodeId,
  disabled = false,
  label = 'Phase',
}: {
  nodeId: string
  disabled?: boolean
  label?: string
}) {
  const node = useRFEditorStore((state) =>
    state.nodes.find((candidate) => candidate.id === nodeId),
  )
  const updateParameters = useRFEditorStore(
    (state) => state.updateNodeParameters,
  )
  if (!node) return null

  return (
    <NumberField
      label={label}
      unit="deg"
      disabled={disabled}
      value={numberValue(node.data.parameters.phaseDeg, 0)}
      onChange={(value) => updateParameters(nodeId, { phaseDeg: value })}
    />
  )
}

function BudgetMetadataFields({
  nodeId,
  table = null,
  fallbackLabels = false,
}: {
  nodeId: string
  table?: DeviceTable | null
  fallbackLabels?: boolean
}) {
  const node = useRFEditorStore((state) =>
    state.nodes.find((candidate) => candidate.id === nodeId),
  )
  const updateParameters = useRFEditorStore(
    (state) => state.updateNodeParameters,
  )
  if (!node) return null

  const update = (key: string, value: number | null) =>
    updateParameters(nodeId, { [key]: value })

  return (
    <>
      <OptionalNumberField
        label={fallbackLabels ? 'Fallback noise figure' : 'Noise figure'}
        unit="dB"
        disabled={tableHasMetric(table, 'noiseFigureDb')}
        min={0}
        value={node.data.parameters.noiseFigureDb}
        onChange={(value) => update('noiseFigureDb', value)}
      />
      <OptionalNumberField
        label={fallbackLabels ? 'Fallback output P1dB' : 'Output P1dB'}
        unit="dBm"
        disabled={
          tableHasMetric(table, 'outputP1Dbm') ||
          (table?.powerCurves.length ?? 0) > 0
        }
        value={node.data.parameters.outputP1Dbm}
        onChange={(value) => update('outputP1Dbm', value)}
      />
      <OptionalNumberField
        label={fallbackLabels ? 'Fallback output IP3' : 'Output IP3'}
        unit="dBm"
        disabled={tableHasMetric(table, 'outputIp3Dbm')}
        value={node.data.parameters.outputIp3Dbm}
        onChange={(value) => update('outputIp3Dbm', value)}
      />
      <OptionalNumberField
        label="IM3 contribution phase"
        unit="deg"
        value={node.data.parameters.im3PhaseDeg}
        onChange={(value) => update('im3PhaseDeg', value)}
      />
    </>
  )
}

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: {
  label: string
  unit: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <NumberInput
      className="field"
      decorator={unit ? <span className="field-unit">{unit}</span> : undefined}
      disabled={disabled}
      hideSteppers
      iconDescription={`Adjust ${label}`}
      id={id}
      label={label}
      max={max}
      min={min}
      size="sm"
      step={step}
      value={value}
      onChange={(_, { value: nextValue }) => {
        const parsed = Number(nextValue)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
    />
  )
}

function OptionalNumberField({
  label,
  unit,
  value,
  min,
  disabled = false,
  onChange,
}: {
  label: string
  unit: string
  value: unknown
  min?: number
  disabled?: boolean
  onChange: (value: number | null) => void
}) {
  const id = useId()
  return (
    <NumberInput
      allowEmpty
      className="field"
      decorator={unit ? <span className="field-unit">{unit}</span> : undefined}
      disabled={disabled}
      hideSteppers
      iconDescription={`Adjust ${label}`}
      id={id}
      label={label}
      min={min}
      placeholder="Not set"
      size="sm"
      value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
      onChange={(_, { value: nextValue }) =>
        onChange(nextValue === '' ? null : Number(nextValue))
      }
    />
  )
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sweepableParameters(node: RFProjectNode): [string, number][] {
  let deviceTable: DeviceTable | null = null
  if (
    node.data.type === 'idealAmplifier' &&
    typeof node.data.parameters.deviceTableContent === 'string'
  ) {
    try {
      deviceTable = parseDeviceTableCsv(node.data.parameters.deviceTableContent)
    } catch {
      // Validation reports malformed tables; keep fallback controls available.
    }
  }
  return Object.entries(node.data.parameters).filter(
    (entry): entry is [string, number] => {
      const [key, value] = entry
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        !key.includes('Tolerance') &&
        !['referenceImpedanceOhm', 'portCount'].includes(key) &&
        !key.endsWith('PointCount') &&
        !(
          node.data.type === 'idealAmplifier' &&
          typeof node.data.parameters.sParameterContent === 'string' &&
          ['gainDb', 'phaseDeg'].includes(key)
        ) &&
        !(deviceTable && deviceTableOverridesParameter(deviceTable, key)) &&
        !(
          node.data.type === 'idealFilter' &&
          (node.data.parameters.filterType === 'lowpass' ||
          node.data.parameters.filterType === 'highpass'
            ? ['centerFrequencyHz', 'bandwidthHz'].includes(key)
            : key === 'cutoffFrequencyHz')
        )
      )
    },
  )
}

function defaultSweepRange(key: string, nominal: number): [number, number] {
  const span = Math.max(Math.abs(nominal) * 0.2, 1)
  const nonNegative = new Set([
    'attenuationDb',
    'insertionLossDb',
    'forwardLossDb',
    'reverseIsolationDb',
    'couplingDb',
    'delayS',
    'inductanceH',
    'capacitanceF',
    'componentQ',
    'freeRunningFrequencyHz',
    'cutoffFrequencyHz',
    'centerFrequencyHz',
    'crossoverFrequencyHz',
    'bandwidthHz',
    'noiseFigureDb',
    'conversionLossDb',
    'excessLossDb',
    'isolationDb',
    'imageRejectionDb',
    'loToOutputIsolationDb',
    'loFrequencyHz',
    'sourceImpedanceOhm',
    'loadImpedanceOhm',
  ])
  return [
    nonNegative.has(key) ? Math.max(0, nominal - span) : nominal - span,
    nominal + span,
  ]
}

export type SimulationStatus = 'idle' | 'running' | 'success' | 'error'
type ResultView =
  | PlotView
  | 'budget'
  | 'frequencyPlan'
  | 'parameters'
  | 'monteCarlo'
  | 'parametricSweep'

type ResultCategory = 'performance' | 'network' | 'studies' | 'planning'

export function SimulationPanel({
  projectName,
  analysis,
  analysisControlsHost,
  nodes,
  status,
  result,
  error,
  onAnalysisChange,
  onRun,
  onExport,
}: {
  projectName: string
  analysis: RFAnalysisSettings
  analysisControlsHost: HTMLElement | null
  nodes: RFProjectNode[]
  status: SimulationStatus
  result: SimulationOutput | null
  error: string | null
  onAnalysisChange: (analysis: RFAnalysisSettings) => void
  onRun: () => void
  onExport: (fileName: string) => void
}) {
  const outcomeHeading = useRef<HTMLHeadingElement>(null)
  const [resultView, setResultView] = useState<ResultView>('sParameters')
  const [resultCategory, setResultCategory] =
    useState<ResultCategory>('network')
  const [frequencyUnit, setFrequencyUnit] = useState<FrequencyUnit>('auto')
  const probeViewAvailable = (result?.probeResults.length ?? 0) > 0
  const frequencyPlanAvailable = result
    ? result.frequencyPlan.stages.length > 0 ||
      result.frequencyPlan.output.centerHz !==
        result.frequencyPlan.input.centerHz
    : false
  const nonlinearAvailable = result?.nonlinear.available ?? false
  const oscillatorAvailable = result?.oscillatorNoise.available ?? false
  const antennaAvailable = result?.antenna.available ?? false
  const monteCarloAvailable = result?.monteCarlo.available ?? false
  const parametricSweepAvailable = result?.parametricSweep.available ?? false
  const visibleResultView =
    (resultView === 'probes' && !probeViewAvailable) ||
    (resultView === 'budget' && !result) ||
    (resultView === 'frequencyPlan' && !frequencyPlanAvailable) ||
    (resultView === 'nonlinear' && !nonlinearAvailable) ||
    (resultView === 'oscillator' && !oscillatorAvailable) ||
    (resultView === 'antenna' && !antennaAvailable) ||
    (resultView === 'monteCarlo' && !monteCarloAvailable) ||
    (resultView === 'parametricSweep' && !parametricSweepAvailable) ||
    ((resultView === 'phase' || resultView === 'groupDelay') &&
      frequencyPlanAvailable)
      ? 'sParameters'
      : resultView
  const resultViews: {
    view: ResultView
    label: string
    category: ResultCategory
    disabled?: boolean
    prerequisite?: string
  }[] = [
    {
      view: 'nonlinear',
      label: 'Nonlinear',
      category: 'performance',
      disabled: !nonlinearAvailable,
      prerequisite:
        'Requires an active or nonlinear stage with compression data.',
    },
    {
      view: 'oscillator',
      label: 'Oscillator',
      category: 'performance',
      disabled: !oscillatorAvailable,
      prerequisite: 'Add an Oscillator / VCO block.',
    },
    {
      view: 'antenna',
      label: 'Antenna',
      category: 'performance',
      disabled: !antennaAvailable,
      prerequisite: 'Add an RX or TX antenna block.',
    },
    { view: 'sParameters', label: 'S-parameters', category: 'network' },
    { view: 'smith', label: 'Smith', category: 'network' },
    { view: 'stability', label: 'Stability', category: 'network' },
    { view: 'parameters', label: 'Z/Y/ABCD', category: 'network' },
    {
      view: 'monteCarlo',
      label: 'Monte Carlo',
      category: 'studies',
      disabled: !monteCarloAvailable,
      prerequisite: 'Set Monte Carlo runs above 0 in Advanced analysis.',
    },
    {
      view: 'parametricSweep',
      label: 'Sweep',
      category: 'studies',
      disabled: !parametricSweepAvailable,
      prerequisite: 'Enable a parameter sweep in Advanced analysis.',
    },
    {
      view: 'phase',
      label: 'Phase',
      category: 'network',
      disabled: frequencyPlanAvailable,
      prerequisite:
        'Unavailable across ideal frequency conversion; remove frequency-changing stages.',
    },
    {
      view: 'groupDelay',
      label: 'Group delay',
      category: 'network',
      disabled: frequencyPlanAvailable,
      prerequisite:
        'Unavailable across ideal frequency conversion; remove frequency-changing stages.',
    },
    {
      view: 'probes',
      label: `Probes (${result?.probeResults.length ?? 0})`,
      category: 'studies',
      disabled: !probeViewAvailable,
      prerequisite: 'Add at least one Probe block.',
    },
    { view: 'budget', label: 'RF budget', category: 'planning' },
    {
      view: 'frequencyPlan',
      label: 'Frequency plan',
      category: 'planning',
      disabled: !frequencyPlanAvailable,
      prerequisite: 'Add a mixer or another frequency-conversion stage.',
    },
  ]
  const resultCategories: {
    id: ResultCategory
    label: string
    compactLabel: string
  }[] = [
    { id: 'performance', label: 'Performance', compactLabel: 'Perf.' },
    { id: 'network', label: 'Network', compactLabel: 'Net.' },
    { id: 'studies', label: 'Studies', compactLabel: 'Study' },
    { id: 'planning', label: 'Planning', compactLabel: 'Plan' },
  ]
  const selectedResultCategory = Math.max(
    0,
    resultCategories.findIndex(({ id }) => id === resultCategory),
  )
  const categoryViews = resultViews.filter(
    ({ category }) => category === resultCategory,
  )
  const categoryResultView = categoryViews.some(
    ({ view, disabled }) => view === visibleResultView && !disabled,
  )
    ? visibleResultView
    : ''
  const selectResultCategory = (selectedIndex: number) => {
    const nextCategory = resultCategories[selectedIndex]
    if (!nextCategory) return
    setResultCategory(nextCategory.id)
    const firstAvailable = resultViews.find(
      ({ category, disabled }) => category === nextCategory.id && !disabled,
    )
    if (firstAvailable) setResultView(firstAvailable.view)
  }
  const update = (values: Partial<RFAnalysisSettings>) =>
    onAnalysisChange({ ...analysis, ...values })
  const exportResults = () => {
    if (!result) return
    const fileName = safeFileName(
      `${projectName}-${visibleResultView === 'nonlinear' ? 'power-sweep' : 'results'}`,
      'csv',
    )
    downloadTextFile(
      fileName,
      visibleResultView === 'nonlinear'
        ? nonlinearSweepToCsv(result)
        : simulationOutputToCsv(result),
      'text/csv;charset=utf-8',
    )
    onExport(fileName)
  }
  const outcomeCenterIndex = result
    ? Math.floor(result.total.frequencyHz.length / 2)
    : 0
  const outcomeCenterS21 = result
    ? magnitudeDb({
        re: result.total.s21.re[outcomeCenterIndex]!,
        im: result.total.s21.im[outcomeCenterIndex]!,
      })
    : null
  const sweepNode = nodes.find((node) => node.id === analysis.sweepNodeId)
  const sweepParameters = useMemo(
    () => (sweepNode ? sweepableParameters(sweepNode) : []),
    [sweepNode],
  )
  const secondSweepNode = nodes.find(
    (node) => node.id === analysis.sweepSecondNodeId,
  )
  const secondSweepParameters = useMemo(
    () => (secondSweepNode ? sweepableParameters(secondSweepNode) : []),
    [secondSweepNode],
  )

  useScientificResultTransition({
    state:
      status === 'running'
        ? 'running'
        : status === 'error'
          ? 'failed'
          : result
            ? result.warnings.length
              ? 'warning'
              : 'up-to-date'
            : 'ready',
    resultRef: outcomeHeading,
  })

  useEffect(() => {
    const changes: Partial<RFAnalysisSettings> = {}
    const first = sweepParameters[0]
    if (sweepNode && !first) {
      changes.sweepNodeId = null
      changes.sweepParameter = null
    } else if (
      first &&
      !sweepParameters.some(([key]) => key === analysis.sweepParameter)
    ) {
      const [start, stop] = defaultSweepRange(first[0], first[1])
      changes.sweepParameter = first[0]
      changes.sweepStart = start
      changes.sweepStop = stop
    }
    const second = secondSweepParameters[0]
    if (secondSweepNode && !second) {
      changes.sweepSecondNodeId = null
      changes.sweepSecondParameter = null
    } else if (
      second &&
      !secondSweepParameters.some(
        ([key]) => key === analysis.sweepSecondParameter,
      )
    ) {
      const [start, stop] = defaultSweepRange(second[0], second[1])
      changes.sweepSecondParameter = second[0]
      changes.sweepSecondStart = start
      changes.sweepSecondStop = stop
    }
    if (Object.keys(changes).length > 0) {
      onAnalysisChange({ ...analysis, ...changes })
    }
  }, [
    analysis,
    onAnalysisChange,
    secondSweepNode,
    secondSweepParameters,
    sweepNode,
    sweepParameters,
  ])

  return (
    <section
      id="rf-results"
      className="results-panel"
      aria-labelledby="results-title"
    >
      <h2 id="results-title" className="sr-only">
        {strings.resultsTitle}
      </h2>
      <ScientificOutcomeSummary
        className="rf-outcome"
        headingLevel={3}
        headingRef={outcomeHeading}
        title={
          result
            ? 'RF simulation outcome'
            : status === 'running'
              ? 'RF simulation running'
              : 'RF simulation'
        }
        status={
          status === 'running'
            ? {
                state: 'running',
                label: 'Solving network',
                detail: 'The worker is evaluating the current model.',
              }
            : status === 'error'
              ? {
                  state: 'failed',
                  label: 'Simulation stopped',
                  detail: error ?? undefined,
                }
              : result?.warnings.length
                ? { state: 'warning', label: 'Solved with warnings' }
                : result
                  ? { state: 'up-to-date', label: 'Result current' }
                  : {
                      state: 'needs-input',
                      label: nodes.length
                        ? 'Ready to simulate'
                        : 'Add RF blocks',
                    }
        }
        summary={
          status === 'error'
            ? (error ?? 'Correct the network and run the simulation again.')
            : result
              ? result.warnings.length
                ? `The network solved, but ${result.warnings.length} warning${result.warnings.length === 1 ? ' requires' : 's require'} review before interpretation.`
                : 'The current network and analysis settings produced a usable result. Review validation before export.'
              : 'Build a connected source-to-load network, then simulate it to reveal the first interpretable result.'
        }
        metrics={
          result
            ? [
                {
                  id: 'center-s21',
                  label: 'Center S21',
                  value: outcomeCenterS21!,
                  unit: 'dB',
                  format: { significantDigits: 4 },
                  status: result.warnings.length ? 'warning' : 'success',
                },
                {
                  id: 'center-frequency',
                  label: 'Center frequency',
                  value: formatFrequency(
                    result.total.frequencyHz[outcomeCenterIndex]!,
                  ),
                },
                {
                  id: 'frequency-points',
                  label: 'Frequency points',
                  value: result.total.frequencyHz.length,
                  format: { notation: 'standard', significantDigits: 8 },
                },
                {
                  id: 'solver-warnings',
                  label: 'Solver warnings',
                  value: result.warnings.length,
                },
              ]
            : []
        }
        actions={
          result
            ? [
                {
                  id: 'export-result',
                  label:
                    visibleResultView === 'nonlinear'
                      ? 'Export power CSV'
                      : 'Export result CSV',
                  emphasis: 'primary',
                  disabled: !categoryResultView,
                  disabledReason: 'Choose an available result view first.',
                  onClick: exportResults,
                },
                {
                  id: 'rerun',
                  label: 'Run again',
                  emphasis: 'secondary',
                  collapseAt: 'sm',
                  onClick: onRun,
                },
              ]
            : [
                {
                  id: 'run',
                  label: status === 'error' ? 'Try again' : 'Run simulation',
                  emphasis: 'primary',
                  disabled: nodes.length === 0 || status === 'running',
                  disabledReason:
                    nodes.length === 0
                      ? 'Add RF blocks before simulating.'
                      : undefined,
                  onClick: onRun,
                },
              ]
        }
      />
      <Tabs
        selectedIndex={selectedResultCategory}
        onChange={({ selectedIndex }) => selectResultCategory(selectedIndex)}
      >
        <div className="results-header">
          {result && (
            <TabList
              activation="automatic"
              aria-label="Analysis views"
              className="results-tabs"
              contained
              fullWidth
              size="sm"
            >
              {resultCategories.map((category) => (
                <Tab aria-label={category.label} key={category.id}>
                  <span className="result-tab-label result-tab-label--full">
                    {category.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="result-tab-label result-tab-label--compact"
                  >
                    {category.compactLabel}
                  </span>
                </Tab>
              ))}
            </TabList>
          )}
          {analysisControlsHost &&
            createPortal(
              <div
                className="analysis-controls"
                aria-label="Frequency analysis settings"
              >
                <CompactNumberField
                  label="Start"
                  unit="GHz"
                  min={0}
                  step={0.01}
                  value={analysis.startHz / 1e9}
                  onChange={(value) => update({ startHz: value * 1e9 })}
                />
                <CompactNumberField
                  label="Stop"
                  unit="GHz"
                  min={0}
                  step={0.01}
                  value={analysis.stopHz / 1e9}
                  onChange={(value) => update({ stopHz: value * 1e9 })}
                />
                <CompactNumberField
                  label="Points"
                  min={2}
                  max={10_001}
                  step={1}
                  value={analysis.points}
                  onChange={(value) => update({ points: value })}
                />
                <CompactNumberField
                  label="Z₀"
                  unit="Ω"
                  min={0.01}
                  step={1}
                  value={analysis.referenceImpedanceOhm}
                  onChange={(value) => update({ referenceImpedanceOhm: value })}
                />
                <Accordion className="analysis-advanced" size="sm">
                  <AccordionItem title="Advanced analysis">
                    <div className="analysis-advanced-grid">
                      <CompactNumberField
                        label="MC runs"
                        min={0}
                        max={500}
                        step={1}
                        value={analysis.monteCarloRuns ?? 0}
                        onChange={(value) => update({ monteCarloRuns: value })}
                      />
                      <CompactNumberField
                        label="MC seed"
                        min={0}
                        max={0xffffffff}
                        step={1}
                        value={analysis.monteCarloSeed ?? 1}
                        onChange={(value) => update({ monteCarloSeed: value })}
                      />
                      <Select
                        className="compact-field compact-select"
                        id="sweep-block"
                        labelText="Sweep block"
                        size="sm"
                        value={analysis.sweepNodeId ?? ''}
                        onChange={(event) => {
                          const selected = nodes.find(
                            (node) => node.id === event.target.value,
                          )
                          const first = selected
                            ? sweepableParameters(selected)[0]
                            : undefined
                          if (!selected || !first) {
                            update({ sweepNodeId: null, sweepParameter: null })
                            return
                          }
                          const [start, stop] = defaultSweepRange(
                            first[0],
                            first[1],
                          )
                          update({
                            sweepNodeId: selected.id,
                            sweepParameter: first[0],
                            sweepStart: start,
                            sweepStop: stop,
                            sweepPoints: analysis.sweepPoints ?? 11,
                          })
                        }}
                      >
                        <option value="">Off</option>
                        {nodes
                          .filter(
                            (node) => sweepableParameters(node).length > 0,
                          )
                          .map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.data.label}
                            </option>
                          ))}
                      </Select>
                      {sweepNode && sweepParameters.length > 0 && (
                        <>
                          <Select
                            className="compact-field compact-select"
                            id="sweep-parameter"
                            labelText="Parameter"
                            size="sm"
                            value={analysis.sweepParameter ?? ''}
                            onChange={(event) => {
                              const nominal =
                                sweepNode.data.parameters[event.target.value]
                              if (typeof nominal !== 'number') return
                              const [start, stop] = defaultSweepRange(
                                event.target.value,
                                nominal,
                              )
                              update({
                                sweepParameter: event.target.value,
                                sweepStart: start,
                                sweepStop: stop,
                              })
                            }}
                          >
                            {sweepParameters.map(([key]) => (
                              <option key={key} value={key}>
                                {key}
                              </option>
                            ))}
                          </Select>
                          <CompactNumberField
                            label="Sweep start"
                            step={0.1}
                            value={analysis.sweepStart ?? 0}
                            onChange={(value) => update({ sweepStart: value })}
                          />
                          <CompactNumberField
                            label="Sweep stop"
                            step={0.1}
                            value={analysis.sweepStop ?? 1}
                            onChange={(value) => update({ sweepStop: value })}
                          />
                          <CompactNumberField
                            label="Sweep points"
                            min={2}
                            max={101}
                            step={1}
                            value={analysis.sweepPoints ?? 11}
                            onChange={(value) => update({ sweepPoints: value })}
                          />
                          <Select
                            className="compact-field compact-select"
                            id="second-sweep-block"
                            labelText="Second block"
                            size="sm"
                            value={analysis.sweepSecondNodeId ?? ''}
                            onChange={(event) => {
                              const selected = nodes.find(
                                (node) => node.id === event.target.value,
                              )
                              const first = selected
                                ? sweepableParameters(selected)[0]
                                : undefined
                              if (!selected || !first) {
                                update({
                                  sweepSecondNodeId: null,
                                  sweepSecondParameter: null,
                                })
                                return
                              }
                              const [start, stop] = defaultSweepRange(
                                first[0],
                                first[1],
                              )
                              update({
                                sweepSecondNodeId: selected.id,
                                sweepSecondParameter: first[0],
                                sweepSecondStart: start,
                                sweepSecondStop: stop,
                                sweepSecondPoints:
                                  analysis.sweepSecondPoints ?? 5,
                              })
                            }}
                          >
                            <option value="">Off (1-D)</option>
                            {nodes
                              .filter(
                                (node) => sweepableParameters(node).length > 0,
                              )
                              .map((node) => (
                                <option key={node.id} value={node.id}>
                                  {node.data.label}
                                </option>
                              ))}
                          </Select>
                          {secondSweepNode &&
                            secondSweepParameters.length > 0 && (
                              <>
                                <Select
                                  className="compact-field compact-select"
                                  id="second-sweep-parameter"
                                  labelText="Second parameter"
                                  size="sm"
                                  value={analysis.sweepSecondParameter ?? ''}
                                  onChange={(event) => {
                                    const nominal =
                                      secondSweepNode.data.parameters[
                                        event.target.value
                                      ]
                                    if (typeof nominal !== 'number') return
                                    const [start, stop] = defaultSweepRange(
                                      event.target.value,
                                      nominal,
                                    )
                                    update({
                                      sweepSecondParameter: event.target.value,
                                      sweepSecondStart: start,
                                      sweepSecondStop: stop,
                                    })
                                  }}
                                >
                                  {secondSweepParameters.map(([key]) => (
                                    <option key={key} value={key}>
                                      {key}
                                    </option>
                                  ))}
                                </Select>
                                <CompactNumberField
                                  label="Second start"
                                  step={0.1}
                                  value={analysis.sweepSecondStart ?? 0}
                                  onChange={(value) =>
                                    update({ sweepSecondStart: value })
                                  }
                                />
                                <CompactNumberField
                                  label="Second stop"
                                  step={0.1}
                                  value={analysis.sweepSecondStop ?? 1}
                                  onChange={(value) =>
                                    update({ sweepSecondStop: value })
                                  }
                                />
                                <CompactNumberField
                                  label="Second points"
                                  min={2}
                                  max={51}
                                  step={1}
                                  value={analysis.sweepSecondPoints ?? 5}
                                  onChange={(value) =>
                                    update({ sweepSecondPoints: value })
                                  }
                                />
                              </>
                            )}
                          <Select
                            className="compact-field compact-select"
                            id="sweep-objective"
                            labelText="Objective"
                            size="sm"
                            value={`${analysis.sweepMetric ?? 's21Db'}:${analysis.sweepObjective ?? 'maximize'}`}
                            onChange={(event) => {
                              const [metric, objective] =
                                event.target.value.split(':')
                              update({
                                sweepMetric:
                                  metric as RFAnalysisSettings['sweepMetric'],
                                sweepObjective:
                                  objective as RFAnalysisSettings['sweepObjective'],
                              })
                            }}
                          >
                            <option value="s21Db:maximize">Maximize S21</option>
                            <option value="loadPowerDbm:maximize">
                              Maximize load power
                            </option>
                            <option value="inputP1Dbm:maximize">
                              Maximize input P1dB
                            </option>
                            <option value="noiseFigureDb:minimize">
                              Minimize noise figure
                            </option>
                          </Select>
                        </>
                      )}
                      <Select
                        className="compact-field compact-select"
                        id="yield-constraint"
                        labelText="Yield constraint"
                        size="sm"
                        value={analysis.sweepConstraintMetric ?? ''}
                        onChange={(event) => {
                          const metric = event.target.value || null
                          update({
                            sweepConstraintMetric:
                              metric as RFAnalysisSettings['sweepConstraintMetric'],
                            sweepConstraintDirection:
                              metric === 'noiseFigureDb'
                                ? 'maximum'
                                : 'minimum',
                            sweepConstraintValue:
                              analysis.sweepConstraintValue ?? 0,
                          })
                        }}
                      >
                        <option value="">None</option>
                        <option value="s21Db">Minimum S21</option>
                        <option value="loadPowerDbm">Minimum load power</option>
                        <option value="inputP1Dbm">Minimum input P1dB</option>
                        <option value="noiseFigureDb">
                          Maximum noise figure
                        </option>
                      </Select>
                      {analysis.sweepConstraintMetric && (
                        <CompactNumberField
                          label="Constraint value"
                          step={0.1}
                          value={analysis.sweepConstraintValue ?? 0}
                          onChange={(value) =>
                            update({ sweepConstraintValue: value })
                          }
                        />
                      )}
                    </div>
                  </AccordionItem>
                </Accordion>
                {result && (
                  <Select
                    className="compact-field compact-select"
                    id="plot-frequency-unit"
                    labelText="Display"
                    size="sm"
                    value={frequencyUnit}
                    disabled={
                      visibleResultView === 'nonlinear' ||
                      visibleResultView === 'smith' ||
                      visibleResultView === 'oscillator' ||
                      visibleResultView === 'antenna'
                    }
                    onChange={(event) =>
                      setFrequencyUnit(event.target.value as FrequencyUnit)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="Hz">Hz</option>
                    <option value="kHz">kHz</option>
                    <option value="MHz">MHz</option>
                    <option value="GHz">GHz</option>
                  </Select>
                )}
              </div>,
              analysisControlsHost,
            )}
        </div>

        {result ? (
          <TabPanels>
            {resultCategories.map((category) => (
              <TabPanel key={category.id}>
                {resultCategory === category.id && (
                  <div id="analysis-tabpanel" className="result-category">
                    <div className="result-view-picker">
                      <Select
                        id={`result-view-${category.id}`}
                        labelText="Analysis view"
                        size="sm"
                        value={categoryResultView}
                        onChange={(event) =>
                          setResultView(event.target.value as ResultView)
                        }
                      >
                        {!categoryResultView && (
                          <option value="">Choose an available view</option>
                        )}
                        {categoryViews.map((view) => (
                          <option
                            disabled={view.disabled}
                            key={view.view}
                            value={view.view}
                          >
                            {view.label}
                          </option>
                        ))}
                      </Select>
                      {categoryViews.some(({ disabled }) => disabled) && (
                        <div
                          className="result-prerequisites"
                          aria-label="Unavailable view requirements"
                        >
                          <strong>Unavailable views</strong>
                          <ul>
                            {categoryViews
                              .filter(({ disabled }) => disabled)
                              .map((view) => (
                                <li key={view.view}>
                                  <span>{view.label}:</span> {view.prerequisite}
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    {categoryResultView ? (
                      <SimulationSummary
                        frequencyUnit={frequencyUnit}
                        resultView={categoryResultView}
                        result={result}
                      />
                    ) : (
                      <div className="results-empty results-empty--category">
                        <div>
                          <strong className="results-empty__title">
                            No analysis available in this group
                          </strong>
                          <p>
                            Complete one of the listed prerequisites to enable a
                            view.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabPanel>
            ))}
          </TabPanels>
        ) : (
          <div id="analysis-tabpanel" aria-live="polite">
            {status === 'error' && error ? (
              <InlineNotification
                className="simulation-message"
                hideCloseButton
                kind="error"
                lowContrast
                title="Simulation stopped"
                subtitle={error}
              />
            ) : (
              <div className="results-empty">
                <div>
                  <strong className="results-empty__title">
                    {strings.resultsTitle}
                  </strong>
                  <p>{strings.resultsPlaceholder}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Tabs>
    </section>
  )
}

function SimulationSummary({
  result,
  resultView,
  frequencyUnit,
}: {
  result: SimulationOutput
  resultView: ResultView
  frequencyUnit: FrequencyUnit
}) {
  const network = result.total
  const centerIndex = Math.floor(network.frequencyHz.length / 2)
  const frequencyConverting =
    result.frequencyPlan.stages.length > 0 ||
    result.frequencyPlan.output.centerHz !== result.frequencyPlan.input.centerHz
  const sParameters = frequencyConverting
    ? ([['Conversion gain', network.s21]] as const)
    : ([
        ['S11', network.s11],
        ['S21', network.s21],
        ['S12', network.s12],
        ['S22', network.s22],
      ] as const)
  const centerFrequencyHz = network.frequencyHz[centerIndex]!

  return (
    <div className="simulation-summary">
      {resultView === 'budget' ? (
        <RFBudgetTable budget={result.budget} />
      ) : resultView === 'frequencyPlan' ? (
        <FrequencyPlanTable plan={result.frequencyPlan} />
      ) : resultView === 'parameters' ? (
        <NetworkParametersTable result={result} />
      ) : resultView === 'monteCarlo' ? (
        <MonteCarloTable result={result} />
      ) : resultView === 'parametricSweep' ? (
        <ParametricSweepTable result={result} />
      ) : (
        <div className="rf-plot-shell">
          <RFPlot
            frequencyUnit={frequencyUnit}
            result={result}
            view={resultView}
          />
        </div>
      )}
      {resultView === 'nonlinear' ? (
        <NonlinearMetrics nonlinear={result.nonlinear} />
      ) : resultView === 'oscillator' ? (
        <OscillatorMetrics result={result} />
      ) : resultView === 'antenna' ? (
        <AntennaMetrics result={result} />
      ) : (
        <div className="metric-grid">
          {sParameters.map(([label, values]) => {
            const complex = {
              re: values.re[centerIndex]!,
              im: values.im[centerIndex]!,
            }
            return (
              <Tile className="metric-card" key={label}>
                <span>{label}</span>
                <strong>{formatDb(magnitudeDb(complex))}</strong>
                <small>
                  {frequencyConverting
                    ? 'Ideal envelope model'
                    : formatDegrees(phaseDegrees(complex))}
                </small>
              </Tile>
            )
          })}
          <Tile className="metric-card metric-card--range">
            <span>
              {frequencyConverting ? 'Input / output' : 'Center / points'}
            </span>
            <strong>{formatFrequency(centerFrequencyHz)}</strong>
            <small>
              {frequencyConverting
                ? `→ ${formatFrequency(result.frequencyPlan.output.centerHz)}`
                : `${network.frequencyHz.length.toLocaleString('en-US')} points`}
            </small>
          </Tile>
          {resultView === 'stability' && (
            <Tile className="metric-card">
              <span>Band-limited causality</span>
              <strong>
                {result.networkChecks.causalityPreEchoEnergyDb === null
                  ? 'Unavailable'
                  : formatDb(result.networkChecks.causalityPreEchoEnergyDb)}
              </strong>
              <small>
                Negative-time S21 energy; resolution{' '}
                {result.networkChecks.causalityTimeResolutionS === null
                  ? 'unavailable'
                  : `${(result.networkChecks.causalityTimeResolutionS * 1e9).toFixed(3)} ns`}
              </small>
            </Tile>
          )}
        </div>
      )}

      {result.stageSummaries.length > 0 && (
        <ol className="stage-list" aria-label="Accumulated stage gain">
          {result.stageSummaries.map((stage) => (
            <li key={stage.nodeId}>
              <span>{stage.label}</span>
              <strong>{formatDb(stage.s21DbAtCenter)}</strong>
            </li>
          ))}
        </ol>
      )}

      {result.warnings.length > 0 && (
        <InlineNotification
          className="simulation-warning"
          hideCloseButton
          kind="warning"
          lowContrast
          title={`${result.warnings.length} simulation ${result.warnings.length === 1 ? 'warning' : 'warnings'}`}
        >
          <ul className="scientific-warning-list">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.frequencyHz ?? index}`}>
                {warning.message}
              </li>
            ))}
          </ul>
        </InlineNotification>
      )}
    </div>
  )
}

function OscillatorMetrics({ result }: { result: SimulationOutput }) {
  const noise = result.oscillatorNoise
  return (
    <div className="metric-grid" aria-label="Oscillator noise metrics">
      <Tile className="metric-card">
        <span>Carrier</span>
        <strong>{formatFrequency(noise.carrierFrequencyHz!)}</strong>
        <small>{noise.pllEnabled ? 'PLL closed' : 'Free-running VCO'}</small>
      </Tile>
      <Tile className="metric-card">
        <span>Integrated phase error</span>
        <strong>{noise.integratedPhaseErrorDeg!.toPrecision(4)}° RMS</strong>
        <small>SSB integration limits from VCO settings</small>
      </Tile>
      <Tile className="metric-card">
        <span>RMS time jitter</span>
        <strong>{(noise.rmsJitterS! * 1e12).toPrecision(4)} ps</strong>
        <small>Derived from carrier frequency</small>
      </Tile>
    </div>
  )
}

function AntennaMetrics({ result }: { result: SimulationOutput }) {
  const antenna = result.antenna
  return (
    <div className="metric-grid" aria-label="Antenna radiation metrics">
      <Tile className="metric-card">
        <span>Directivity / realized gain</span>
        <strong>{antenna.directivityDbi!.toFixed(2)} dBi</strong>
        <small>{antenna.realizedGainDbi!.toFixed(2)} dBi realized</small>
      </Tile>
      <Tile className="metric-card">
        <span>Efficiency / aperture</span>
        <strong>{antenna.efficiencyPercent!.toFixed(1)}%</strong>
        <small>
          {antenna.effectiveApertureM2!.toPrecision(4)} m² effective
        </small>
      </Tile>
      {antenna.mode === 'tx' && (
        <>
          <Tile className="metric-card">
            <span>Radiated power</span>
            <strong>
              {formatBudgetValue(antenna.radiatedPowerDbm, 'dBm')}
            </strong>
            <small>Accepted power × radiation efficiency</small>
          </Tile>
          <Tile className="metric-card">
            <span>EIRP</span>
            <strong>{formatBudgetValue(antenna.eirpDbm, 'dBm')}</strong>
            <small>Accepted power + realized gain</small>
          </Tile>
        </>
      )}
    </div>
  )
}

function ParametricSweepTable({ result }: { result: SimulationOutput }) {
  const sweep = result.parametricSweep
  return (
    <section className="budget-panel" aria-label="Parametric grid optimization">
      <div className="budget-table-wrap">
        <table>
          <caption>
            {sweep.variables.length}-D bounded grid → {sweep.metric}
          </caption>
          <thead>
            <tr>
              {sweep.variables.map((variable) => (
                <th
                  key={`${variable.nodeId}-${variable.parameter}`}
                  scope="col"
                >
                  {variable.nodeLabel}: {variable.parameter}
                </th>
              ))}
              <th scope="col">Metric value</th>
              {sweep.constraint && <th scope="col">Constraint</th>}
              <th scope="col">Feasible</th>
            </tr>
          </thead>
          <tbody>
            {sweep.samples.map((sample, sampleIndex) => (
              <tr key={sampleIndex}>
                {sample.parameterValues.map((value, index) => (
                  <td key={index}>{value.toPrecision(6)}</td>
                ))}
                <td>
                  {Number.isFinite(sample.metricValue)
                    ? sample.metricValue.toFixed(4)
                    : 'Unavailable'}
                </td>
                {sweep.constraint && (
                  <td>
                    {sample.constraintValue !== null &&
                    Number.isFinite(sample.constraintValue)
                      ? sample.constraintValue.toFixed(4)
                      : 'Unavailable'}
                  </td>
                )}
                <td>{sample.feasible ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="budget-assumption">
        Best sampled point ({sweep.objective}):{' '}
        {sweep.bestParameterValues
          .map((value) => value.toPrecision(6))
          .join(' / ')}{' '}
        → {sweep.bestMetricValue?.toFixed(4)}. This is bounded grid search, not
        an unconstrained continuous optimizer.{' '}
        {sweep.constraint &&
          `Constraint: ${sweep.constraint.metric} ${sweep.constraint.direction === 'minimum' ? '≥' : '≤'} ${sweep.constraint.value}.`}
      </p>
    </section>
  )
}

function MonteCarloTable({ result }: { result: SimulationOutput }) {
  return (
    <section
      className="budget-panel"
      aria-label="Monte Carlo tolerance analysis"
    >
      <div className="budget-table-wrap">
        <table>
          <caption>
            {result.monteCarlo.runs} Gaussian tolerance runs · seed{' '}
            {result.monteCarlo.seed}
          </caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Mean</th>
              <th scope="col">σ</th>
              <th scope="col">P05</th>
              <th scope="col">P50</th>
              <th scope="col">P95</th>
            </tr>
          </thead>
          <tbody>
            {result.monteCarlo.metrics.map((metric) => (
              <tr key={metric.key}>
                <th scope="row">{metric.label}</th>
                <td>{`${metric.mean.toFixed(3)} ${metric.unit}`}</td>
                <td>{`${metric.standardDeviation.toFixed(3)} ${metric.unit}`}</td>
                <td>{`${metric.percentile05.toFixed(3)} ${metric.unit}`}</td>
                <td>{`${metric.percentile50.toFixed(3)} ${metric.unit}`}</td>
                <td>{`${metric.percentile95.toFixed(3)} ${metric.unit}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.monteCarlo.yieldPercent !== null && (
        <p className="budget-assumption">
          Estimated yield: {result.monteCarlo.yieldPercent.toFixed(2)}% (
          {result.monteCarlo.passingRuns}/{result.monteCarlo.runs} runs satisfy
          the configured constraint).
        </p>
      )}
      {result.monteCarlo.sensitivities.length > 0 && (
        <div className="budget-table-wrap">
          <table>
            <caption>Strongest linear sensitivity correlations</caption>
            <thead>
              <tr>
                <th scope="col">Tolerance parameter</th>
                <th scope="col">Response</th>
                <th scope="col">Pearson r</th>
              </tr>
            </thead>
            <tbody>
              {result.monteCarlo.sensitivities.map((item) => (
                <tr key={`${item.parameter}-${item.metricKey}`}>
                  <th scope="row">{item.parameter}</th>
                  <td>{item.metricLabel}</td>
                  <td>{item.correlation.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="budget-assumption">
        Tolerances are one-sigma independent Gaussian variables. Use measured
        correlations when component parameters are not independent.
      </p>
    </section>
  )
}

function NetworkParametersTable({ result }: { result: SimulationOutput }) {
  const centerIndex = Math.floor(result.total.frequencyHz.length / 2)
  const conversion = safeTwoPortParameters(result, centerIndex)
  if (typeof conversion === 'string') {
    return (
      <InlineNotification
        className="simulation-message"
        hideCloseButton
        kind="error"
        lowContrast
        title="Parameter conversion unavailable"
        subtitle={conversion}
      />
    )
  }
  const parameters = conversion
  return (
    <section
      className="budget-panel"
      aria-label="Two-port parameter conversions"
    >
      <div className="budget-table-wrap">
        <table>
          <caption>
            Center-frequency parameter matrices at{' '}
            {formatFrequency(result.total.frequencyHz[centerIndex]!)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Matrix</th>
              <th scope="col">11 / A</th>
              <th scope="col">12 / B</th>
              <th scope="col">21 / C</th>
              <th scope="col">22 / D</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Z (Ω)', parameters.z],
                ['Y (S)', parameters.y],
                ['ABCD', parameters.abcd],
              ] as const
            ).map(([label, values]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {values.map((value, index) => (
                  <td key={index}>{formatComplexValue(value)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function safeTwoPortParameters(
  result: SimulationOutput,
  centerIndex: number,
): ReturnType<typeof twoPortParametersAt> | string {
  try {
    return twoPortParametersAt(result.total, centerIndex)
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'Parameter conversion failed.'
  }
}

function NonlinearMetrics({ nonlinear }: { nonlinear: NonlinearSweepResult }) {
  return (
    <>
      <div className="metric-grid" aria-label="Nonlinear chain metrics">
        <Tile className="metric-card">
          <span>Small-signal gain</span>
          <strong>
            {formatBudgetValue(nonlinear.smallSignalGainDb, 'dB')}
          </strong>
          <small>Termination-aware behavioral estimate</small>
        </Tile>
        <Tile className="metric-card">
          <span>Input / output P1dB</span>
          <strong>{formatBudgetValue(nonlinear.inputP1Dbm, 'dBm')}</strong>
          <small>→ {formatBudgetValue(nonlinear.outputP1Dbm, 'dBm')}</small>
        </Tile>
        <Tile className="metric-card">
          <span>Output IP3</span>
          <strong>{formatBudgetValue(nonlinear.outputIp3Dbm, 'dBm')}</strong>
          <small>Two-tone extrapolation</small>
        </Tile>
        <Tile className="metric-card">
          <span>Configured operating point</span>
          <strong>
            {formatBudgetValue(nonlinear.operatingOutputPowerDbm, 'dBm')}
          </strong>
          <small>
            Input {formatBudgetValue(nonlinear.operatingInputPowerDbm, 'dBm')}
          </small>
        </Tile>
        <Tile className="metric-card">
          <span>Output tones</span>
          <strong>
            {nonlinear.toneFrequenciesHz.map(formatFrequency).join(' / ')}
          </strong>
          <small>Spacing {formatFrequency(nonlinear.toneSpacingHz)}</small>
        </Tile>
        <Tile className="metric-card">
          <span>Output IM3 products</span>
          <strong>
            {nonlinear.im3FrequenciesHz.map(formatFrequency).join(' / ')}
          </strong>
          <small>
            Limiting stage: {nonlinear.limitingStageLabel ?? 'unavailable'}
          </small>
        </Tile>
      </div>
      {nonlinear.envelopeSpectrum.length > 0 && (
        <section
          className="budget-panel"
          aria-label="Nonlinear envelope spectrum"
        >
          <div className="budget-table-wrap">
            <table>
              <caption>
                Quasi-static two-tone envelope spectrum at{' '}
                {formatBudgetValue(nonlinear.spectrumInputPowerDbm, 'dBm')} per
                tone
              </caption>
              <thead>
                <tr>
                  <th scope="col">Index</th>
                  <th scope="col">Frequency</th>
                  <th scope="col">Output power</th>
                  <th scope="col">Relative</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Class</th>
                </tr>
              </thead>
              <tbody>
                {nonlinear.envelopeSpectrum.map((line) => (
                  <tr key={line.index}>
                    <td>{line.index > 0 ? `+${line.index}` : line.index}</td>
                    <td>{formatFrequency(line.frequencyHz)}</td>
                    <td>{formatBudgetValue(line.outputPowerDbm, 'dBm')}</td>
                    <td>
                      {formatBudgetValue(line.relativeToStrongestDb, 'dB')}
                    </td>
                    <td>{`${line.phaseDeg.toFixed(2)}°`}</td>
                    <td>{line.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="budget-assumption">
            Spectrum from the sampled memoryless complex-envelope AM/AM–AM/PM
            law. It resolves odd intermodulation sidebands, not carrier
            harmonics or electrical memory.
          </p>
        </section>
      )}
    </>
  )
}

function RFBudgetTable({ budget }: { budget: RFBudgetResult }) {
  return (
    <section className="budget-panel" aria-label="RF cascade budget">
      <p className="budget-assumption">
        Exact center-frequency transducer result:{' '}
        {formatBudgetValue(budget.transducerGainDb, 'dB')} from{' '}
        {budget.sourceImpedanceOhm} Ω to {budget.loadImpedanceOhm} Ω; delivered
        load power {formatBudgetValue(budget.deliveredLoadPowerDbm, 'dBm')};
        noise-wave NF {formatBudgetValue(budget.cascadedNoiseFigureDb, 'dB')}.
      </p>
      <div className="budget-table-wrap">
        <table>
          <caption>
            Termination-aware power budget at{' '}
            {formatFrequency(budget.centerFrequencyHz)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Gain</th>
              <th scope="col">Cumulative gain</th>
              <th scope="col">Output power</th>
              <th scope="col">Cumulative NF</th>
              <th scope="col">Input P1dB</th>
              <th scope="col">Output P1dB</th>
              <th scope="col">Input IP3</th>
              <th scope="col">Output IP3</th>
            </tr>
          </thead>
          <tbody>
            {budget.stages.map((stage) => (
              <tr key={stage.nodeId}>
                <th scope="row">{stage.label}</th>
                <td>{formatBudgetValue(stage.stageGainDb, 'dB')}</td>
                <td>{formatBudgetValue(stage.cumulativeGainDb, 'dB')}</td>
                <td>{formatBudgetValue(stage.outputPowerDbm, 'dBm')}</td>
                <td>
                  {formatBudgetValue(stage.cumulativeNoiseFigureDb, 'dB')}
                </td>
                <td>{formatBudgetValue(stage.cumulativeInputP1Dbm, 'dBm')}</td>
                <td>{formatBudgetValue(stage.cumulativeOutputP1Dbm, 'dBm')}</td>
                <td>{formatBudgetValue(stage.cumulativeInputIp3Dbm, 'dBm')}</td>
                <td>
                  {formatBudgetValue(stage.cumulativeOutputIp3Dbm, 'dBm')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="budget-assumption">
        Signal gain includes source/load mismatch and internal reflections.
        Touchstone Fmin/GammaOpt/Rn data include source mismatch; cascaded NF,
        P1dB, and IP3 remain behavioral estimates. Passive loss uses NF = loss
        at 290 K.
      </p>
      {budget.warnings.length > 0 && (
        <InlineNotification
          className="budget-notification"
          hideCloseButton
          kind="warning"
          lowContrast
          title={`${budget.warnings.length} budget ${budget.warnings.length === 1 ? 'warning' : 'warnings'}`}
        >
          <ul className="scientific-warning-list">
            {budget.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </InlineNotification>
      )}
    </section>
  )
}

function FrequencyPlanTable({ plan }: { plan: FrequencyPlanResult }) {
  return (
    <section
      className="budget-panel frequency-plan-panel"
      aria-label="Mixer frequency and product plan"
    >
      <div className="budget-table-wrap">
        <table>
          <caption>Selected conversion-envelope frequency plan</caption>
          <thead>
            <tr>
              <th scope="col">Mixer</th>
              <th scope="col">Mode</th>
              <th scope="col">Input range</th>
              <th scope="col">LO</th>
              <th scope="col">Output range</th>
            </tr>
          </thead>
          <tbody>
            {plan.stages.map((stage) => (
              <tr key={stage.nodeId}>
                <th scope="row">{stage.label}</th>
                <td data-label="Mode">
                  {stage.mode === 'upconvert' ? 'Sum' : 'Difference'}
                </td>
                <td data-label="Input range">
                  {formatFrequencyRange(stage.input)}
                </td>
                <td data-label="LO">{formatFrequency(stage.loFrequencyHz)}</td>
                <td data-label="Output range">
                  {formatFrequencyRange(stage.output)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="budget-assumption">
        Final center frequency: {formatFrequency(plan.input.centerHz)} →{' '}
        {formatFrequency(plan.output.centerHz)}. The selected product defines
        the chain envelope; declared product levels and phases are also
        propagated through every later mixer.
      </p>
      <div className="budget-table-wrap">
        <table>
          <caption>Image and LO leakage at sweep center</caption>
          <thead>
            <tr>
              <th scope="col">Mixer</th>
              <th scope="col">Image location</th>
              <th scope="col">Image frequency</th>
              <th scope="col">Image rejection</th>
              <th scope="col">LO frequency</th>
              <th scope="col">LO power</th>
              <th scope="col">LO isolation</th>
              <th scope="col">Estimated leakage</th>
            </tr>
          </thead>
          <tbody>
            {plan.stages.map((stage) => (
              <tr key={stage.nodeId}>
                <th scope="row">{stage.label}</th>
                <td data-label="Image location">
                  {stage.imageLocation === 'input' ? 'Input' : 'Output'}
                </td>
                <td data-label="Image frequency">
                  {stage.imageFrequencyHz === null
                    ? 'No positive image'
                    : formatFrequency(stage.imageFrequencyHz)}
                </td>
                <td data-label="Image rejection">
                  {formatBudgetValue(stage.imageRejectionDb, 'dB')}
                </td>
                <td data-label="LO frequency">
                  {formatFrequency(stage.loFrequencyHz)}
                </td>
                <td data-label="LO power">
                  {formatBudgetValue(stage.loPowerDbm, 'dBm')}
                </td>
                <td data-label="LO isolation">
                  {formatBudgetValue(stage.loToOutputIsolationDb, 'dB')}
                </td>
                <td data-label="Estimated leakage">
                  {formatBudgetValue(stage.estimatedLoLeakagePowerDbm, 'dBm')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Accordion className="spur-details" size="sm">
        <AccordionItem title="Low-order mixing products at sweep center">
          <div className="budget-table-wrap">
            <table>
              <caption>
                Default products through order 3 plus measured rows
              </caption>
              <thead>
                <tr>
                  <th scope="col">Mixer</th>
                  <th scope="col">Product</th>
                  <th scope="col">Formula</th>
                  <th scope="col">Order</th>
                  <th scope="col">Frequency</th>
                  <th scope="col">Relative level</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Role</th>
                </tr>
              </thead>
              <tbody>
                {plan.stages.flatMap((stage) =>
                  stage.products.map((product) => (
                    <tr key={`${stage.nodeId}-${product.formula}`}>
                      <th scope="row">{stage.label}</th>
                      <td data-label="Product">{product.label}</td>
                      <td data-label="Formula">{product.formula}</td>
                      <td data-label="Order">{product.order}</td>
                      <td data-label="Frequency">
                        {formatFrequency(product.frequencyHz)}
                      </td>
                      <td data-label="Relative level">
                        {formatBudgetValue(product.relativeLevelDb, 'dB')}
                      </td>
                      <td data-label="Phase">
                        {product.phaseDeg === null
                          ? 'Unavailable'
                          : `${product.phaseDeg.toFixed(2)}°`}
                      </td>
                      <td data-label="Role">
                        {productKindLabel(product.kind)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </AccordionItem>
        <AccordionItem
          title={`Propagated output spectrum (${plan.spectralLines.length} paths)`}
        >
          <div className="budget-table-wrap">
            <table>
              <caption>
                Measured/declared products propagated through every mixer
              </caption>
              <thead>
                <tr>
                  <th scope="col">Frequency</th>
                  <th scope="col">Power</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Conversion path</th>
                </tr>
              </thead>
              <tbody>
                {plan.spectralLines.map((line, index) => (
                  <tr key={`${line.frequencyHz}-${index}`}>
                    <td data-label="Frequency">
                      {formatFrequency(line.frequencyHz)}
                    </td>
                    <td data-label="Power">
                      {formatBudgetValue(line.powerDbm, 'dBm')}
                    </td>
                    <td data-label="Phase">
                      {line.phaseDeg === null
                        ? 'Unavailable'
                        : `${line.phaseDeg.toFixed(2)}°`}
                    </td>
                    <td data-label="Conversion path">{line.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AccordionItem>
      </Accordion>
      <p className="budget-assumption">
        Product frequencies use |m·fIN + n·fLO|. Rejection and isolation are
        declared or measured metadata; absent spur amplitudes are not inferred.
      </p>
    </section>
  )
}

function CompactNumberField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  unit?: string
  value: number
  min?: number
  max?: number
  step: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <NumberInput
      className="compact-field"
      hideSteppers
      iconDescription={`Adjust ${label}`}
      id={id}
      label={`${label}${unit ? ` (${unit})` : ''}`}
      max={max}
      min={min}
      size="sm"
      step={step}
      value={value}
      onChange={(_, { value: nextValue }) => {
        const parsed = Number(nextValue)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
    />
  )
}

function formatDb(value: number): string {
  if (value === Number.NEGATIVE_INFINITY) return '−∞ dB'
  return Number.isFinite(value) ? `${value.toFixed(2)} dB` : '—'
}

function formatDegrees(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)}°` : '—'
}

function formatBudgetValue(value: number | null, unit: 'dB' | 'dBm'): string {
  if (value === null) return '—'
  if (value === Number.POSITIVE_INFINITY) return `∞ ${unit}`
  if (value === Number.NEGATIVE_INFINITY) return `−∞ ${unit}`
  return Number.isFinite(value) ? `${value.toFixed(2)} ${unit}` : '—'
}

function formatComplexValue(value: { re: number; im: number }): string {
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im))
    return 'Unavailable'
  const sign = value.im < 0 ? '−' : '+'
  return `${value.re.toPrecision(5)} ${sign} j${Math.abs(value.im).toPrecision(5)}`
}

function formatFrequency(frequencyHz: number): string {
  return frequencyHz >= 1e9
    ? `${(frequencyHz / 1e9).toFixed(3)} GHz`
    : `${(frequencyHz / 1e6).toFixed(3)} MHz`
}

function formatFrequencyRange(range: FrequencyRange): string {
  return `${formatFrequency(range.startHz)} – ${formatFrequency(range.stopHz)}`
}

function productKindLabel(kind: MixerProduct['kind']): string {
  return {
    desired: 'Selected',
    alternate: 'Alternate',
    feedthrough: 'RF feedthrough',
    leakage: 'LO leakage',
    spur: 'Spur candidate',
  }[kind]
}
