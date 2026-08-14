import { describe, it, expect } from 'vitest';
import api from '../../services/api';

// RCA 2026-08-10: caught live on staging, invisible to every other test in
// this suite (they mock axios/the service layer, never touching the real
// URL-encoding step). axios's default array serialization produces
// "status[]=a&status[]=b" — FastAPI's `Optional[List[str]] = Query(None)`
// only recognizes repeated "status=a&status=b" and silently ignores the
// bracket form, so a multi-value filter matched nothing server-side while
// looking correct in the UI. This test exercises the real axios instance's
// configured serializer directly — no mocking — since that's the exact
// layer the bug lived in.
describe('api paramsSerializer', () => {
  const serialize = (params) => api.defaults.paramsSerializer.serialize(params);

  it('serializes an array param as repeated keys, not bracket notation', () => {
    const qs = serialize({ status: ['Lead Assigned', 'Research', 'Calling'] });
    expect(qs).toBe('status=Lead+Assigned&status=Research&status=Calling');
    expect(qs).not.toContain('[]');
  });

  it('serializes scalar params normally alongside an array param', () => {
    const qs = serialize({ status: ['A', 'B'], per_page: 50, search: 'acme' });
    expect(qs).toBe('status=A&status=B&per_page=50&search=acme');
  });

  it('omits undefined/null params instead of emitting "undefined"/"null"', () => {
    const qs = serialize({ a: 1, b: undefined, c: null, d: 'x' });
    expect(qs).toBe('a=1&d=x');
  });
});
