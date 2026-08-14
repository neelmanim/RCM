import React, { useState, useCallback } from 'react';
import { JourneyList } from './JourneyList';
import { JourneyBuilder } from './JourneyBuilder';
import { useJourneyStore } from './store/useJourneyStore';
import { SalesJourneyService } from '../../services/api';

export const SalesJourneyHub = () => {
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
        sendTz: data.send_tz, sendWindowStartHour: data.send_window_start_hour,
        sendWindowEndHour: data.send_window_end_hour, sendDays: data.send_days,
      });
    } catch (err) {
      setLoadError('Failed to load this cadence.');
    }
  }, [loadGraph]);

  const handleBack = useCallback(() => setOpenJourney(null), []);

  if (openJourney) {
    return (
      <JourneyBuilder
        journeyName={openJourney.name}
        journeyStatus={openJourney.status}
        journeyPodId={openJourney.podId}
        journeySendWindow={{
          send_tz: openJourney.sendTz, send_window_start_hour: openJourney.sendWindowStartHour,
          send_window_end_hour: openJourney.sendWindowEndHour, send_days: openJourney.sendDays,
        }}
        onBack={handleBack}
        onArchived={handleBack}
      />
    );
  }

  return (
    <>
      {loadError && <p className="text-sm text-red-600 text-center py-2">{loadError}</p>}
      <JourneyList onOpen={handleOpen} />
    </>
  );
};
