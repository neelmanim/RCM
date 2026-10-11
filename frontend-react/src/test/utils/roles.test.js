import { describe, it, expect } from 'vitest';
import { isAdminRole } from '../../utils/roles';

// Regression: SalesToolsHub.jsx's own CADENCE_ALLOWED_ROLES check skipped
// .toLowerCase() and matched Title Case only — a latent bug that happened to
// "work" only because the vanilla shell passes Title Case today. This
// shared helper is case-insensitive on both sides so that class of bug
// can't come back at any of its call sites.
describe('isAdminRole', () => {
  it('is true for Title Case, lowercase, and UPPERCASE admin-tier roles', () => {
    expect(isAdminRole('Super Admin')).toBe(true);
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('POD ADMIN')).toBe(true);
  });

  it('is false for non-admin roles and empty/undefined input', () => {
    expect(isAdminRole('SDR')).toBe(false);
    expect(isAdminRole('AE')).toBe(false);
    expect(isAdminRole('')).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});
