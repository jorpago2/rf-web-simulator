import { ReactFlowProvider } from '@xyflow/react'
import {
  Button,
  InlineNotification,
  Link,
  SkipToContent,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  preview__IconIndicator as IconIndicator,
} from '@carbon/react'
import {
  Apps,
  Chemistry,
  Launch,
  Layers,
  Meter,
} from '@carbon/icons-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ScientificAppShell, ScientificHeader, ScientificRecoveryNotice, ScientificRunControl, ScientificStatusBar, ScientificTaskPanel, ScientificToolRail, useScientificShortcut } from '@jorpago2/scientific-ui'
import type { SimulationStatus } from '../components'
import { RFCanvas } from '../diagram/RFCanvas'
import type { RFProject, SimulationOutput } from '../engine/types'
import type { GraphValidationResult } from '../engine/validation'
import { downloadTextFile, safeFileName } from '../persistence/download'
import {
  listLocalProjects,
  loadLocalProject,
  loadMostRecentProject,
  saveLocalProject,
  type LocalProjectRecord,
  type LocalProjectSummary,
} from '../persistence/indexedDb'
import {
  MAX_PROJECT_FILE_CHARACTERS,
  parseProjectJson,
  serializeProject,
} from '../persistence/projectFile'
import type { PersistenceStatus } from '../persistence/ProjectToolbar'
import { simulateInWorker } from '../workers/client'
import { useRFEditorStore } from './store'
import { strings } from './strings'

const STATUS_INDICATOR_KIND = {
  idle: 'incomplete',
  running: 'in-progress',
  success: 'succeeded',
  error: 'failed',
} as const
type WorkflowTool = 'components' | 'canvas' | 'experiment' | 'review'
const WORKFLOW_TOOLS: {
  id: WorkflowTool
  label: string
  icon: typeof Apps
}[] = [
  { id: 'components', label: 'Build', icon: Apps },
  { id: 'canvas', label: 'Configure', icon: Layers },
  { id: 'experiment', label: 'Run', icon: Chemistry },
  { id: 'review', label: 'Review', icon: Meter },
]
const loadWorkbenchComponents = () => import('../components')
const BlockLibrary = lazy(() =>
  loadWorkbenchComponents().then((module) => ({
    default: module.BlockLibrary,
  })),
)
const PropertiesPanel = lazy(() =>
  loadWorkbenchComponents().then((module) => ({
    default: module.PropertiesPanel,
  })),
)
const SimulationPanel = lazy(() =>
  loadWorkbenchComponents().then((module) => ({
    default: module.SimulationPanel,
  })),
)
const ProjectToolbar = lazy(() =>
  import('../persistence/ProjectToolbar').then((module) => ({
    default: module.ProjectToolbar,
  })),
)
const RFValidationSummary = lazy(() => import('./RFValidationSummary'))

export default function App() {
  const activeProjectId = useRFEditorStore((state) => state.activeProjectId)
  const projectName = useRFEditorStore((state) => state.projectName)
  const analysis = useRFEditorStore((state) => state.analysis)
  const nodes = useRFEditorStore((state) => state.nodes)
  const edges = useRFEditorStore((state) => state.edges)
  const selectedNodeId = useRFEditorStore((state) => state.selectedNodeId)
  const modelRevision = useRFEditorStore((state) => state.modelRevision)
  const setProjectName = useRFEditorStore((state) => state.setProjectName)
  const updateAnalysis = useRFEditorStore((state) => state.updateAnalysis)
  const loadProject = useRFEditorStore((state) => state.loadProject)
  const newProject = useRFEditorStore((state) => state.newProject)
  const [status, setStatus] = useState<SimulationStatus>('idle')
  const [result, setResult] = useState<SimulationOutput | null>(null)
  const [resultRevision, setResultRevision] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const simulationAbortRef = useRef<AbortController | null>(null)
  const selectNode = useRFEditorStore((state) => state.selectNode)
  const workflowTriggerRefs = useRef<
    Partial<Record<WorkflowTool, HTMLButtonElement>>
  >({})
  const [activeTool, setActiveTool] = useState<WorkflowTool | null>(null)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState(0)
  const [analysisControlsHost, setAnalysisControlsHost] =
    useState<HTMLDivElement | null>(null)
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>('loading')
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(
    null,
  )
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const [recentProjects, setRecentProjects] = useState<LocalProjectSummary[]>(
    [],
  )
  const [recoveryProject, setRecoveryProject] =
    useState<LocalProjectRecord | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [graphValidation, setGraphValidation] =
    useState<{ modelRevision: number; result: GraphValidationResult } | null>(null)

  useEffect(() => {
    if (!workspaceNotice) return
    const timeout = window.setTimeout(() => setWorkspaceNotice(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [workspaceNotice])

  const closeActiveTool = useCallback(() => {
    if (!activeTool) return
    const trigger = workflowTriggerRefs.current[activeTool]
    setActiveTool(null)
    window.requestAnimationFrame(() => trigger?.focus())
  }, [activeTool])

  const toggleTool = (tool: WorkflowTool) => {
    if (activeTool === tool) {
      closeActiveTool()
      return
    }
    if (tool === 'components' || tool === 'canvas') setActiveWorkspaceTab(0)
    if (tool === 'review') setActiveWorkspaceTab(1)
    setActiveTool(tool)
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
    if (activeTool !== 'review') return
    let cancelled = false
    void import('../engine/validation').then(({ validateLinearGraph }) => {
      if (!cancelled) setGraphValidation({
        modelRevision,
        result: validateLinearGraph(project.nodes, project.edges),
      })
    })
    return () => { cancelled = true }
  }, [activeTool, modelRevision, project])

  useEffect(() => {
    let cancelled = false
    void loadMostRecentProject()
      .then(async (record) => {
        if (cancelled) return
        if (record) setRecoveryProject(record)
        setRecentProjects(await listLocalProjects())
        setPersistenceStatus('saved')
        if (!record) setPersistenceReady(true)
      })
      .catch((storageError: unknown) => {
        if (cancelled) return
        setPersistenceStatus('error')
        setPersistenceMessage(errorText(storageError))
        setPersistenceReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const runSimulation = useCallback(async () => {
    const requestedRevision = modelRevision
    const controller = new AbortController()
    simulationAbortRef.current = controller
    setStatus('running')
    setError(null)
    try {
      const output = await simulateInWorker(
        {
          analysis,
          nodes: project.nodes,
          edges: project.edges,
        },
        controller.signal,
      )
      if (useRFEditorStore.getState().modelRevision !== requestedRevision) {
        setStatus('idle')
        return
      }
      setResult(output)
      setResultRevision(requestedRevision)
      setStatus('success')
      setActiveTool(null)
      setActiveWorkspaceTab(1)
    } catch (simulationError) {
      if (
        simulationError instanceof DOMException &&
        simulationError.name === 'AbortError'
      ) {
        setStatus(resultRevision === requestedRevision ? 'success' : 'idle')
        return
      }
      setResult(null)
      setResultRevision(null)
      setError(errorText(simulationError))
      setStatus('error')
      setActiveTool(null)
      setActiveWorkspaceTab(1)
    } finally {
      if (simulationAbortRef.current === controller) {
        simulationAbortRef.current = null
      }
    }
  }, [analysis, modelRevision, project.edges, project.nodes, resultRevision])

  const cancelSimulation = () => simulationAbortRef.current?.abort()

  const escapeShortcut = useMemo(() => ({
    id: 'rf:close-or-cancel',
    shortcut: 'Escape',
    displayKeys: ['Esc'],
    description: 'Close the active tool or cancel simulation',
    enabled: Boolean(activeTool) || status === 'running',
    priority: 20,
    handler: () => {
      if (activeTool) closeActiveTool()
      if (status === 'running') simulationAbortRef.current?.abort()
    },
  }), [activeTool, closeActiveTool, status])
  useScientificShortcut(escapeShortcut)

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
  const currentGraphValidation = graphValidation?.modelRevision === modelRevision
    ? graphValidation.result
    : null
  const visibleResult = resultIsCurrent ? result : null
  const visibleStatus =
    status === 'running' || status === 'error'
      ? status
      : resultIsCurrent
        ? status
        : 'idle'
  const statusText = {
    idle: nodes.length ? 'Linear chain · draft' : 'Empty chain · add blocks',
    running: 'Simulating in worker…',
    success: 'Solved · review validation',
    error: 'Diagram needs attention',
  }[visibleStatus]
  const scientificState = visibleStatus === 'running'
    ? 'running'
    : visibleStatus === 'error'
      ? 'failed'
      : visibleStatus === 'success'
        ? 'up-to-date'
        : nodes.length
          ? 'modified'
          : 'needs-input'

  const workflowNavigation = (
    <ScientificToolRail
      className="tool-rail"
      label="RF workbench tools"
      activeId={activeTool ?? 'components'}
      expandedId={activeTool}
      onChange={(id) => id === null ? closeActiveTool() : toggleTool(id as WorkflowTool)}
      registerItemRef={(id, node) => { workflowTriggerRefs.current[id as WorkflowTool] = node ?? undefined }}
      items={WORKFLOW_TOOLS.map(({ id, label, icon: ToolIcon }) => ({
        id,
        label,
        icon: <ToolIcon size={20} />,
        controlsId: "workflow-panel",
      }))}
    />
  )

  const workflowPanel = activeTool ? (
    <>
      {activeTool === 'components' && (
        <Suspense fallback={null}>
          <BlockLibrary open onClose={closeActiveTool} />
        </Suspense>
      )}
      {activeTool === 'canvas' && (
        <WorkflowPanel
          description="Viewport and diagram-level controls. Object parameters remain in the contextual inspector."
          title="Configure canvas"
          onClose={closeActiveTool}
        >
          <dl className="workflow-summary">
            <div><dt>Blocks</dt><dd>{nodes.length}</dd></div>
            <div><dt>Connections</dt><dd>{edges.length}</dd></div>
            <div><dt>Selection</dt><dd>{selectedNodeId ? '1 block' : 'None'}</dd></div>
          </dl>
          <Button
            disabled={!selectedNodeId}
            kind="secondary"
            size="sm"
            type="button"
            onClick={() => selectNode(null)}
          >
            Clear selection
          </Button>
          <p className="workflow-note">
            Use the viewport controls to zoom or fit the network. Drag blocks to
            position them; Delete removes the selected block.
          </p>
        </WorkflowPanel>
      )}
      {activeTool === 'experiment' && (
        <WorkflowPanel
          description="Configure the sweep, uncertainty study, and solver, then run the RF chain."
          title="Run setup"
          onClose={closeActiveTool}
        >
          <div ref={setAnalysisControlsHost} />
        </WorkflowPanel>
      )}
      {activeTool === 'review' && (
        <WorkflowPanel
          description="Current solver and validation state. Detailed scientific views remain in Results."
          title="Review"
          onClose={closeActiveTool}
        >
          <Suspense fallback={<p>Checking model…</p>}>
            <RFValidationSummary analysis={analysis} error={error} graphValidation={currentGraphValidation} modelRevision={modelRevision} result={visibleResult} resultRevision={resultRevision} />
          </Suspense>
        </WorkflowPanel>
      )}
    </>
  ) : undefined

  const workbenchStatus = (
    <ScientificStatusBar
      className="status-strip"
      aria-label="Scientific status"
      status={{ state: scientificState, label: statusText }}
      metadata={<>
        <span>{nodes.length} blocks</span>
        <span className="status-strip__connection">{edges.length} connections</span>
        <span className="status-strip__detail">{analysis.points} frequency points</span>
        <span className="status-strip__detail">Z₀ {analysis.referenceImpedanceOhm} Ω</span>
      </>}
    />
  )

  return (
    <ReactFlowProvider>
      <ScientificAppShell
        className="app-shell"
        recovery={recoveryProject && <ScientificRecoveryNotice
          savedAt={new Date(recoveryProject.updatedAt).toISOString()}
          description={`${recoveryProject.project.name} was saved locally. Restore it, or start from the current blank workspace.`}
          onRestore={() => {
            loadProject(recoveryProject.project, recoveryProject.id)
            setRecoveryProject(null)
            setPersistenceReady(true)
            setPersistenceMessage('Previous project restored')
          }}
          onDiscard={() => {
            setRecoveryProject(null)
            setPersistenceReady(true)
            setPersistenceMessage('Previous project kept in Recent projects')
          }}
        />}
        panelOpen={Boolean(activeTool)}
        header={<>
          <h1 className="scientific-visually-hidden">RF Network Simulator</h1>
          <ScientificHeader
            aria-label="RF Network Simulator"
            product={strings.appName}
            productIcon="rf-circuit"
            descriptor="RF network simulation"
            href="./"
            skipLink={<SkipToContent href="#rf-workspace">Skip to RF workspace</SkipToContent>}
            context={<Suspense fallback={<span aria-label="Loading project controls" />}>
              <ProjectToolbar
                message={persistenceMessage}
                onExport={exportProject}
                onImport={importProject}
                onLoadTemplate={async (templateId) => {
                  const { getRFTemplate } = await import('../templates')
                  const template = getRFTemplate(templateId)
                  loadProject(template)
                  setActiveWorkspaceTab(0)
                  setActiveTool(null)
                  setSelectedProjectId('')
                  setPersistenceStatus('saving')
                  setPersistenceMessage('Editable template loaded')
                  setWorkspaceNotice(
                    `${template.name} loaded. Diagram fitted to the canvas.`,
                  )
                  window.requestAnimationFrame(() =>
                    window.requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(
                          '[aria-label="RF block diagram editor"]',
                        )
                        ?.focus(),
                    ),
                  )
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
            </Suspense>}
            status={{
              state: scientificState,
              label: statusText,
            }}
            help={{
              summary: 'Build a connected source-to-load chain, set the analysis, simulate, then inspect and export current results.',
            }}
            primaryAction={<ScientificRunControl
              size="lg"
              execution={{
                state: scientificState,
                label: statusText,
                onRun: () => { void runSimulation() },
                onStop: cancelSimulation,
                runLabel: 'Simulate',
                stopLabel: 'Cancel',
                disabled: nodes.length === 0,
                disabledReason: 'Add RF blocks before simulating',
              }}
            />}
            secondaryActions={<Link
              className="suite-link"
              href="https://jorpago2.github.io/"
              aria-label="Online Simulators & Tools"
              size="sm"
            >
              <span className="suite-link__label">All tools</span>
              <Launch className="suite-link__icon" aria-hidden="true" />
            </Link>}
          />
        </>}
        navigation={workflowNavigation}
        panel={workflowPanel}
        inspector={<Suspense fallback={null}><PropertiesPanel /></Suspense>}
        statusBar={workbenchStatus}
      >
          <div
            id="rf-workspace"
            className="workspace"
            tabIndex={-1}
          >
            {workspaceNotice && (
              <InlineNotification
                className="workspace-notice"
                hideCloseButton
                kind="success"
                lowContrast
                title="Template ready"
                subtitle={workspaceNotice}
              />
            )}
            <div className="workbench-deck scientific-stage">
              <Tabs
                selectedIndex={activeWorkspaceTab}
                onChange={({ selectedIndex }) =>
                  setActiveWorkspaceTab(selectedIndex)
                }
              >
                <TabList
                  activation="automatic"
                  aria-label="Workbench view"
                  className="workbench-view-tabs"
                  contained
                  fullWidth
                  size="sm"
                >
                  <Tab>Schematic</Tab>
                  <Tab>Results</Tab>
                </TabList>
                <TabPanels>
                  <TabPanel className="workbench-tab-panel">
                    <section
                      id="rf-canvas"
                      className="canvas-panel scientific-stage"
                      aria-labelledby="canvas-title"
                    >
                      <div className="canvas-toolbar scientific-stage__header">
                        <div>
                          <h2 id="canvas-title">{strings.canvasTitle}</h2>
                        </div>
                        <IconIndicator
                          className="status-chip"
                          kind={STATUS_INDICATOR_KIND[visibleStatus]}
                          label={statusText}
                        />
                      </div>
                      <div className="canvas-wrap">
                        <RFCanvas />
                        {nodes.length === 0 && (
                          <div className="canvas-empty">
                            <strong>Start with a block</strong>
                            <p>
                              Add components from the library or load a
                              template.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                  </TabPanel>
                  <TabPanel className="workbench-tab-panel workbench-tab-panel--results">
                    <Suspense fallback={null}>
                      <SimulationPanel
                        analysis={analysis}
                        analysisControlsHost={analysisControlsHost}
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
                    </Suspense>
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </div>
          </div>
      </ScientificAppShell>
    </ReactFlowProvider>
  )
}

function WorkflowPanel({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  description: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <ScientificTaskPanel
      id="workflow-panel"
      className="panel workflow-panel"
      titleId="workflow-panel-title"
      title={title}
      eyebrow="Workflow"
      closeLabel="Close"
      onClose={onClose}
      bodyClassName="workflow-panel__body"
    >
      <p className="workflow-panel__description">{description}</p>
      {children}
    </ScientificTaskPanel>
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.'
}
