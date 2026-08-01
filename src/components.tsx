import { useState, type ChangeEvent, type DragEvent } from 'react'
import { blockDescriptors } from './diagram/nodeRegistry'
import { parseTouchstoneS2P } from './engine/touchstone'
import { magnitudeDb, phaseDegrees } from './engine/complex'
import type {
  RFAnalysisSettings,
  RFNodeType,
  SimulationOutput,
} from './engine/types'
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

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export type SimulationStatus = 'idle' | 'running' | 'success' | 'error'

export function SimulationPanel({
  analysis,
  status,
  result,
  error,
  onAnalysisChange,
  onRun,
}: {
  analysis: RFAnalysisSettings
  status: SimulationStatus
  result: SimulationOutput | null
  error: string | null
  onAnalysisChange: (analysis: RFAnalysisSettings) => void
  onRun: () => void
}) {
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
          <button type="button" role="tab" aria-selected="true">
            S-parameters
          </button>
          <button type="button" role="tab" aria-selected="false" disabled>
            Phase plot
          </button>
          <button type="button" role="tab" aria-selected="false" disabled>
            Group delay
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
          <button
            className="run-button"
            type="button"
            disabled={status === 'running'}
            onClick={onRun}
          >
            {status === 'running' ? 'Simulating…' : 'Run simulation'}
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
          <SimulationSummary result={result} />
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

function SimulationSummary({ result }: { result: SimulationOutput }) {
  const network = result.total
  const centerIndex = Math.floor(network.frequencyHz.length / 2)
  const sParameters = [
    ['S11', network.s11],
    ['S21', network.s21],
    ['S12', network.s12],
    ['S22', network.s22],
  ] as const
  const centerFrequencyHz = network.frequencyHz[centerIndex]!

  return (
    <div className="simulation-summary">
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
              <small>{formatDegrees(phaseDegrees(complex))}</small>
            </div>
          )
        })}
        <div className="metric-card metric-card--range">
          <span>Center / points</span>
          <strong>{formatFrequency(centerFrequencyHz)}</strong>
          <small>
            {network.frequencyHz.length.toLocaleString('en-US')} points
          </small>
        </div>
      </div>

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

function formatFrequency(frequencyHz: number): string {
  return frequencyHz >= 1e9
    ? `${(frequencyHz / 1e9).toFixed(3)} GHz`
    : `${(frequencyHz / 1e6).toFixed(3)} MHz`
}
