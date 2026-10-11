import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { usePodsData } from './usePodsData';
import { RosterTable, RosterSkeleton } from './components/RosterTable';
import { PodCard } from './components/PodCard';
import { CreatePodForm } from './components/CreatePodForm';
import { Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';

/**
 * Props from the Vanilla JS shell (mirrors leads-entry.jsx's contract):
 *   token, userRole, apiBase
 *   onOpenRep(userId, name) — hand off to Leads Hub pre-filtered to one rep
 */
export function PodsHub({ userRole, onOpenRep }) {
  const isSuperAdmin = userRole === 'Super Admin';
  const [tab, setTab] = useState('roster');
  const {
    pods, roster, availableSdrs, eligibleAdmins, loading, error,
    createPod, deletePod, saveTimezone, addMember, removeMember, addAdmin, removeAdmin,
  } = usePodsData();

  return (
    <div className="podshub w-full max-w-[1400px] mx-auto px-4 py-6">
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 mb-5 text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>Couldn't load pods: {error}</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight m-0">POD Management</h1>
        {tab === 'manage' && isSuperAdmin && <CreatePodForm eligibleAdmins={eligibleAdmins} onCreate={createPod} />}
      </div>

      <Tabs
        tabs={[
          { key: 'roster', label: 'Team Roster' },
          { key: 'manage', label: 'Manage Pods' },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-5"
      />

      {loading ? (
        <RosterSkeleton />
      ) : tab === 'roster' ? (
        <RosterTable roster={roster} onOpenRep={(row) => onOpenRep(row.userId, row.name)} />
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))' }}>
          {pods.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                icon={Users}
                title="No PODs created yet."
                message={isSuperAdmin ? 'Click "Create POD" to get started.' : undefined}
              />
            </div>
          )}
          {pods.map((pod) => (
            <PodCard
              key={pod.id}
              pod={pod}
              isSuperAdmin={isSuperAdmin}
              eligibleAdmins={eligibleAdmins}
              availableSdrs={availableSdrs}
              onDelete={deletePod}
              onSaveTimezone={saveTimezone}
              onAddAdmin={addAdmin}
              onRemoveAdmin={removeAdmin}
              onAddMember={addMember}
              onRemoveMember={removeMember}
            />
          ))}
        </div>
      )}
    </div>
  );
}
