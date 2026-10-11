import React from 'react';
import { Phone, PhoneOff, Mail, MessageSquare, CheckSquare, StickyNote, ArrowUpCircle, UserX, Trash2, X, Workflow } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { STATUSES } from '../../leads-hub/constants';
import { JourneyPicker } from '../../sales-journey/EnrollInCadence';

// forwardRef + rest props: it's also the trigger of the Enroll in Cadence
// menu (Radix positions the menu from the trigger's DOM node).
const ActionButton = React.forwardRef(({ icon: Icon, label, onClick, tone = 'default', ...rest }, ref) => {
  const toneClass = tone === 'danger' ? 'text-red-500 hover:bg-red-50' : 'text-slate-600 hover:bg-slate-100';
  return (
    <button ref={ref} type="button" onClick={onClick} {...rest} className={`flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg transition-colors ${toneClass}`}>
      <Icon size={15} /> {label}
    </button>
  );
});
ActionButton.displayName = 'ActionButton';

// Mirrors backend/routes/lead_helpers.py STATUS_ORDER + STAGE_GROUP: SDRs
// (anyone not Super Admin / Admin / Pod Admin) can't move backward or skip a
// whole stage — offering those just produced a 403 toast. Parked/terminal
// statuses aren't in the pipeline, so the backend stays the judge there.
const PIPELINE = [
  ['Lead Assigned', 0], ['Research', 0], ['Calling', 0], ['Meeting Scheduled', 1],
  ['1st Discovery Meeting', 2], ['Discovery Complete', 2],
  ['Demo Scheduled', 3], ['Demo Done', 3], ['Completed', 4],
];
const IDX = Object.fromEntries(PIPELINE.map(([s], i) => [s, i]));
const GROUP = Object.fromEntries(PIPELINE);
const sdrCanMoveTo = (from, to) =>
  !(from in IDX) || !(to in IDX) || (IDX[to] > IDX[from] && GROUP[to] <= GROUP[from] + 1);

// Mirrors lead_detail.js's close-lead-btn inline form exactly (same reason
// list, same "No Phone Number" bypass) — reimplemented natively since it was
// a plain inline form in legacy too, not a modal worth bridging.
export function QuickActions({
  canModify, canDelete, canSkipStages, hasNoPhone, hasPhone, phoneInvalid, currentStatus,
  onCall, onWrongNumber, onEmail, canMessage, onMessage, onAddTask, onAddNote, onChangeStage, onOptOut, onDelete, onEnroll,
  onDisqualify, showDisqualify, onShowDisqualifyChange,
}) {
  const [reason, setReason] = React.useState(hasNoPhone ? 'No Phone Number' : 'Not Interested');
  const [otherNote, setOtherNote] = React.useState('');

  const reasons = [...(hasNoPhone ? ['No Phone Number'] : []), 'Not Interested', 'Unreachable', 'Wrong Number', 'Other'];
  const isOther = reason === 'Other';
  const otherNoteTrimmed = otherNote.trim();

  // The backend (update_lead_fields) is still the actual gate (research
  // gate, "Meeting Scheduled needs a call"), surfaced back as a toast.
  // Disqualified is left out: it has its own reason flow (Disqualify Lead).
  const stageOptions = STATUSES
    .filter((s) => s !== currentStatus && s !== 'Disqualified')
    .filter((s) => canSkipStages || sdrCanMoveTo(currentStatus, s))
    .map((s) => ({ value: s, label: s }));

  return (
    <Card>
      <CardHeader title="Quick Actions" />
      <CardContent>
        <div className="flex flex-col gap-1">
          {canModify && <ActionButton icon={Phone} label="Call" onClick={onCall} />}
          {canModify && hasPhone && !phoneInvalid && <ActionButton icon={PhoneOff} label="Wrong number" onClick={onWrongNumber} />}
          {canModify && <ActionButton icon={Mail} label="Send Email" onClick={onEmail} />}
          {canModify && canMessage && <ActionButton icon={MessageSquare} label="Message" onClick={onMessage} />}
          {canModify && <ActionButton icon={CheckSquare} label="Add Task" onClick={onAddTask} />}
          {canModify && <ActionButton icon={StickyNote} label="Add Note" onClick={onAddNote} />}
          {canModify && onEnroll && (
            <JourneyPicker onEnroll={onEnroll} align="start">
              <ActionButton icon={Workflow} label="Enroll in Cadence" />
            </JourneyPicker>
          )}
          {canModify && (
            <Select
              icon={ArrowUpCircle}
              placeholder="Change Stage"
              ariaLabel="Change lead stage"
              value=""
              onChange={onChangeStage}
              options={stageOptions}
              className="w-full justify-start border-none shadow-none px-3 py-2 font-semibold text-slate-600 hover:bg-slate-100"
            />
          )}
        </div>
        {(canModify || canDelete) && (
          <div className="flex flex-col gap-1 mt-3 pt-3 border-t border-slate-100">
            {canModify && !showDisqualify && (
              <ActionButton icon={X} label="Disqualify Lead" onClick={() => onShowDisqualifyChange?.(true)} tone="danger" />
            )}
            {canModify && <ActionButton icon={UserX} label="Mark Opted Out" onClick={onOptOut} tone="danger" />}
            {canDelete && <ActionButton icon={Trash2} label="Delete Lead" onClick={onDelete} tone="danger" />}
          </div>
        )}
        {showDisqualify && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-100">
            <p className="text-xs font-semibold text-red-600 mb-2">Disqualify Lead</p>
            <Select
              value={reason}
              onChange={setReason}
              options={reasons.map((r) => ({ value: r, label: r }))}
              className="w-full mb-2"
            />
            {hasNoPhone && (
              <p className="text-[11px] text-slate-500 mb-2">ℹ️ "No Phone Number" bypasses the call requirement.</p>
            )}
            {isOther && (
              <textarea
                rows={2} value={otherNote} onChange={(e) => setOtherNote(e.target.value)}
                placeholder="Explain the reason…"
                className="w-full text-xs px-2.5 py-2 mb-2 border border-slate-200 rounded-lg bg-white"
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { onShowDisqualifyChange?.(false); setOtherNote(''); }}>Cancel</Button>
              <Button
                variant="danger" size="sm"
                disabled={isOther && !otherNoteTrimmed}
                onClick={() => {
                  onShowDisqualifyChange?.(false);
                  onDisqualify?.(isOther ? `Other: ${otherNoteTrimmed}` : reason);
                  setOtherNote('');
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
