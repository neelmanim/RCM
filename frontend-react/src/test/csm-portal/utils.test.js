import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tierVariant, formatMoney, formatDate, formatDateTime, daysSince,
  isSilentAccount, isRenewalUpcoming, isZeroFormHandoverReady, emptyPortfolioCopy,
  SILENT_ACCOUNT_DAYS, RENEWAL_COUNTDOWN_DAYS,
} from '../../features/csm-portal/utils';

describe('csm-portal utils', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  describe('tierVariant', () => {
    it('maps known tiers to a Badge variant', () => {
      expect(tierVariant('Healthy')).toBe('success');
      expect(tierVariant('At Risk')).toBe('warning');
      expect(tierVariant('Critical')).toBe('danger');
    });
    it('falls back to default for an unknown tier', () => {
      expect(tierVariant('Unknown')).toBe('default');
    });
  });

  describe('formatMoney', () => {
    it('formats a number as whole-dollar USD', () => {
      expect(formatMoney(50000)).toBe('$50,000');
    });
    it('renders a dash for null/undefined', () => {
      expect(formatMoney(null)).toBe('—');
      expect(formatMoney(undefined)).toBe('—');
    });
  });

  describe('formatDate / formatDateTime', () => {
    it('renders a dash for a falsy value', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatDateTime('')).toBe('—');
    });
    it('formats a real ISO date', () => {
      expect(formatDate('2026-09-15')).toContain('2026');
    });
  });

  describe('daysSince', () => {
    it('returns null for a falsy value', () => {
      expect(daysSince(null)).toBeNull();
    });
    it('computes whole days between now and the given date', () => {
      expect(daysSince('2026-09-10T00:00:00Z')).toBe(5);
    });
  });

  describe('isSilentAccount', () => {
    it('treats a never-touched account as silent', () => {
      expect(isSilentAccount({ last_touch_at: null })).toBe(true);
    });
    it('is silent once the threshold is reached', () => {
      const exactlyAtThreshold = new Date(Date.now() - SILENT_ACCOUNT_DAYS * 86400000).toISOString();
      expect(isSilentAccount({ last_touch_at: exactlyAtThreshold })).toBe(true);
    });
    it('is not silent for a recent touch', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      expect(isSilentAccount({ last_touch_at: yesterday })).toBe(false);
    });
  });

  describe('isRenewalUpcoming', () => {
    it('is false with no open opportunity', () => {
      expect(isRenewalUpcoming({ open_opportunity: null })).toBe(false);
    });
    it('is true for a close date within the countdown window', () => {
      const soon = new Date(Date.now() + 10 * 86400000).toISOString();
      expect(isRenewalUpcoming({ open_opportunity: { close_date: soon } })).toBe(true);
    });
    it('is false for a close date past the countdown window', () => {
      const farOut = new Date(Date.now() + (RENEWAL_COUNTDOWN_DAYS + 5) * 86400000).toISOString();
      expect(isRenewalUpcoming({ open_opportunity: { close_date: farOut } })).toBe(false);
    });
    it('is false for a close date already in the past', () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      expect(isRenewalUpcoming({ open_opportunity: { close_date: past } })).toBe(false);
    });
  });

  describe('isZeroFormHandoverReady', () => {
    it('is ready only when a brief exists and is not yet locked', () => {
      expect(isZeroFormHandoverReady({ closing_brief_locked: false })).toBe(true);
      expect(isZeroFormHandoverReady({ closing_brief_locked: true })).toBe(false);
      expect(isZeroFormHandoverReady({ closing_brief_locked: null })).toBe(false);
    });
  });

  describe('emptyPortfolioCopy', () => {
    it('points an admin at the sync settings', () => {
      expect(emptyPortfolioCopy(true).message).toMatch(/Integrations/);
    });
    it('points a CSM at their Super Admin instead', () => {
      expect(emptyPortfolioCopy(false).message).toMatch(/Super Admin/);
    });
  });
});
