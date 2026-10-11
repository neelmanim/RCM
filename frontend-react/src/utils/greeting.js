// Shared time-of-day greeting + first-name extraction — originally only in
// Dashboard.jsx's own "Welcome Briefing Strip"; extracted 2026-09-16 so
// CsmPortalHub's Inbox (a CSM's landing page, same role Dashboard plays for
// every other role) can give the same greeting instead of being the one
// landing page with no personal welcome at all.

export const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

export const getFirstName = (raw = '') => {
  if (!raw) return '';
  if (raw.includes('@')) {
    const local = raw.split('@')[0].replace(/[._-]/g, ' ');
    return local.split(' ')[0].replace(/^\w/, (c) => c.toUpperCase());
  }
  return raw.trim().split(' ')[0];
};
