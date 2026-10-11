import React, { useState, useCallback, useEffect } from 'react';
import { JourneyList } from './JourneyList';
import { JourneyBuilder } from './JourneyBuilder';
import { CadenceReadOnlyTour } from './CadenceReadOnlyTour';
import { useJourneyStore } from './store/useJourneyStore';
import { SalesJourneyService } from '../../services/api';

// Mirrors backend routes/journey_routes.py _settings_fields.
const SETTINGS_KEYS = [
  'send_tz', 'send_window_start_hour', 'send_window_end_hour', 'send_days',
  'stop_on_reply', 'stop_on_meeting', 'max_duration_days', 'reengage_after_days', 'reengage_min_opens', 'allow_reenroll', 'reenroll_cooloff_days', 'send_as',
];

export const SalesJourneyHub = ({ isAdmin = true, openJourneyId = null }) => {
  const [openJourney, setOpenJourney] = useState(null); // { id, name, status } | null
  const [loadError, setLoadError] = useState(null);
  const loadGraph = useJourneyStore((s) => s.loadGraph);

  const handleOpen = useCallback(async (id, name) => {
    setLoadError(null);
    try {
      const data = await SalesJourneyService.get(id);
      loadGraph(id, data.version_id, data.graph_definition, data.updated_at, data.live_version_id);
      setOpenJourney({
        id, name: data.name || name, status: data.status, podId: data.pod_id,
        // Every cadence-level setting (send window + v13 rules), passed through
        // whole so a new setting can't be silently dropped on the way.
        settings: Object.fromEntries(SETTINGS_KEYS.map((k) => [k, data[k]])),
        // Ownership straight from the API — the same owner-or-Super-Admin
        // answer every mutating route enforces.
        canEdit: data.can_edit, isMine: data.is_mine, ownerName: data.owner_name,
      });
    } catch (err) {
      setLoadError('Failed to load this cadence.');
    }
  }, [loadGraph]);

  const handleBack = useCallback(() => setOpenJourney(null), []);

  // Deep-link support (app.js's #sales-tools/{journeyId} hash) — open straight
  // into the named cadence instead of landing on the list first.
  useEffect(() => {
    if (openJourneyId) handleOpen(openJourneyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openJourneyId]);

  return (
    <>
      {!isAdmin && <CadenceReadOnlyTour />}
      {openJourney ? (
        <JourneyBuilder
          journeyName={openJourney.name}
          journeyStatus={openJourney.status}
          journeyPodId={openJourney.podId}
          journeySendWindow={openJourney.settings}
          onBack={handleBack}
          onArchived={handleBack}
          // Ownership alone decides this — any role can own and edit a
          // cadence. Gating on role too left reps unable to edit cadences
          // they had just created.
          readOnly={openJourney.canEdit === false}
          ownerName={openJourney.isMine ? null : openJourney.ownerName}
        />
      ) : (
        <>
          {loadError && <p className="text-sm text-red-600 text-center py-2">{loadError}</p>}
          <JourneyList onOpen={handleOpen} />
        </>
      )}
    </>
  );
};
