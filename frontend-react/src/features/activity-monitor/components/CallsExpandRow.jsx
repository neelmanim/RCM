import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { ExpandRowFooter } from './ExpandRowFooter';
import { AudioPlayer } from '../../../components/ui/AudioPlayer';
import { CallsService } from '../../../services/api';

// Real shape (verified against a live recording, 2026-09-01): a wrapper
// object `{transcription: [{role, content, start_time}, ...]}`, not a bare
// array — the old code only checked `Array.isArray(parsed)`, so this whole
// JSON blob fell through to the plain-text branch and rendered as one
// unbroken line (the SS1/SS2 layout-breaking bug).
function parseTranscriptLines(transcript) {
  if (!transcript) return [];
  try {
    const parsed = typeof transcript === 'string' ? JSON.parse(transcript) : transcript;
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.transcription) ? parsed.transcription : null;
    if (list) return list.map((l) => ({ speaker: l.speaker || l.role, text: l.text ?? l.content ?? String(l) }));
  } catch {
    // not JSON — fall through to plain-text line splitting below
  }
  return String(transcript).split('\n').filter(Boolean).map((text) => ({ text }));
}

export function CallsExpandRow({ call, isPlaying, onAudioEnded, onOpenLead, onCollapse }) {
  const lines = parseTranscriptLines(call.transcript);
  const ringTime = call.answered_at && call.started_at
    ? Math.round((new Date(call.answered_at) - new Date(call.started_at)) / 1000)
    : null;
  const notes = call.notes || call.error_detail;

  // Provider-signed recording URLs expire (~46min on Aircall) — the stored
  // recording_url is written once at webhook time and never refreshed, so
  // most calls viewed later than that are already stale by the time anyone
  // clicks Play. Mirrors power-dialer-hub's RecordingCell: play the URL we
  // have, and on error fetch one fresh signed URL and retry once.
  const [recordingUrl, setRecordingUrl] = useState(call.recording_url);
  const [retriedRecording, setRetriedRecording] = useState(false);
  const [recordingUnavailable, setRecordingUnavailable] = useState(false);

  const handleRecordingError = async () => {
    if (retriedRecording) { setRecordingUnavailable(true); return; }
    setRetriedRecording(true);
    try {
      const fresh = await CallsService.getRecordingUrl(call.id);
      if (fresh?.recording_url) setRecordingUrl(fresh.recording_url);
      else setRecordingUnavailable(true);
    } catch {
      setRecordingUnavailable(true);
    }
  };

  return (
    <div className="p-4">
      {call.recording_url && isPlaying && (
        recordingUnavailable ? (
          <div className="mb-3 text-sm text-slate-400 italic">Recording unavailable — the signed URL has expired and a fresh one couldn't be fetched.</div>
        ) : (
          <AudioPlayer key={`${call.id}-${recordingUrl}`} src={recordingUrl} onEnded={onAudioEnded} onError={handleRecordingError} className="mb-3" />
        )
      )}
      {notes && <div className="mb-3 text-sm text-slate-600 break-words"><strong>Notes:</strong> {notes}</div>}
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Transcript</div>
      {lines.length ? (
        <div className="text-sm text-slate-700 space-y-1 max-h-64 overflow-y-auto break-words">
          {lines.slice(0, 20).map((l, i) => (
            <div key={i}>
              {l.speaker && <span className="font-semibold mr-1">{l.speaker}:</span>}
              <span>{l.text || String(l)}</span>
            </div>
          ))}
          {lines.length > 20 && <div className="text-slate-400">… {lines.length - 20} more lines</div>}
        </div>
      ) : (
        <div className="flex items-start gap-2 text-sm text-slate-400 italic">
          <FileText size={15} className="mt-0.5 shrink-0" />
          <div>
            Transcript not available for this call
            <div className="text-xs mt-0.5 not-italic">Call transcription requires Alternate Messenger or Aircall transcription to be enabled on your account.</div>
          </div>
        </div>
      )}
      <ExpandRowFooter
        pills={[
          call.provider_call_id && <span key="id" className="px-2 py-1 bg-slate-100 rounded">ID: {call.provider_call_id}</span>,
          ringTime !== null && <span key="ring" className="px-2 py-1 bg-slate-100 rounded">Ring time: {ringTime}s</span>,
          call.started_at && <span key="started" className="px-2 py-1 bg-slate-100 rounded">Started: {new Date(call.started_at).toLocaleString()}</span>,
        ]}
        leadId={call.lead_id}
        onOpenLead={onOpenLead}
        onCollapse={onCollapse}
      />
    </div>
  );
}
