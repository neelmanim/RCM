import { describe, it, expect } from 'vitest';
import { layoutPositions } from '../../features/sales-journey/store/layout';

const chain = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
};

const branch = {
  nodes: [{ id: 'trigger' }, { id: 'left' }, { id: 'right' }],
  edges: [{ source: 'trigger', target: 'left' }, { source: 'trigger', target: 'right' }],
};

describe('layoutPositions', () => {
  it('stacks a linear chain top-to-bottom with increasing y, same x', () => {
    const pos = layoutPositions(chain.nodes, chain.edges, 'TB');
    expect(pos.a.y).toBeLessThan(pos.b.y);
    expect(pos.b.y).toBeLessThan(pos.c.y);
    expect(pos.a.x).toBe(pos.b.x);
  });

  it('lays a linear chain left-to-right with increasing x, same y', () => {
    const pos = layoutPositions(chain.nodes, chain.edges, 'LR');
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.a.y).toBe(pos.b.y);
  });

  it('puts branch siblings side by side at the same depth', () => {
    const pos = layoutPositions(branch.nodes, branch.edges, 'TB');
    expect(pos.left.y).toBe(pos.right.y);
    expect(pos.left.x).not.toBe(pos.right.x);
    expect(pos.trigger.y).toBeLessThan(pos.left.y);
  });
});
