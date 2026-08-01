import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { blockDescriptors } from './diagram/nodeRegistry'
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

export function BlockLibrary() {
  const addNode = useRFEditorStore((state) => state.addNode)

  const startDrag = (event: DragEvent, type: RFNodeType) => {
    event.dataTransfer.setData('application/rf-node-type', type)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside className="panel block-library" aria-labelledby="library-title">
      <div className="panel__heading">
        <p className="eyebrow">Build</p>
        <h2 id="library-title">{strings.libraryTitle}</h2>
        <p>{strings.libraryHint}</p>
      </div>
      <div className="block-list">
        {blockDescriptors.map((block) => (
          <button
            className="block-card"
            draggable
            key={block.type}
            onDragStart={(event) => startDrag(event, block.type)}
            onClick={() => addNode(block.type)}
            type="button"
          >
            <span
              className="block-card__symbol"
              style={{ backgroundColor: block.accent }}
              aria-hidden="true"
            >
              {block.symbol}
            </span>
            <span>
              <strong>{block.label}</strong>
              <small>{block.description}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}

interface FileStatus {
  nodeId: string
  kind: 'success' | 'error'
  message: string
}

export function PropertiesPanel() {
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
    return (
      <aside className="panel properties" aria-labelledby="properties-title">
        <div className="panel__heading">
          <p className="eyebrow">Inspect</p>
          <h2 id="properties-title">{strings.propertiesTitle}</h2>
        </div>
        <p className="empty-state">{strings.emptyProperties}</p>
      </aside>
    )
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
    <aside className="panel properties" aria-labelledby="properties-title">
      <div className="panel__heading">
        <p className="eyebrow">Inspect</p>
        <h2 id="properties-title">{strings.propertiesTitle}</h2>
      </div>
      <label className="field">
        <span>Block name</span>
        <input
          value={node.data.label}
          onChange={(event) => updateLabel(node.id, event.target.value)}
        />
      </label>

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

      {node.data.type === 'load' && (
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

      {node.data.type === 'idealAmplifier' && (
        <>
          <AmplifierModelSources
            table={amplifierTable}
            touchstoneFileName={node.data.parameters.sParameterFileName}
          />
          <label className="field file-field">
            <span>Small-signal Touchstone (optional)</span>
            <input
              type="file"
              accept=".s2p,.ts,text/plain"
              onChange={loadAmplifierSParameters}
            />
          </label>
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
              <button
                className="file-reset-button"
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
              </button>
            </>
          )}
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={node.data.parameters.enforcePassivity === true}
              disabled={
                typeof node.data.parameters.sParameterContent !== 'string'
              }
              onChange={(event) =>
                updateParameters(node.id, {
                  enforcePassivity: event.target.checked,
                })
              }
            />
            <span>Conservatively enforce imported S-parameter passivity</span>
          </label>
          <div className="field file-field">
            <label htmlFor={`device-table-${node.id}`}>
              Datasheet / measured table (optional)
            </label>
            <input
              id={`device-table-${node.id}`}
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-describedby={`device-table-help-${node.id}`}
              onChange={loadDeviceTable}
            />
            <small id={`device-table-help-${node.id}`}>
              CSV: frequency plus gain, NF, OP1dB, OIP3, or Pin/Pout columns.
            </small>
            <a
              href={`${import.meta.env.BASE_URL}examples/device-performance-template.csv`}
              download
            >
              Download CSV template
            </a>
          </div>
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
              <button
                className="file-reset-button"
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
              </button>
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
          <label className="field">
            <span>Conversion mode</span>
            <select
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
            </select>
          </label>
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
          <div className="field file-field">
            <label htmlFor={`mixer-products-${node.id}`}>
              Measured conversion products (optional CSV)
            </label>
            <input
              id={`mixer-products-${node.id}`}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={loadMixerProductTable}
            />
            <small>Columns: m, n, relative_level_db, phase_deg, label.</small>
            {typeof node.data.parameters.productTableFileName === 'string' && (
              <button
                className="file-reset-button"
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
              </button>
            )}
          </div>
        </>
      )}

      {node.data.type === 'touchstone2Port' && (
        <>
          <label className="field file-field">
            <span>Touchstone 1.0/2.0 N-port file</span>
            <input type="file" onChange={loadTouchstone} />
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={node.data.parameters.enforcePassivity === true}
              onChange={(event) =>
                updateParameters(node.id, {
                  enforcePassivity: event.target.checked,
                })
              }
            />
            <span>
              Conservatively enforce passivity (pointwise σmax scaling)
            </span>
          </label>
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
                <label className="field" key={`port-role-${index}`}>
                  <span>Port {index + 1} diagram role</span>
                  <select
                    value={
                      Array.isArray(node.data.parameters.portRoles) &&
                      node.data.parameters.portRoles[index] === 'input'
                        ? 'input'
                        : 'output'
                    }
                    onChange={(event) => {
                      const roles = Array.isArray(
                        node.data.parameters.portRoles,
                      )
                        ? [...node.data.parameters.portRoles]
                        : []
                      roles[index] = event.target.value
                      updateParameters(node.id, { portRoles: roles })
                    }}
                  >
                    <option value="input">Input side</option>
                    <option value="output">Output side</option>
                  </select>
                </label>
              ),
            )}
          {numberValue(node.data.parameters.portCount, 2) === 2 && (
            <details className="file-field">
              <summary>Optional fixture de-embedding</summary>
              {(['left', 'right'] as const).map((side) => (
                <div className="field file-field" key={side}>
                  <label htmlFor={`${side}-fixture-${node.id}`}>
                    {side === 'left' ? 'Input' : 'Output'} fixture (.s2p)
                  </label>
                  <input
                    id={`${side}-fixture-${node.id}`}
                    type="file"
                    accept=".s2p,.ts,text/plain"
                    onChange={loadDeembeddingFixture(side)}
                  />
                  {typeof node.data.parameters[`${side}FixtureFileName`] ===
                    'string' && (
                    <button
                      className="file-reset-button"
                      type="button"
                      onClick={() =>
                        updateParameters(node.id, {
                          [`${side}FixtureFileName`]: null,
                          [`${side}FixtureContent`]: null,
                        })
                      }
                    >
                      Remove {side} fixture
                    </button>
                  )}
                </div>
              ))}
            </details>
          )}
          <BudgetMetadataFields nodeId={node.id} />
        </>
      )}

      {fileStatus?.nodeId === node.id && (
        <p className={`message message--${fileStatus.kind}`} aria-live="polite">
          {fileStatus.message}
        </p>
      )}

      <button
        className="danger-button"
        type="button"
        onClick={removeSelectedNode}
      >
        Delete block
      </button>
    </aside>
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
  disabled = false,
  onChange,
}: {
  label: string
  unit: string
  value: number
  min?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-with-unit">
        <input
          type="number"
          value={value}
          min={min}
          disabled={disabled}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
        <span>{unit}</span>
      </span>
    </label>
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
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-with-unit">
        <input
          type="number"
          value={
            typeof value === 'number' && Number.isFinite(value) ? value : ''
          }
          min={min}
          disabled={disabled}
          placeholder="Not set"
          onChange={(event) =>
            onChange(
              event.target.value === '' ? null : event.target.valueAsNumber,
            )
          }
        />
        <span>{unit}</span>
      </span>
    </label>
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
        !(deviceTable && deviceTableOverridesParameter(deviceTable, key))
      )
    },
  )
}

function defaultSweepRange(key: string, nominal: number): [number, number] {
  const span = Math.max(Math.abs(nominal) * 0.2, 1)
  const nonNegative = new Set([
    'attenuationDb',
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

export function SimulationPanel({
  projectName,
  analysis,
  nodes,
  status,
  result,
  error,
  onAnalysisChange,
  onRun,
}: {
  projectName: string
  analysis: RFAnalysisSettings
  nodes: RFProjectNode[]
  status: SimulationStatus
  result: SimulationOutput | null
  error: string | null
  onAnalysisChange: (analysis: RFAnalysisSettings) => void
  onRun: () => void
}) {
  const [resultView, setResultView] = useState<ResultView>('sParameters')
  const [frequencyUnit, setFrequencyUnit] = useState<FrequencyUnit>('auto')
  const probeViewAvailable = (result?.probeResults.length ?? 0) > 0
  const frequencyPlanAvailable = result
    ? result.frequencyPlan.stages.length > 0 ||
      result.frequencyPlan.output.centerHz !==
        result.frequencyPlan.input.centerHz
    : false
  const nonlinearAvailable = result?.nonlinear.available ?? false
  const monteCarloAvailable = result?.monteCarlo.available ?? false
  const parametricSweepAvailable = result?.parametricSweep.available ?? false
  const visibleResultView =
    (resultView === 'probes' && !probeViewAvailable) ||
    (resultView === 'budget' && !result) ||
    (resultView === 'frequencyPlan' && !frequencyPlanAvailable) ||
    (resultView === 'nonlinear' && !nonlinearAvailable) ||
    (resultView === 'monteCarlo' && !monteCarloAvailable) ||
    (resultView === 'parametricSweep' && !parametricSweepAvailable) ||
    ((resultView === 'phase' || resultView === 'groupDelay') &&
      frequencyPlanAvailable)
      ? 'sParameters'
      : resultView
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not(:disabled)',
      ) ?? [],
    )
    const currentIndex = tabs.indexOf(event.currentTarget)
    if (currentIndex < 0 || tabs.length === 0) return
    event.preventDefault()
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex +
              (event.key === 'ArrowRight' ? 1 : -1) +
              tabs.length) %
            tabs.length
    tabs[nextIndex]?.focus()
    tabs[nextIndex]?.click()
  }
  const resultTabProps = (view: ResultView) => ({
    id: `analysis-tab-${view}`,
    'aria-controls': 'analysis-tabpanel',
    'aria-selected': visibleResultView === view,
    onKeyDown: handleTabKeyDown,
    role: 'tab' as const,
    tabIndex: visibleResultView === view ? 0 : -1,
  })
  const showResults = () =>
    document
      .getElementById('analysis-tabpanel')
      ?.scrollIntoView({ block: 'start' })
  const update = (values: Partial<RFAnalysisSettings>) =>
    onAnalysisChange({ ...analysis, ...values })
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
    <section className="results-panel" aria-labelledby="results-title">
      <h2 id="results-title" className="sr-only">
        {strings.resultsTitle}
      </h2>
      <button
        className="mobile-run-button"
        type="button"
        disabled={status === 'running'}
        onClick={result || status === 'error' ? showResults : onRun}
      >
        {status === 'running'
          ? 'Simulating…'
          : status === 'error'
            ? 'View error'
            : result
              ? 'View results'
              : 'Run simulation'}
      </button>
      <div className="results-header">
        <div
          className="results-tabs"
          role="tablist"
          aria-label="Analysis views"
        >
          <button
            type="button"
            {...resultTabProps('nonlinear')}
            disabled={!nonlinearAvailable}
            title="Chain-level P1dB compression and two-tone IM3 estimate"
            onClick={() => setResultView('nonlinear')}
          >
            Nonlinear
          </button>
          <button
            type="button"
            {...resultTabProps('sParameters')}
            onClick={() => setResultView('sParameters')}
          >
            S-parameters
          </button>
          <button
            type="button"
            {...resultTabProps('smith')}
            onClick={() => setResultView('smith')}
          >
            Smith
          </button>
          <button
            type="button"
            {...resultTabProps('stability')}
            onClick={() => setResultView('stability')}
          >
            Stability
          </button>
          <button
            type="button"
            {...resultTabProps('parameters')}
            onClick={() => setResultView('parameters')}
          >
            Z/Y/ABCD
          </button>
          <button
            type="button"
            {...resultTabProps('monteCarlo')}
            disabled={!monteCarloAvailable}
            onClick={() => setResultView('monteCarlo')}
          >
            Monte Carlo
          </button>
          <button
            type="button"
            {...resultTabProps('parametricSweep')}
            disabled={!parametricSweepAvailable}
            onClick={() => setResultView('parametricSweep')}
          >
            Sweep
          </button>
          <button
            type="button"
            {...resultTabProps('phase')}
            disabled={frequencyPlanAvailable}
            title={
              frequencyPlanAvailable
                ? 'Conversion phase is not defined by the ideal mixer model'
                : undefined
            }
            onClick={() => setResultView('phase')}
          >
            Phase
          </button>
          <button
            type="button"
            {...resultTabProps('groupDelay')}
            disabled={frequencyPlanAvailable}
            title={
              frequencyPlanAvailable
                ? 'Group delay is not defined across ideal frequency conversion'
                : undefined
            }
            onClick={() => setResultView('groupDelay')}
          >
            Group delay
          </button>
          <button
            type="button"
            {...resultTabProps('probes')}
            disabled={!probeViewAvailable}
            title="Cumulative S21 to each probe reference plane, terminated in Z0"
            onClick={() => setResultView('probes')}
          >
            Probes ({result?.probeResults.length ?? 0})
          </button>
          <button
            type="button"
            {...resultTabProps('budget')}
            disabled={!result}
            onClick={() => setResultView('budget')}
          >
            RF budget
          </button>
          <button
            type="button"
            {...resultTabProps('frequencyPlan')}
            disabled={!frequencyPlanAvailable}
            onClick={() => setResultView('frequencyPlan')}
          >
            Frequency plan
          </button>
        </div>
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
          <label className="compact-field compact-select">
            <span>Sweep block</span>
            <select
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
                const [start, stop] = defaultSweepRange(first[0], first[1])
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
                .filter((node) => sweepableParameters(node).length > 0)
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.data.label}
                  </option>
                ))}
            </select>
          </label>
          {sweepNode && sweepParameters.length > 0 && (
            <>
              <label className="compact-field compact-select">
                <span>Parameter</span>
                <select
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
                </select>
              </label>
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
              <label className="compact-field compact-select">
                <span>Second block</span>
                <select
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
                    const [start, stop] = defaultSweepRange(first[0], first[1])
                    update({
                      sweepSecondNodeId: selected.id,
                      sweepSecondParameter: first[0],
                      sweepSecondStart: start,
                      sweepSecondStop: stop,
                      sweepSecondPoints: analysis.sweepSecondPoints ?? 5,
                    })
                  }}
                >
                  <option value="">Off (1-D)</option>
                  {nodes
                    .filter((node) => sweepableParameters(node).length > 0)
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.data.label}
                      </option>
                    ))}
                </select>
              </label>
              {secondSweepNode && secondSweepParameters.length > 0 && (
                <>
                  <label className="compact-field compact-select">
                    <span>Second parameter</span>
                    <select
                      value={analysis.sweepSecondParameter ?? ''}
                      onChange={(event) => {
                        const nominal =
                          secondSweepNode.data.parameters[event.target.value]
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
                    </select>
                  </label>
                  <CompactNumberField
                    label="Second start"
                    step={0.1}
                    value={analysis.sweepSecondStart ?? 0}
                    onChange={(value) => update({ sweepSecondStart: value })}
                  />
                  <CompactNumberField
                    label="Second stop"
                    step={0.1}
                    value={analysis.sweepSecondStop ?? 1}
                    onChange={(value) => update({ sweepSecondStop: value })}
                  />
                  <CompactNumberField
                    label="Second points"
                    min={2}
                    max={51}
                    step={1}
                    value={analysis.sweepSecondPoints ?? 5}
                    onChange={(value) => update({ sweepSecondPoints: value })}
                  />
                </>
              )}
              <label className="compact-field compact-select">
                <span>Objective</span>
                <select
                  value={`${analysis.sweepMetric ?? 's21Db'}:${analysis.sweepObjective ?? 'maximize'}`}
                  onChange={(event) => {
                    const [metric, objective] = event.target.value.split(':')
                    update({
                      sweepMetric: metric as RFAnalysisSettings['sweepMetric'],
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
                </select>
              </label>
            </>
          )}
          <label className="compact-field compact-select">
            <span>Yield constraint</span>
            <select
              value={analysis.sweepConstraintMetric ?? ''}
              onChange={(event) => {
                const metric = event.target.value || null
                update({
                  sweepConstraintMetric:
                    metric as RFAnalysisSettings['sweepConstraintMetric'],
                  sweepConstraintDirection:
                    metric === 'noiseFigureDb' ? 'maximum' : 'minimum',
                  sweepConstraintValue: analysis.sweepConstraintValue ?? 0,
                })
              }}
            >
              <option value="">None</option>
              <option value="s21Db">Minimum S21</option>
              <option value="loadPowerDbm">Minimum load power</option>
              <option value="inputP1Dbm">Minimum input P1dB</option>
              <option value="noiseFigureDb">Maximum noise figure</option>
            </select>
          </label>
          {analysis.sweepConstraintMetric && (
            <CompactNumberField
              label="Constraint value"
              step={0.1}
              value={analysis.sweepConstraintValue ?? 0}
              onChange={(value) => update({ sweepConstraintValue: value })}
            />
          )}
          <label className="compact-field compact-select">
            <span>Display</span>
            <select
              value={frequencyUnit}
              disabled={
                visibleResultView === 'nonlinear' ||
                visibleResultView === 'smith'
              }
              onChange={(event) =>
                setFrequencyUnit(event.target.value as FrequencyUnit)
              }
              aria-label="Plot frequency unit"
            >
              <option value="auto">Auto</option>
              <option value="Hz">Hz</option>
              <option value="kHz">kHz</option>
              <option value="MHz">MHz</option>
              <option value="GHz">GHz</option>
            </select>
          </label>
          <button
            className="run-button"
            type="button"
            disabled={status === 'running'}
            onClick={onRun}
          >
            {status === 'running' ? 'Simulating…' : 'Run simulation'}
          </button>
          <button
            className="export-button"
            type="button"
            disabled={!result}
            onClick={() =>
              result &&
              downloadTextFile(
                safeFileName(
                  `${projectName}-${visibleResultView === 'nonlinear' ? 'power-sweep' : 'results'}`,
                  'csv',
                ),
                visibleResultView === 'nonlinear'
                  ? nonlinearSweepToCsv(result)
                  : simulationOutputToCsv(result),
                'text/csv;charset=utf-8',
              )
            }
          >
            {visibleResultView === 'nonlinear'
              ? 'Export power CSV'
              : 'Export sweep CSV'}
          </button>
        </div>
      </div>

      <div
        id="analysis-tabpanel"
        role="tabpanel"
        aria-labelledby={`analysis-tab-${visibleResultView}`}
        aria-live="polite"
        tabIndex={0}
      >
        {status === 'error' && error && (
          <div className="simulation-message simulation-message--error">
            <strong>Simulation stopped</strong>
            <p>{error}</p>
          </div>
        )}
        {status !== 'error' && result ? (
          <SimulationSummary
            frequencyUnit={frequencyUnit}
            resultView={visibleResultView}
            result={result}
          />
        ) : (
          status !== 'error' && (
            <div className="results-empty">
              <span className="results-empty__trace" aria-hidden="true" />
              <div>
                <strong className="results-empty__title">
                  {strings.resultsTitle}
                </strong>
                <p>{strings.resultsPlaceholder}</p>
              </div>
            </div>
          )
        )}
      </div>
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
      ) : (
        <div className="metric-grid">
          {sParameters.map(([label, values]) => {
            const complex = {
              re: values.re[centerIndex]!,
              im: values.im[centerIndex]!,
            }
            return (
              <div className="metric-card" key={label}>
                <span>{label}</span>
                <strong>{formatDb(magnitudeDb(complex))}</strong>
                <small>
                  {frequencyConverting
                    ? 'Ideal envelope model'
                    : formatDegrees(phaseDegrees(complex))}
                </small>
              </div>
            )
          })}
          <div className="metric-card metric-card--range">
            <span>
              {frequencyConverting ? 'Input / output' : 'Center / points'}
            </span>
            <strong>{formatFrequency(centerFrequencyHz)}</strong>
            <small>
              {frequencyConverting
                ? `→ ${formatFrequency(result.frequencyPlan.output.centerHz)}`
                : `${network.frequencyHz.length.toLocaleString('en-US')} points`}
            </small>
          </div>
          {resultView === 'stability' && (
            <div className="metric-card">
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
            </div>
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
        <ul className="warning-list">
          {result.warnings.map((warning, index) => (
            <li key={`${warning.code}-${warning.frequencyHz ?? index}`}>
              {warning.message}
            </li>
          ))}
        </ul>
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
      <p className="simulation-message simulation-message--error">
        {conversion}
      </p>
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
        <div className="metric-card">
          <span>Small-signal gain</span>
          <strong>
            {formatBudgetValue(nonlinear.smallSignalGainDb, 'dB')}
          </strong>
          <small>Termination-aware behavioral estimate</small>
        </div>
        <div className="metric-card">
          <span>Input / output P1dB</span>
          <strong>{formatBudgetValue(nonlinear.inputP1Dbm, 'dBm')}</strong>
          <small>→ {formatBudgetValue(nonlinear.outputP1Dbm, 'dBm')}</small>
        </div>
        <div className="metric-card">
          <span>Output IP3</span>
          <strong>{formatBudgetValue(nonlinear.outputIp3Dbm, 'dBm')}</strong>
          <small>Two-tone extrapolation</small>
        </div>
        <div className="metric-card">
          <span>Configured operating point</span>
          <strong>
            {formatBudgetValue(nonlinear.operatingOutputPowerDbm, 'dBm')}
          </strong>
          <small>
            Input {formatBudgetValue(nonlinear.operatingInputPowerDbm, 'dBm')}
          </small>
        </div>
        <div className="metric-card">
          <span>Output tones</span>
          <strong>
            {nonlinear.toneFrequenciesHz.map(formatFrequency).join(' / ')}
          </strong>
          <small>Spacing {formatFrequency(nonlinear.toneSpacingHz)}</small>
        </div>
        <div className="metric-card">
          <span>Output IM3 products</span>
          <strong>
            {nonlinear.im3FrequenciesHz.map(formatFrequency).join(' / ')}
          </strong>
          <small>
            Limiting stage: {nonlinear.limitingStageLabel ?? 'unavailable'}
          </small>
        </div>
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
        <ul className="budget-warnings">
          {budget.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
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
                <td>{stage.mode === 'upconvert' ? 'Sum' : 'Difference'}</td>
                <td>{formatFrequencyRange(stage.input)}</td>
                <td>{formatFrequency(stage.loFrequencyHz)}</td>
                <td>{formatFrequencyRange(stage.output)}</td>
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
                <td>{stage.imageLocation === 'input' ? 'Input' : 'Output'}</td>
                <td>
                  {stage.imageFrequencyHz === null
                    ? 'No positive image'
                    : formatFrequency(stage.imageFrequencyHz)}
                </td>
                <td>{formatBudgetValue(stage.imageRejectionDb, 'dB')}</td>
                <td>{formatFrequency(stage.loFrequencyHz)}</td>
                <td>{formatBudgetValue(stage.loPowerDbm, 'dBm')}</td>
                <td>{formatBudgetValue(stage.loToOutputIsolationDb, 'dB')}</td>
                <td>
                  {formatBudgetValue(stage.estimatedLoLeakagePowerDbm, 'dBm')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="spur-details">
        <summary>Low-order mixing products at sweep center</summary>
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
                    <td>{product.label}</td>
                    <td>{product.formula}</td>
                    <td>{product.order}</td>
                    <td>{formatFrequency(product.frequencyHz)}</td>
                    <td>{formatBudgetValue(product.relativeLevelDb, 'dB')}</td>
                    <td>
                      {product.phaseDeg === null
                        ? 'Unavailable'
                        : `${product.phaseDeg.toFixed(2)}°`}
                    </td>
                    <td>{productKindLabel(product.kind)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
      <details className="spur-details">
        <summary>
          Propagated output spectrum ({plan.spectralLines.length} paths)
        </summary>
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
                  <td>{formatFrequency(line.frequencyHz)}</td>
                  <td>{formatBudgetValue(line.powerDbm, 'dBm')}</td>
                  <td>
                    {line.phaseDeg === null
                      ? 'Unavailable'
                      : `${line.phaseDeg.toFixed(2)}°`}
                  </td>
                  <td>{line.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
  return (
    <label className="compact-field">
      <span>{label}</span>
      <span>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            if (Number.isFinite(event.target.valueAsNumber)) {
              onChange(event.target.valueAsNumber)
            }
          }}
        />
        {unit && <small>{unit}</small>}
      </span>
    </label>
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
