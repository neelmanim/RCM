import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { defaultDataFor, nextNodeId } from '../nodeDefaults';

// Canvas state only (nodes, edges, selection, dirty flag) — scoped to this
// feature folder, not a repo-wide store. Server state (loading/saving) stays
// in the local-hook pattern every other hub already uses (useJourneyBuilder).
export const useJourneyStore = create((set, get) => ({
  journeyId: null,
  versionId: null,
  liveVersionId: null,
  lastSavedAt: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,

  loadGraph: (journeyId, versionId, graph, updatedAt, liveVersionId = null) => set({
    journeyId, versionId, liveVersionId,
    nodes: graph?.nodes || [],
    edges: graph?.edges || [],
    lastSavedAt: updatedAt,
    selectedNodeId: null,
    dirty: false,
  }),

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes), dirty: true }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges), dirty: true }),
  onConnect: (connection) => set({ edges: addEdge(connection, get().edges), dirty: true }),

  addNode: (type, position) => {
    const id = nextNodeId();
    set({
      nodes: [...get().nodes, { id, type, position, data: defaultDataFor(type) }],
      selectedNodeId: id,
      dirty: true,
    });
    return id;
  },

  updateNodeData: (nodeId, patch) => set({
    nodes: get().nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    dirty: true,
  }),

  deleteNode: (nodeId) => set({
    nodes: get().nodes.filter((n) => n.id !== nodeId),
    edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    dirty: true,
  }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  markSaved: (updatedAt) => set({ dirty: false, lastSavedAt: updatedAt }),

  // Publishing forks a new draft server-side (see publish_journey) — without
  // pointing the store at it, the next Save would still target the version
  // that just became "published" and 409 exactly like before the fork existed.
  setPublishedVersions: (versionId, liveVersionId) => set({ versionId, liveVersionId }),

  graphDefinition: () => {
    const { nodes, edges } = get();
    return {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
  },
}));
