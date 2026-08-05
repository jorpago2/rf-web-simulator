import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { create } from 'zustand'
import { createNodeData } from '../diagram/nodeRegistry'
import type {
  RFAnalysisSettings,
  RFNodeData,
  RFNodeType,
  RFProject,
} from '../engine/types'

export type RFCanvasNode = Node<RFNodeData, RFNodeType>
export type RFCanvasEdge = Edge

export const INITIAL_ANALYSIS: RFAnalysisSettings = {
  startHz: 0.8e9,
  stopHz: 1.2e9,
  points: 1001,
  referenceImpedanceOhm: 50,
  monteCarloRuns: 0,
  monteCarloSeed: 1,
}

interface RFEditorState {
  activeProjectId: string
  projectName: string
  analysis: RFAnalysisSettings
  nodes: RFCanvasNode[]
  edges: RFCanvasEdge[]
  selectedNodeId: string | null
  modelRevision: number
  onNodesChange: (changes: NodeChange<RFCanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange<RFCanvasEdge>[]) => void
  onConnect: (connection: Connection) => void
  addNode: (type: RFNodeType, position?: XYPosition) => void
  selectNode: (id: string | null) => void
  setProjectName: (name: string) => void
  updateAnalysis: (analysis: RFAnalysisSettings) => void
  loadProject: (project: RFProject, localId?: string) => void
  newProject: () => void
  updateNodeLabel: (id: string, label: string) => void
  updateNodeParameters: (
    id: string,
    parameters: Record<string, unknown>,
  ) => void
  removeSelectedNode: () => void
}

export const useRFEditorStore = create<RFEditorState>((set, get) => ({
  activeProjectId: crypto.randomUUID(),
  projectName: 'Untitled RF chain',
  analysis: INITIAL_ANALYSIS,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  modelRevision: 0,
  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      modelRevision:
        state.modelRevision +
        (changes.some((change) =>
          ['add', 'remove', 'replace'].includes(change.type),
        )
          ? 1
          : 0),
    })),
  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      modelRevision:
        state.modelRevision +
        (changes.some((change) => change.type !== 'select') ? 1 : 0),
    })),
  onConnect: (connection) =>
    set((state) => ({
      edges: addEdge(
        { ...connection, id: crypto.randomUUID(), animated: true },
        state.edges,
      ),
      modelRevision: state.modelRevision + 1,
    })),
  addNode: (type, position) =>
    set((state) => {
      const id = crypto.randomUUID()
      return {
        nodes: [
          ...state.nodes,
          {
            id,
            type,
            position: position ?? {
              x: 140 + (state.nodes.length % 4) * 170,
              y: 80 + Math.floor(state.nodes.length / 4) * 130,
            },
            data: createNodeData(type),
          },
        ],
        selectedNodeId: id,
        modelRevision: state.modelRevision + 1,
      }
    }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setProjectName: (projectName) => set({ projectName }),
  updateAnalysis: (analysis) =>
    set((state) => ({ analysis, modelRevision: state.modelRevision + 1 })),
  loadProject: (project, localId) =>
    set((state) => ({
      activeProjectId: localId ?? crypto.randomUUID(),
      projectName: project.name,
      analysis: project.analysis,
      nodes: project.nodes.map((node) => ({
        id: node.id,
        type: node.data.type,
        position: node.position,
        data: node.data,
      })),
      edges: project.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
      selectedNodeId: null,
      modelRevision: state.modelRevision + 1,
    })),
  newProject: () =>
    set((state) => ({
      activeProjectId: crypto.randomUUID(),
      projectName: 'Untitled RF chain',
      analysis: INITIAL_ANALYSIS,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      modelRevision: state.modelRevision + 1,
    })),
  updateNodeLabel: (id, label) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, label } } : node,
      ),
      modelRevision: state.modelRevision + 1,
    })),
  updateNodeParameters: (id, parameters) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                parameters: { ...node.data.parameters, ...parameters },
              },
            }
          : node,
      ),
      modelRevision: state.modelRevision + 1,
    })),
  removeSelectedNode: () => {
    const selectedNodeId = get().selectedNodeId
    if (!selectedNodeId) return
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== selectedNodeId),
      edges: state.edges.filter(
        (edge) =>
          edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
      selectedNodeId: null,
      modelRevision: state.modelRevision + 1,
    }))
  },
}))
