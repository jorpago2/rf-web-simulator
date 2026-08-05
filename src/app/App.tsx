import { ReactFlowProvider } from '@xyflow/react'
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  BlockLibrary,
  PropertiesPanel,
  SimulationPanel,
  type SimulationStatus,
} from '../components'
import { RFCanvas } from '../diagram/RFCanvas'
import type { RFProject, SimulationOutput } from '../engine/types'
import { downloadTextFile, safeFileName } from '../persistence/download'
import {
  listLocalProjects,
  loadLocalProject,
  loadMostRecentProject,
  saveLocalProject,
  type LocalProjectSummary,
} from '../persistence/indexedDb'
import {
  MAX_PROJECT_FILE_CHARACTERS,
  parseProjectJson,
  serializeProject,
} from '../persistence/projectFile'
import {
  ProjectToolbar,
  type PersistenceStatus,
} from '../persistence/ProjectToolbar'
import { simulateInWorker } from '../workers/client'
import { useRFEditorStore } from './store'
import { strings } from './strings'
import { getRFTemplate } from '../templates'

const SIDE_PANEL_MIN_WIDTH = 180
const SIDE_PANEL_MAX_WIDTH = 360
const CANVAS_MIN_WIDTH = 440

export default function App() {
  const activeProjectId = useRFEditorStore((state) => state.activeProjectId)
  const projectName = useRFEditorStore((state) => state.projectName)
  const analysis = useRFEditorStore((state) => state.analysis)
  const nodes = useRFEditorStore((state) => state.nodes)
  const edges = useRFEditorStore((state) => state.edges)
  const modelRevision = useRFEditorStore((state) => state.modelRevision)
  const setProjectName = useRFEditorStore((state) => state.setProjectName)
  const updateAnalysis = useRFEditorStore((state) => state.updateAnalysis)
  const loadProject = useRFEditorStore((state) => state.loadProject)
  const newProject = useRFEditorStore((state) => state.newProject)
  const [status, setStatus] = useState<SimulationStatus>('idle')
  const [result, setResult] = useState<SimulationOutput | null>(null)
  const [resultRevision, setResultRevision] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>('loading')
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(
    null,
  )
  const [recentProjects, setRecentProjects] = useState<LocalProjectSummary[]>(
    [],
  )
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [sidePanelWidths, setSidePanelWidths] = useState({
    left: 220,
    right: 250,
  })

  const panelMaximumWidth = (side: 'left' | 'right') => {
    const canvasWidth =
      document.querySelector<HTMLElement>('.canvas-panel')?.offsetWidth ??
      CANVAS_MIN_WIDTH
    return Math.min(
      SIDE_PANEL_MAX_WIDTH,
      sidePanelWidths[side] + Math.max(0, canvasWidth - CANVAS_MIN_WIDTH),
    )
  }

  const setSidePanelWidth = (side: 'left' | 'right', width: number) => {
    const nextWidth = Math.min(
      panelMaximumWidth(side),
      Math.max(SIDE_PANEL_MIN_WIDTH, width),
    )
    setSidePanelWidths((current) => ({ ...current, [side]: nextWidth }))
  }

  const startSidePanelResize = (
    side: 'left' | 'right',
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = sidePanelWidths[side]
    const maximumWidth = panelMaximumWidth(side)
    document.body.classList.add('is-resizing-panels')

    const resize = (moveEvent: PointerEvent) => {
      const movement = moveEvent.clientX - startX
      const width = startWidth + (side === 'left' ? movement : -movement)
      setSidePanelWidths((current) => ({
        ...current,
        [side]: Math.min(maximumWidth, Math.max(SIDE_PANEL_MIN_WIDTH, width)),
      }))
    }
    const stop = () => {
      document.body.classList.remove('is-resizing-panels')
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId)
      }
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const resizeSidePanelWithKeyboard = (
    side: 'left' | 'right',
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const direction = side === 'left' ? 1 : -1
    const nextWidth = {
      ArrowLeft: sidePanelWidths[side] - 10 * direction,
      ArrowRight: sidePanelWidths[side] + 10 * direction,
      Home: SIDE_PANEL_MIN_WIDTH,
      End: panelMaximumWidth(side),
    }[event.key]
    if (nextWidth === undefined) return
    event.preventDefault()
    setSidePanelWidth(side, nextWidth)
  }

  const project = useMemo<RFProject>(
    () => ({
      schemaVersion: 3,
      name: projectName.trim() || 'Untitled RF chain',
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
        ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
        ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      })),
      assets: {},
    }),
    [analysis, edges, nodes, projectName],
  )

  useEffect(() => {
    let cancelled = false
    void loadMostRecentProject()
      .then(async (record) => {
        if (cancelled) return
        if (record) loadProject(record.project, record.id)
        setRecentProjects(await listLocalProjects())
        setPersistenceStatus('saved')
      })
      .catch((storageError: unknown) => {
        if (cancelled) return
        setPersistenceStatus('error')
        setPersistenceMessage(errorText(storageError))
      })
      .finally(() => {
        if (!cancelled) setPersistenceReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [loadProject])

  useEffect(() => {
    if (!persistenceReady) return
    let cancelled = false
    const timeout = window.setTimeout(() => {
      setPersistenceStatus('saving')
      setPersistenceMessage(null)
      void saveLocalProject(activeProjectId, project)
        .then(async () => {
          if (cancelled) return
          setRecentProjects(await listLocalProjects())
          setPersistenceStatus('saved')
        })
        .catch((storageError: unknown) => {
          if (cancelled) return
          setPersistenceStatus('error')
          setPersistenceMessage(errorText(storageError))
        })
    }, 600)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [activeProjectId, persistenceReady, project])

  const runSimulation = async () => {
    const requestedRevision = modelRevision
    setStatus('running')
    setError(null)
    try {
      const output = await simulateInWorker({
        analysis,
        nodes: project.nodes,
        edges: project.edges,
      })
      if (useRFEditorStore.getState().modelRevision !== requestedRevision) {
        setStatus('idle')
        return
      }
      setResult(output)
      setResultRevision(requestedRevision)
      setStatus('success')
    } catch (simulationError) {
      setResult(null)
      setResultRevision(null)
      setError(errorText(simulationError))
      setStatus('error')
    }
  }

  const openSelectedProject = async () => {
    if (!selectedProjectId) return
    setPersistenceStatus('loading')
    setPersistenceMessage(null)
    try {
      const record = await loadLocalProject(selectedProjectId)
      if (!record)
        throw new Error('The selected local project no longer exists.')
      loadProject(record.project, record.id)
      setSelectedProjectId('')
      setPersistenceStatus('saved')
    } catch (storageError) {
      setPersistenceStatus('error')
      setPersistenceMessage(errorText(storageError))
    }
  }

  const importProject = async (file: File) => {
    try {
      if (file.size > MAX_PROJECT_FILE_CHARACTERS) {
        throw new Error('Project file exceeds the 20 MiB MVP limit.')
      }
      const importedProject = parseProjectJson(await file.text())
      loadProject(importedProject)
      setSelectedProjectId('')
      setPersistenceStatus('saving')
      setPersistenceMessage('Imported; local autosave pending')
    } catch (importError) {
      setPersistenceStatus('error')
      setPersistenceMessage(errorText(importError))
    }
  }

  const exportProject = () => {
    const fileName = safeFileName(project.name, 'json')
    downloadTextFile(
      fileName,
      serializeProject(project, {
        application: strings.appName,
        version: strings.version,
        exportedAt: new Date().toISOString(),
      }),
      'application/json;charset=utf-8',
    )
    setPersistenceMessage(`Exported ${fileName}`)
  }

  const resultIsCurrent = resultRevision === modelRevision
  const visibleResult = resultIsCurrent ? result : null
  const visibleStatus =
    status === 'running' || status === 'error'
      ? status
      : resultIsCurrent
        ? status
        : 'idle'
  const statusText = {
    idle: 'Linear chain · draft',
    running: 'Simulating in worker…',
    success: 'Validated · complete',
    error: 'Diagram needs attention',
  }[visibleStatus]

  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <a className="skip-link" href="#rf-workspace">Skip to RF workspace</a>
        <header className="app-header">
          <div className="brand-mark" aria-hidden="true">
            RF
          </div>
          <div className="app-identity">
            <h1>{strings.appName}</h1>
            <p>{strings.version}</p>
          </div>
          <ProjectToolbar
            message={persistenceMessage}
            onExport={exportProject}
            onImport={importProject}
            onLoadTemplate={(templateId) => {
              loadProject(getRFTemplate(templateId))
              setSelectedProjectId('')
              setPersistenceStatus('saving')
              setPersistenceMessage('Editable template loaded')
            }}
            onNew={() => {
              newProject()
              setSelectedProjectId('')
              setPersistenceMessage(null)
            }}
            onOpen={openSelectedProject}
            onProjectNameChange={setProjectName}
            onSelectedProjectChange={setSelectedProjectId}
            projectName={projectName}
            recentProjects={recentProjects}
            selectedProjectId={selectedProjectId}
            status={persistenceStatus}
          />
          <a className="suite-link" href="https://jorpago2.github.io/" aria-label="Online Simulators & Tools">All tools</a>
          <p className="privacy-note">
            <span aria-hidden="true">●</span> {strings.localPrivacy}
          </p>
        </header>

        <main
          id="rf-workspace"
          className="workspace"
          tabIndex={-1}
          style={
            {
              '--left-panel-width': `${sidePanelWidths.left}px`,
              '--right-panel-width': `${sidePanelWidths.right}px`,
            } as CSSProperties
          }
        >
          <BlockLibrary />
          <div
            className="panel-resizer panel-resizer--left"
            role="separator"
            aria-label="Resize block library"
            aria-orientation="vertical"
            aria-valuemin={SIDE_PANEL_MIN_WIDTH}
            aria-valuemax={SIDE_PANEL_MAX_WIDTH}
            aria-valuenow={sidePanelWidths.left}
            tabIndex={0}
            onKeyDown={(event) => resizeSidePanelWithKeyboard('left', event)}
            onPointerDown={(event) => startSidePanelResize('left', event)}
          />
          <section className="canvas-panel" aria-labelledby="canvas-title">
            <div className="canvas-toolbar">
              <div>
                <p className="eyebrow">Workspace</p>
                <h2 id="canvas-title">{strings.canvasTitle}</h2>
              </div>
              <span className={`status-chip status-chip--${visibleStatus}`} role="status" aria-live="polite">
                {statusText}
              </span>
            </div>
            <div className="canvas-wrap">
              <RFCanvas />
            </div>
          </section>
          <div
            className="panel-resizer panel-resizer--right"
            role="separator"
            aria-label="Resize properties panel"
            aria-orientation="vertical"
            aria-valuemin={SIDE_PANEL_MIN_WIDTH}
            aria-valuemax={SIDE_PANEL_MAX_WIDTH}
            aria-valuenow={sidePanelWidths.right}
            tabIndex={0}
            onKeyDown={(event) => resizeSidePanelWithKeyboard('right', event)}
            onPointerDown={(event) => startSidePanelResize('right', event)}
          />
          <PropertiesPanel />

          <SimulationPanel
            analysis={analysis}
            nodes={nodes}
            error={status === 'error' ? error : null}
            onAnalysisChange={updateAnalysis}
            onRun={runSimulation}
            onExport={(fileName) =>
              setPersistenceMessage(`Exported ${fileName}`)
            }
            projectName={project.name}
            result={visibleResult}
            status={visibleStatus}
          />
        </main>
      </div>
    </ReactFlowProvider>
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.'
}
