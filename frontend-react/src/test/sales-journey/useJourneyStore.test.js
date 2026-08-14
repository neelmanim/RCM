import { describe, it, expect, beforeEach } from 'vitest';
import { useJourneyStore } from '../../features/sales-journey/store/useJourneyStore';

const resetStore = () => useJourneyStore.setState({
  journeyId: null, versionId: null, lastSavedAt: null,
  nodes: [], edges: [], selectedNodeId: null, dirty: false,
});

describe('useJourneyStore', () => {
  beforeEach(resetStore);

  it('loadGraph populates nodes/edges and clears dirty', () => {
    const graph = { nodes: [{ id: 'n1', type: 'trigger', position: { x: 0, y: 0 }, data: {} }], edges: [] };
    useJourneyStore.getState().loadGraph('j1', 'v1', graph, '2026-08-01T00:00:00Z');

    const state = useJourneyStore.getState();
    expect(state.journeyId).toBe('j1');
    expect(state.nodes).toHaveLength(1);
    expect(state.dirty).toBe(false);
  });

  it('addNode appends a node with default data and marks dirty', () => {
    const id = useJourneyStore.getState().addNode('email', { x: 10, y: 20 });
    const state = useJourneyStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe(id);
    expect(state.nodes[0].type).toBe('email');
    expect(state.selectedNodeId).toBe(id);
    expect(state.dirty).toBe(true);
  });

  it('updateNodeData merges into the existing node data', () => {
    const id = useJourneyStore.getState().addNode('email', { x: 0, y: 0 });
    useJourneyStore.getState().updateNodeData(id, { subject: 'Hi' });
    const node = useJourneyStore.getState().nodes.find((n) => n.id === id);
    expect(node.data.subject).toBe('Hi');
  });

  it('deleteNode removes the node and any edges touching it, clears selection if selected', () => {
    const id1 = useJourneyStore.getState().addNode('trigger', { x: 0, y: 0 });
    const id2 = useJourneyStore.getState().addNode('email', { x: 10, y: 10 });
    useJourneyStore.setState({ edges: [{ id: 'e1', source: id1, target: id2 }] });

    useJourneyStore.getState().deleteNode(id2);
    const state = useJourneyStore.getState();
    expect(state.nodes.find((n) => n.id === id2)).toBeUndefined();
    expect(state.edges).toEqual([]);
    expect(state.selectedNodeId).toBeNull();
  });

  it('graphDefinition() strips to the backend-expected shape (no zustand internals)', () => {
    useJourneyStore.getState().addNode('trigger', { x: 5, y: 5 });
    useJourneyStore.setState({ edges: [{ id: 'e1', source: 'x', target: 'y', someReactFlowInternal: true }] });

    const def = useJourneyStore.getState().graphDefinition();
    expect(def.nodes[0]).toEqual(expect.objectContaining({ type: 'trigger', position: { x: 5, y: 5 } }));
    expect(def.edges[0]).toEqual({ id: 'e1', source: 'x', target: 'y' });
    expect(def.edges[0].someReactFlowInternal).toBeUndefined();
  });

  it('markSaved clears dirty and records the new saved timestamp', () => {
    useJourneyStore.getState().addNode('trigger', { x: 0, y: 0 });
    expect(useJourneyStore.getState().dirty).toBe(true);

    useJourneyStore.getState().markSaved('2026-08-01T12:00:00Z');
    const state = useJourneyStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.lastSavedAt).toBe('2026-08-01T12:00:00Z');
  });
});
