/** Plain-words summary of a mailbox selection — what it actually means for sending. */
export function mailboxSummary(list) {
  if (!Array.isArray(list)) return '';
  const domains = new Set(list.map((a) => a.domain)).size;
  const perDay = list.reduce((n, a) => n + (a.daily_limit || 0), 0);
  const count = `${list.length} mailbox${list.length === 1 ? '' : 'es'} on ${domains} domain${domains === 1 ? '' : 's'}`;
  return perDay ? `${count} · up to ${perDay.toLocaleString()} emails/day` : count;
}
