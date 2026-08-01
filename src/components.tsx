import { useState, type ChangeEvent, type DragEvent } from 'react'
import { blockDescriptors } from './diagram/nodeRegistry'
import { parseTouchstoneS2P } from './engine/touchstone'
import { magnitudeDb, phaseDegrees } from './engine/complex'
import type {
  FrequencyPlanResult,
  FrequencyRange,
  MixerProduct,
  NonlinearSweepResult,
  RFAnalysisSettings,
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
      const network = parseTouchstoneS2P(content, file.name)
      updateParameters(node.id, {
        fileName: file.name,
        content,
        pointCount: network.frequencyHz.length,
        startHz: network.frequencyHz[0],
        stopHz: network.frequencyHz.at(-1),
        referenceImpedanceOhm: network.referenceImpedanceOhm,
        format: network.format,
      })
      setFileStatus({
        nodeId: node.id,
        kind: 'success',
        message: `${file.name}: ${network.frequencyHz.length} valid points (${network.format}).`,
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
        </>
      )}

      {node.data.type === 'idealAmplifier' && (
        <>
          <NumberField
            label="Gain"
            unit="dB"
            value={numberValue(node.data.parameters.gainDb, 10)}
            onChange={(value) => setNumber('gainDb', value)}
          />
          <PhaseField nodeId={node.id} />
          <BudgetMetadataFields nodeId={node.id} />
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
        </>
      )}

      {node.data.type === 'touchstone2Port' && (
        <>
          <label className="field file-field">
            <span>Touchstone 1.0 file</span>
            <input
              type="file"
              accept=".s2p,text/plain"
              onChange={loadTouchstone}
            />
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
                <dd>{String(node.data.parameters.referenceImpedanceOhm)} Ω</dd>
              </div>
            </dl>
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

function PhaseField({ nodeId }: { nodeId: string }) {
  const node = useRFEditorStore((state) =>
    state.nodes.find((candidate) => candidate.id === nodeId),
  )
  const updateParameters = useRFEditorStore(
    (state) => state.updateNodeParameters,
  )
  if (!node) return null

  return (
    <NumberField
      label="Phase"
      unit="deg"
      value={numberValue(node.data.parameters.phaseDeg, 0)}
      onChange={(value) => updateParameters(nodeId, { phaseDeg: value })}
    />
  )
}

function BudgetMetadataFields({ nodeId }: { nodeId: string }) {
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
        label="Noise figure"
        unit="dB"
        min={0}
        value={node.data.parameters.noiseFigureDb}
        onChange={(value) => update('noiseFigureDb', value)}
      />
      <OptionalNumberField
        label="Output P1dB"
        unit="dBm"
        value={node.data.parameters.outputP1Dbm}
        onChange={(value) => update('outputP1Dbm', value)}
      />
      <OptionalNumberField
        label="Output IP3"
        unit="dBm"
        value={node.data.parameters.outputIp3Dbm}
        onChange={(value) => update('outputIp3Dbm', value)}
      />
    </>
  )
}

function NumberField({
  label,
  unit,
  value,
  min,
  onChange,
}: {
  label: string
  unit: string
  value: number
  min?: number
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
  onChange,
}: {
  label: string
  unit: string
  value: unknown
  min?: number
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

export type SimulationStatus = 'idle' | 'running' | 'success' | 'error'
type ResultView = PlotView | 'budget' | 'frequencyPlan'

export function SimulationPanel({
  projectName,
  analysis,
  status,
  result,
  error,
  onAnalysisChange,
  onRun,
}: {
  projectName: string
  analysis: RFAnalysisSettings
  status: SimulationStatus
  result: SimulationOutput | null
  error: string | null
  onAnalysisChange: (analysis: RFAnalysisSettings) => void
  onRun: () => void
}) {
  const [resultView, setResultView] = useState<ResultView>('sParameters')
  const [frequencyUnit, setFrequencyUnit] = useState<FrequencyUnit>('auto')
  const probeViewAvailable = (result?.probeResults.length ?? 0) > 0
  const frequencyPlanAvailable = (result?.frequencyPlan.stages.length ?? 0) > 0
  const nonlinearAvailable = result?.nonlinear.available ?? false
  const visibleResultView =
    (resultView === 'probes' && !probeViewAvailable) ||
    (resultView === 'budget' && !result) ||
    (resultView === 'frequencyPlan' && !frequencyPlanAvailable) ||
    (resultView === 'nonlinear' && !nonlinearAvailable) ||
    ((resultView === 'phase' || resultView === 'groupDelay') &&
      frequencyPlanAvailable)
      ? 'sParameters'
      : resultView
  const update = (values: Partial<RFAnalysisSettings>) =>
    onAnalysisChange({ ...analysis, ...values })

  return (
    <section className="results-panel" aria-labelledby="results-title">
      <div className="results-header">
        <div
          className="results-tabs"
          role="tablist"
          aria-label="Analysis views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={visibleResultView === 'nonlinear'}
            disabled={!nonlinearAvailable}
            title="Chain-level P1dB compression and two-tone IM3 estimate"
            onClick={() => setResultView('nonlinear')}
          >
            Nonlinear
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visibleResultView === 'sParameters'}
            onClick={() => setResultView('sParameters')}
          >
            S-parameters
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visibleResultView === 'phase'}
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
            role="tab"
            aria-selected={visibleResultView === 'groupDelay'}
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
            role="tab"
            aria-selected={visibleResultView === 'probes'}
            disabled={!probeViewAvailable}
            title="Cumulative S21 to each probe reference plane, terminated in Z0"
            onClick={() => setResultView('probes')}
          >
            Probes ({result?.probeResults.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visibleResultView === 'budget'}
            disabled={!result}
            onClick={() => setResultView('budget')}
          >
            RF budget
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visibleResultView === 'frequencyPlan'}
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
          <label className="compact-field compact-select">
            <span>Display</span>
            <select
              value={frequencyUnit}
              disabled={visibleResultView === 'nonlinear'}
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

      <div aria-live="polite">
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
                <h2 id="results-title">{strings.resultsTitle}</h2>
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
  const frequencyConverting = result.frequencyPlan.stages.length > 0
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

function NonlinearMetrics({ nonlinear }: { nonlinear: NonlinearSweepResult }) {
  return (
    <div className="metric-grid" aria-label="Nonlinear chain metrics">
      <div className="metric-card">
        <span>Small-signal gain</span>
        <strong>{formatBudgetValue(nonlinear.smallSignalGainDb, 'dB')}</strong>
        <small>Matched chain estimate</small>
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
    </div>
  )
}

function RFBudgetTable({ budget }: { budget: RFBudgetResult }) {
  return (
    <section className="budget-panel" aria-label="Matched RF cascade budget">
      <div className="budget-table-wrap">
        <table>
          <caption>
            Matched available-power budget at{' '}
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
        Matched, unilateral stage estimate. Passive loss uses NF = loss at 290
        K; P1dB uses the first-limit approximation.
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
      aria-label="Ideal mixer frequency plan"
    >
      <div className="budget-table-wrap">
        <table>
          <caption>Ideal sum/difference frequency plan</caption>
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
        {formatFrequency(plan.output.centerHz)}. Only the selected ideal product
        is retained.
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
            <caption>Products through total order 3</caption>
            <thead>
              <tr>
                <th scope="col">Mixer</th>
                <th scope="col">Product</th>
                <th scope="col">Formula</th>
                <th scope="col">Order</th>
                <th scope="col">Frequency</th>
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
                    <td>{productKindLabel(product.kind)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
      <p className="budget-assumption">
        Product frequencies use |m·fIN + n·fLO|. Rejection and isolation are
        user metadata; nonlinear spur amplitudes are not inferred.
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
