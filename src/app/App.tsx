import { ReactFlowProvider } from '@xyflow/react'
import { BlockLibrary, PropertiesPanel } from '../components'
import { RFCanvas } from '../diagram/RFCanvas'
import { strings } from './strings'

export default function App() {
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
              <span className="status-chip">Linear chain · draft</span>
            </div>
            <div className="canvas-wrap">
              <RFCanvas />
            </div>
          </section>
          <PropertiesPanel />

          <section className="results-panel" aria-labelledby="results-title">
            <div
              className="results-tabs"
              role="tablist"
              aria-label="Analysis views"
            >
              <button type="button" role="tab" aria-selected="true">
                S-parameters
              </button>
              <button type="button" role="tab" aria-selected="false" disabled>
                Phase
              </button>
              <button type="button" role="tab" aria-selected="false" disabled>
                Group delay
              </button>
            </div>
            <div className="results-empty">
              <span className="results-empty__trace" aria-hidden="true" />
              <div>
                <h2 id="results-title">{strings.resultsTitle}</h2>
                <p>{strings.resultsPlaceholder}</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </ReactFlowProvider>
  )
}
