import { ReactFlowProvider } from '@xyflow/react'
import { useState } from 'react'
import {
  BlockLibrary,
  PropertiesPanel,
  SimulationPanel,
  type SimulationStatus,
} from '../components'
import { RFCanvas } from '../diagram/RFCanvas'
import type { RFAnalysisSettings, SimulationOutput } from '../engine/types'
import { simulateInWorker } from '../workers/client'
import { useRFEditorStore } from './store'
import { strings } from './strings'

const initialAnalysis: RFAnalysisSettings = {
  startHz: 0.8e9,
  stopHz: 1.2e9,
  points: 1001,
  referenceImpedanceOhm: 50,
}

export default function App() {
  const nodes = useRFEditorStore((state) => state.nodes)
  const edges = useRFEditorStore((state) => state.edges)
  const [analysis, setAnalysis] = useState<RFAnalysisSettings>(initialAnalysis)
  const [status, setStatus] = useState<SimulationStatus>('idle')
  const [result, setResult] = useState<SimulationOutput | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runSimulation = async () => {
    setStatus('running')
    setError(null)
    try {
      const output = await simulateInWorker({
        analysis,
        nodes: nodes.map((node) => ({
          id: node.id,
          position: node.position,
          data: node.data,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      })
      setResult(output)
      setStatus('success')
    } catch (simulationError) {
      setResult(null)
      setError(
        simulationError instanceof Error
          ? simulationError.message
          : 'Unknown simulation failure.',
      )
      setStatus('error')
    }
  }

  const statusText = {
    idle: 'Linear chain · draft',
    running: 'Simulating in worker…',
    success: 'Validated · complete',
    error: 'Diagram needs attention',
  }[status]

  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <header className="app-header">
          <div className="brand-mark" aria-hidden="true">
            RF
          </div>
          <div>
            <h1>{strings.appName}</h1>
            <p>{strings.version}</p>
          </div>
          <p className="privacy-note">
            <span aria-hidden="true">●</span> {strings.localPrivacy}
          </p>
        </header>

        <main className="workspace">
          <BlockLibrary />
          <section className="canvas-panel" aria-labelledby="canvas-title">
            <div className="canvas-toolbar">
              <div>
                <p className="eyebrow">Workspace</p>
                <h2 id="canvas-title">{strings.canvasTitle}</h2>
              </div>
              <span className={`status-chip status-chip--${status}`}>
                {statusText}
              </span>
            </div>
            <div className="canvas-wrap">
              <RFCanvas />
            </div>
          </section>
          <PropertiesPanel />

          <SimulationPanel
            analysis={analysis}
            error={error}
            onAnalysisChange={setAnalysis}
            onRun={runSimulation}
            result={result}
            status={status}
          />
        </main>
      </div>
    </ReactFlowProvider>
  )
}
