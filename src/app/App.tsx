import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useMemo, useState } from 'react'
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

  const project = useMemo<RFProject>(
    () => ({
      schemaVersion: 1,
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
    downloadTextFile(
      safeFileName(project.name, 'json'),
      serializeProject(project),
      'application/json;charset=utf-8',
    )
  }

  const resultIsCurrent = resultRevision === modelRevision
  const visibleResult = resultIsCurrent ? result : null
  const visibleStatus =
    status === 'running' ? status : resultIsCurrent ? status : 'idle'
  const statusText = {
    idle: 'Linear chain · draft',
    running: 'Simulating in worker…',
    success: 'Validated · complete',
    error: 'Diagram needs attention',
  }[visibleStatus]

  return (
    <ReactFlowProvider>
      <div className="app-shell">
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
              <span className={`status-chip status-chip--${visibleStatus}`}>
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
            error={resultIsCurrent ? error : null}
            onAnalysisChange={updateAnalysis}
            onRun={runSimulation}
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
