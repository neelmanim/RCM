import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportCsv } from '../../features/activity-monitor/lib/exportCsv';
import { AuditService } from '../../services/api';

vi.mock('../../services/api', () => ({ AuditService: { exportEvent: vi.fn().mockResolvedValue({ recorded: true }) } }));

afterEach(() => vi.restoreAllMocks());

async function exported(rows) {
  let blob;
  URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:x'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  exportCsv({ rows, columns: [{ key: 'subject', label: 'Subject' }, { key: 'n', label: 'N' }], filenamePrefix: 't' });
  return blob.text();
}

describe('exportCsv', () => {
  it('neutralises cells a spreadsheet would run as a formula (subjects/names come from outside senders)', async () => {
    const csv = await exported([{ subject: '=HYPERLINK("http://evil","x")', n: 1 }, { subject: '+1', n: 2 }, { subject: '@SUM(A1)', n: 3 }, { subject: '-2', n: 4 }]);
    const lines = csv.split('\n').slice(1);
    expect(lines.every((l) => l.startsWith('"\'') )).toBe(true);
  });
  it('leaves ordinary text and numbers alone', async () => {
    const csv = await exported([{ subject: 'Re: pricing', n: 5 }]);
    expect(csv.split('\n')[1]).toBe('"Re: pricing",5');
  });
  it('tells the server about the download, so it lands in the audit trail', async () => {
    await exported([{ subject: 'a', n: 1 }, { subject: 'b', n: 2 }]);
    expect(AuditService.exportEvent).toHaveBeenCalledWith('t', 2);
  });
  it('still downloads when the server cannot be told', async () => {
    AuditService.exportEvent.mockRejectedValueOnce(new Error('offline'));
    const csv = await exported([{ subject: 'ok', n: 1 }]);
    expect(csv).toContain('ok');
  });
});
