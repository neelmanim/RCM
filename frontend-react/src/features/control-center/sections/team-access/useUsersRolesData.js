import { useState, useEffect, useCallback } from 'react';
import { AdminService, PodsService } from '../../../../services/api';

// Ported from frontend/js/views/admin.js (renderAdmin/_renderRow) — user
// list + role editing + POD reassignment. Same "mutate = reload after write"
// pattern as pods-hub/usePodsData.js.
export function useUsersRolesData() {
  const [users, setUsers] = useState([]);
  const [pods, setPods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // silent: re-read after a change without swapping the table for a skeleton (which also threw the scroll position away).
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [usersData, podsData] = await Promise.all([AdminService.getUsers({ fresh: true }), PodsService.getAll()]);
      setUsers(usersData);
      setPods(podsData);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A pod-membership change made elsewhere (Pods Hub) needs to refresh this
  // panel too — hub-entry.jsx's navigate() re-renders a persisted root
  // without remounting, so `load` above only ever fires once per session
  // unless something re-triggers it (this was the "shows old POD until hard
  // refresh" bug — reported 2026-09-22).
  useEffect(() => {
    const handler = () => load({ silent: true });
    window.addEventListener('alternate:pod-membership-changed', handler);
    return () => window.removeEventListener('alternate:pod-membership-changed', handler);
  }, [load]);

  const mutate = useCallback((fn) => async (...args) => {
    await fn(...args);
    await load({ silent: true });
  }, [load]);

  // Show the server's answer for one row straight away (the PATCH response), before the full re-read lands.
  const patchLocal = useCallback((userId, fields) => setUsers((all) => all.map((u) => (u.id === userId ? { ...u, ...fields } : u))), []);

  const changeRole = mutate((userId, role) => AdminService.patchUserRole(userId, role));
  const toggleAccess = mutate((userId, action) => AdminService.patchUserAccess(userId, action));
  const deleteUser = mutate((userId) => AdminService.deleteUser(userId));

  // POD reassignment: remove the user from their current pod (if any) before
  // adding them to the newly-selected one — admin.js's single dropdown did
  // this implicitly via one PATCH; PodsService only exposes per-pod
  // add/removeMember, so this is the two-call equivalent.
  const reassignPod = mutate(async (userId, fromPodId, toPodId) => {
    if (fromPodId && fromPodId !== toPodId) await PodsService.removeMember(fromPodId, userId);
    if (toPodId && toPodId !== fromPodId) await PodsService.addMember(toPodId, userId);
    window.dispatchEvent(new CustomEvent('alternate:pod-membership-changed'));
  });

  return { users, pods, loading, error, reload: () => load({ silent: true }), patchLocal, changeRole, toggleAccess, deleteUser, reassignPod };
}
