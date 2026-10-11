import { useState, useEffect, useCallback, useMemo } from 'react';
import { PodsService, AdminService } from '../../services/api';
import { toast } from '../../utils/toast';

/**
 * Owns pod + user data and every mutation (create/delete pod, timezone,
 * admins, members). Also derives a flat, cross-pod roster — one row per
 * SDR/AE with their active-lead count and staleness buckets — which is
 * what a Pod Admin actually asked to see (their team's real lead activity,
 * not just who's in which pod).
 */
export function usePodsData() {
  const [pods, setPods] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [podsData, usersData] = await Promise.all([PodsService.getAll(), AdminService.getUsers()]);
      setPods(podsData);
      setUsers(usersData);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load pods');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A pod-membership change made elsewhere (Control Center's Team & Access
  // reassignment dropdown) needs to refresh this hub too — hub-entry.jsx's
  // navigate() re-renders a persisted root without remounting, so `load`
  // above only ever fires once per session unless something re-triggers it.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('alternate:pod-membership-changed', handler);
    return () => window.removeEventListener('alternate:pod-membership-changed', handler);
  }, [load]);

  const availableSdrs = useMemo(() => users.filter((u) => u.role === 'SDR' || u.role === 'AE'), [users]);
  const eligibleAdmins = useMemo(() => users.filter((u) => ['SDR', 'AE', 'Pod Admin'].includes(u.role)), [users]);

  const roster = useMemo(() => {
    const rows = [];
    pods.forEach((pod) => {
      (pod.members || []).forEach((m) => {
        rows.push({
          podId: pod.id,
          podName: pod.name,
          userId: m.id,
          name: m.name,
          email: m.email,
          role: m.role,
          activeLeads: m.active_leads || 0,
          stale24h: m.stale_24h || 0,
          stale72h: m.stale_72h || 0,
        });
      });
    });
    return rows;
  }, [pods]);

  // Every mutation below is "call the service, then reload" — one helper
  // instead of seven near-identical useCallback bodies. A successMessage gets a toast.
  // A server refusal (e.g. "already a member of 'US Team New'. Remove them from that pod first.") is shown as a
  // toast with the server's own message; the action resolves to false instead of throwing, so it can't escape as
  // an unhandled rejection that only appears in the browser console.
  const mutate = useCallback((serviceFn, successMessage) => async (...args) => {
    try {
      await serviceFn(...args);
      await load();
      if (successMessage) toast(successMessage, 'success');
      return true;
    } catch (err) {
      toast(err?.response?.data?.detail || 'That didn’t work — please try again.', 'error');
      return false;
    }
  }, [load]);

  const createPod = mutate((name, adminId, timezone) => PodsService.create(name, adminId || null, timezone || null), 'POD created.');
  const deletePod = mutate((podId) => PodsService.remove(podId), 'POD deleted.');
  const saveTimezone = mutate((podId, timezone) => PodsService.update(podId, { timezone: timezone || null }), 'Timezone updated.');
  const addMember = mutate(async (podId, userId) => {
    await PodsService.addMember(podId, userId);
    window.dispatchEvent(new CustomEvent('alternate:pod-membership-changed'));
  }, 'Added to POD.');
  const removeMember = mutate(async (podId, userId) => {
    await PodsService.removeMember(podId, userId);
    window.dispatchEvent(new CustomEvent('alternate:pod-membership-changed'));
  }, 'Removed from POD.');
  const addAdmin = mutate((podId, userId) => PodsService.addAdmin(podId, userId), 'POD Admin added.');
  const removeAdmin = mutate((podId, userId) => PodsService.removeAdmin(podId, userId), 'POD Admin removed.');

  return {
    pods, users, availableSdrs, eligibleAdmins, roster, loading, error,
    createPod, deletePod, saveTimezone, addMember, removeMember, addAdmin, removeAdmin,
  };
}
