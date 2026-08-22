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
import { Apps, Chemistry, Launch, Layers, Meter } from '@carbon/icons-react'
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
import {
  ScientificAppShell,
  ScientificHeader,
  ScientificRecoveryNotice,
  ScientificRunControl,
  ScientificStatusBar,
  ScientificTaskPanel,
  ScientificToolRail,
  useScientificShortcut,
} from '@jorpago2/scientific-ui'
import type { SimulationStatus } from '../components'
import { RFCanvas, type RFCanvasHandle } from '../diagram/RFCanvas'
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
  const simulationEpochRef = useRef(0)
  const projectOperationRef = useRef(0)
  const selectNode = useRFEditorStore((state) => state.selectNode)
  const workflowTriggerRefs = useRef<
    Partial<Record<WorkflowTool, HTMLButtonElement>>
  >({})
  const rfCanvasRef = useRef<RFCanvasHandle | null>(null)
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
  const [workspaceNotice, setWorkspaceNotice] = useState<{
    kind: 'info' | 'success'
    title: string
    subtitle: string
  } | null>(null)
  const [compactWorkbench, setCompactWorkbench] = useState(
    () => window.matchMedia('(max-width: 65.99rem)').matches,
  )
  const canvasShouldRender =
    activeWorkspaceTab === 0 && !(compactWorkbench && activeTool)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const [canvasHostHasSize, setCanvasHostHasSize] = useState(false)
  const [canvasFocusRequest, setCanvasFocusRequest] = useState(0)
  const [recentProjects, setRecentProjects] = useState<LocalProjectSummary[]>(
    [],
  )

  useEffect(() => {
    if (!canvasShouldRender) {
      const frame = window.requestAnimationFrame(() =>
        setCanvasHostHasSize(false),
      )
      return () => window.cancelAnimationFrame(frame)
    }
    const host = canvasHostRef.current
    if (!host) return
    const update = () => {
      const { width, height } = host.getBoundingClientRect()
      setCanvasHostHasSize(width > 0 && height > 0)
    }
    const observer = new ResizeObserver(update)
    observer.observe(host)
    const frame = window.requestAnimationFrame(update)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [canvasShouldRender])

  useEffect(() => {
    if (!canvasHostHasSize || canvasFocusRequest === 0) return
    let innerFrame = 0
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        rfCanvasRef.current?.focusCanvas()
        setCanvasFocusRequest(0)
      })
    })
    return () => {
      window.cancelAnimationFrame(outerFrame)
      window.cancelAnimationFrame(innerFrame)
    }
  }, [canvasFocusRequest, canvasHostHasSize])
  const [recoveryProject, setRecoveryProject] =
    useState<LocalProjectRecord | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [graphValidation, setGraphValidation] = useState<{
    modelRevision: number
    result: GraphValidationResult
  } | null>(null)

  useEffect(() => {
    if (!workspaceNotice) return
    const timeout = window.setTimeout(() => setWorkspaceNotice(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [workspaceNotice])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 65.99rem)')
    const update = () => setCompactWorkbench(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const closeActiveTool = useCallback(() => {
    if (!activeTool) return
    const trigger = workflowTriggerRefs.current[activeTool]
    setActiveTool(null)
    window.requestAnimationFrame(() => trigger?.focus())
  }, [activeTool])

  const closeSelectedNode = useCallback(() => {
    if (!selectedNodeId) return
    const nodeId = selectedNodeId
    selectNode(null)
    window.requestAnimationFrame(() => {
      if (activeTool && window.matchMedia('(max-width: 65.99rem)').matches) {
        workflowTriggerRefs.current[activeTool]?.focus()
        return
      }
      rfCanvasRef.current?.focusNode(nodeId)
    })
  }, [activeTool, selectNode, selectedNodeId])

  const toggleTool = (tool: WorkflowTool) => {
    if (compactWorkbench && selectedNodeId) {
      selectNode(null)
      if (activeTool === tool) return
    }
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
      if (!cancelled)
        setGraphValidation({
          modelRevision,
          result: validateLinearGraph(project.nodes, project.edges),
        })
    })
    return () => {
      cancelled = true
    }
  }, [activeTool, modelRevision, project])

  useEffect(() => {
    let cancelled = false
    void loadMostRecentProject()
      .then(async (record) => {
        if (cancelled) return
        if (record) setRecoveryProject(record)
        const summaries = await listLocalProjects()
        if (cancelled) return
        setRecentProjects(summaries)
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
          const summaries = await listLocalProjects()
          if (cancelled) return
          setRecentProjects(summaries)
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

  const invalidateSimulation = useCallback(() => {
    simulationEpochRef.current += 1
    const controller = simulationAbortRef.current
    simulationAbortRef.current = null
    controller?.abort()
    setResult(null)
    setResultRevision(null)
    setError(null)
    setStatus('idle')
  }, [])

  const runSimulation = useCallback(async () => {
    if (simulationAbortRef.current) return
    const simulationEpoch = simulationEpochRef.current
    const requestedRevision = modelRevision
    const controller = new AbortController()
    simulationAbortRef.current = controller
    setStatus('running')
    setError(null)
    try {
      const { simulateInWorker } = await import('../workers/client')
      const output = await simulateInWorker(
        {
          analysis,
          nodes: project.nodes,
          edges: project.edges,
        },
        controller.signal,
      )
      if (simulationEpochRef.current !== simulationEpoch) return
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
        if (simulationEpochRef.current !== simulationEpoch) return
        const retainedResult = resultRevision === requestedRevision
        setStatus(retainedResult ? 'success' : 'idle')
        setWorkspaceNotice({
          kind: 'info',
          title: 'Simulation cancelled',
          subtitle: retainedResult
            ? 'The previous result remains current.'
            : 'No result was produced.',
        })
        return
      }
      if (simulationEpochRef.current !== simulationEpoch) return
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

  const escapeShortcut = useMemo(
    () => ({
      id: 'rf:close-or-cancel',
      shortcut: 'Escape',
      displayKeys: ['Esc'],
      description: 'Close the inspector or active tool, or cancel simulation',
      allowInEditable: true,
      enabled:
        Boolean(selectedNodeId) || Boolean(activeTool) || status === 'running',
      priority: 20,
      handler: (event: KeyboardEvent) => {
        event.stopPropagation()
        if (selectedNodeId) {
          closeSelectedNode()
          return
        }
        if (activeTool) {
          closeActiveTool()
          return
        }
        if (status === 'running') simulationAbortRef.current?.abort()
      },
    }),
    [activeTool, closeActiveTool, closeSelectedNode, selectedNodeId, status],
  )
  useScientificShortcut(escapeShortcut)

  const openSelectedProject = async () => {
    if (!selectedProjectId) return
    const operation = ++projectOperationRef.current
    setPersistenceStatus('loading')
    setPersistenceMessage(null)
    try {
      const record = await loadLocalProject(selectedProjectId)
      if (operation !== projectOperationRef.current) return
      if (!record)
        throw new Error('The selected local project no longer exists.')
      invalidateSimulation()
      loadProject(record.project, record.id)
      setRecoveryProject(null)
      setPersistenceReady(true)
      setSelectedProjectId('')
      setPersistenceStatus('saved')
    } catch (storageError) {
      if (operation !== projectOperationRef.current) return
      setPersistenceStatus('error')
      setPersistenceMessage(errorText(storageError))
    }
  }

  const importProject = async (file: File) => {
    const operation = ++projectOperationRef.current
    try {
      if (file.size > MAX_PROJECT_FILE_CHARACTERS) {
        throw new Error('Project file exceeds the 20 MiB MVP limit.')
      }
      const importedProject = parseProjectJson(await file.text())
      if (operation !== projectOperationRef.current) return
      invalidateSimulation()
      loadProject(importedProject)
      setRecoveryProject(null)
      setPersistenceReady(true)
      setSelectedProjectId('')
      setPersistenceStatus('saving')
      setPersistenceMessage('Imported; local autosave pending')
    } catch (importError) {
      if (operation !== projectOperationRef.current) return
      setPersistenceStatus('error')
      setPersistenceMessage(errorText(importError))
    }
  }

  const exportProject = () => {
    try {
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
    } catch (exportError) {
      setPersistenceStatus('error')
      setPersistenceMessage(errorText(exportError))
    }
  }

  const resultIsCurrent = resultRevision === modelRevision
  const currentGraphValidation =
    graphValidation?.modelRevision === modelRevision
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
  const scientificState =
    visibleStatus === 'running'
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
      compact
      label="RF workbench tools"
      activeId={activeTool ?? 'components'}
      expandedId={activeTool}
      onChange={(id) =>
        id === null ? closeActiveTool() : toggleTool(id as WorkflowTool)
      }
      registerItemRef={(id, node) => {
        workflowTriggerRefs.current[id as WorkflowTool] = node ?? undefined
      }}
      items={WORKFLOW_TOOLS.map(({ id, label, icon: ToolIcon }) => ({
        id,
        label,
        icon: <ToolIcon size={20} />,
        controlsId: 'workflow-panel',
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
            <div>
              <dt>Blocks</dt>
              <dd>{nodes.length}</dd>
            </div>
            <div>
              <dt>Connections</dt>
              <dd>{edges.length}</dd>
            </div>
            <div>
              <dt>Selection</dt>
              <dd>{selectedNodeId ? '1 block' : 'None'}</dd>
            </div>
          </dl>
          <div className="workflow-actions">
            <Button
              className="workflow-action"
              disabled={nodes.length === 0}
              kind="secondary"
              size="sm"
              type="button"
              onClick={() => {
                if (compactWorkbench) {
                  closeActiveTool()
                  return
                }
                rfCanvasRef.current?.fitNetwork()
              }}
            >
              Fit network
            </Button>
            <Button
              className="workflow-action"
              disabled={!selectedNodeId}
              kind="ghost"
              size="sm"
              type="button"
              onClick={() => selectNode(null)}
            >
              Clear selection
            </Button>
          </div>
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
            <RFValidationSummary
              analysis={analysis}
              error={error}
              graphValidation={currentGraphValidation}
              modelRevision={modelRevision}
              result={visibleResult}
              resultRevision={resultRevision}
            />
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
      metadata={
        <>
          <span>{nodes.length} blocks</span>
          <span className="status-strip__connection">
            {edges.length} connections
          </span>
          <span className="status-strip__detail">
            {analysis.points} frequency points
          </span>
          <span className="status-strip__detail">
            Z₀ {analysis.referenceImpedanceOhm} Ω
          </span>
        </>
      }
    />
  )

  return (
    <ReactFlowProvider>
      <ScientificAppShell
        className="app-shell"
        recovery={
          recoveryProject && (
            <ScientificRecoveryNotice
              savedAt={new Date(recoveryProject.updatedAt).toISOString()}
              description={`${recoveryProject.project.name} was saved locally. Restore it, or start from the current blank workspace.`}
              onRestore={() => {
                ++projectOperationRef.current
                invalidateSimulation()
                loadProject(recoveryProject.project, recoveryProject.id)
                setRecoveryProject(null)
                setPersistenceReady(true)
                setPersistenceMessage('Previous project restored')
              }}
              onDiscard={() => {
                ++projectOperationRef.current
                setRecoveryProject(null)
                setPersistenceReady(true)
                setPersistenceMessage(
                  'Previous project kept in Recent projects',
                )
              }}
            />
          )
        }
        panelOpen={Boolean(activeTool) && !(compactWorkbench && selectedNodeId)}
        header={
          <>
            <h1 className="scientific-visually-hidden">RF Network Simulator</h1>
            <ScientificHeader
              aria-label="RF Network Simulator"
              product={strings.appName}
              compactProduct={
                <>
                  <span className="rf-header-product-full">RF Network</span>
                  <span className="rf-header-product-short">RF</span>
                </>
              }
              productIcon="rf-circuit"
              descriptor="RF network simulation"
              href="./"
              skipLink={
                <SkipToContent href="#rf-workspace">
                  Skip to RF workspace
                </SkipToContent>
              }
              context={
                <Suspense
                  fallback={
                    <span className="scientific-visually-hidden">
                      Loading project controls
                    </span>
                  }
                >
                  <ProjectToolbar
                    message={persistenceMessage}
                    onExport={exportProject}
                    onImport={importProject}
                    onLoadTemplate={async (templateId) => {
                      const operation = ++projectOperationRef.current
                      const { getRFTemplate } = await import('../templates')
                      if (operation !== projectOperationRef.current) return
                      const template = getRFTemplate(templateId)
                      invalidateSimulation()
                      loadProject(template)
                      setRecoveryProject(null)
                      setPersistenceReady(true)
                      setActiveWorkspaceTab(0)
                      setActiveTool(null)
                      setSelectedProjectId('')
                      setPersistenceStatus('saving')
                      setPersistenceMessage('Editable template loaded')
                      setWorkspaceNotice({
                        kind: 'success',
                        title: 'Template ready',
                        subtitle: `${template.name} loaded. Diagram fitted to the canvas.`,
                      })
                      setCanvasFocusRequest((request) => request + 1)
                    }}
                    onNew={() => {
                      ++projectOperationRef.current
                      invalidateSimulation()
                      newProject()
                      setRecoveryProject(null)
                      setPersistenceReady(true)
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
                </Suspense>
              }
              status={{
                state: scientificState,
                label: statusText,
              }}
              help={{
                summary:
                  'Build a connected source-to-load chain, set the analysis, simulate, then inspect and export current results.',
              }}
              primaryAction={
                <ScientificRunControl
                  size="lg"
                  execution={{
                    state: scientificState,
                    label: statusText,
                    onRun: () => {
                      void runSimulation()
                    },
                    onStop: cancelSimulation,
                    runLabel: 'Simulate',
                    stopLabel: 'Cancel',
                    disabled: nodes.length === 0,
                    disabledReason: 'Add RF blocks before simulating',
                  }}
                />
              }
              secondaryActions={
                <Link
                  className="suite-link"
                  href="https://jorpago2.github.io/"
                  aria-label="Online Simulators & Tools"
                  size="sm"
                >
                  <span className="suite-link__label">All tools</span>
                  <Launch className="suite-link__icon" aria-hidden="true" />
                </Link>
              }
            />
          </>
        }
        navigation={workflowNavigation}
        panel={compactWorkbench && selectedNodeId ? undefined : workflowPanel}
        inspector={
          selectedNodeId ? (
            <Suspense fallback={null}>
              <PropertiesPanel onClose={closeSelectedNode} />
            </Suspense>
          ) : undefined
        }
        statusBar={workbenchStatus}
      >
        <div
          id="rf-workspace"
          className="workspace"
          data-inspector-open={selectedNodeId ? 'true' : undefined}
          tabIndex={-1}
        >
          {workspaceNotice && (
            <InlineNotification
              className="workspace-notice"
              hideCloseButton
              kind={workspaceNotice.kind}
              lowContrast
              title={workspaceNotice.title}
              subtitle={workspaceNotice.subtitle}
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
                    <div className="canvas-wrap" ref={canvasHostRef}>
                      {canvasShouldRender && canvasHostHasSize && (
                        <RFCanvas ref={rfCanvasRef} />
                      )}
                      {canvasShouldRender && nodes.length === 0 && (
                        <div className="canvas-empty">
                          <strong>Start with a block</strong>
                          <p>
                            Add components from the library or load a template.
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
