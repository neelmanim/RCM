import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:dashboard-tour-seen';

const REP_STEPS = [
  { target: '[data-tour="dashboard-kpis"]', title: 'Your numbers',
    body: 'Each box shows a count of your leads. Click a box to see those leads in the Leads page. "Calls today" opens the Power Dialer.' },
  { target: '[data-tour="dashboard-my-day"]', title: 'My Day',
    body: 'See the leads given to you and the work you did. Click a lead to open it. Use the date box to look at an earlier day.' },
  { target: '[data-tour="dashboard-dial"]', title: 'Start calling',
    body: 'Opens the Power Dialer so you can begin calling.' },
  { target: '[data-tour="dashboard-export"]', title: 'Export',
    body: 'Download these numbers as a file you can share with someone.' },
  { target: '[data-tour="dashboard-leaderboard"]', title: 'Leaderboard',
    body: 'Shows who has booked the most meetings. Click "View all" for the full list.' },
];

const ADMIN_STEPS = [
  { target: '[data-tour="dashboard-kpis"]', title: 'Your numbers',
    body: 'Click any box to see those leads in the Leads page. The stage bars further down work the same way.' },
  { target: '[data-tour="dashboard-export"]', title: 'Export',
    body: 'Download these numbers as a file you can share with someone.' },
  { target: '[data-tour="dashboard-leaderboard"]', title: 'Leaderboard',
    body: 'Shows who has booked the most meetings. Click "View all" for the full list.' },
];

/** Same shared GuidedTour as every other screen: own steps, own seen-flag, skips steps whose target isn't on this role's page. */
export function DashboardTour({ isRep }) {
  return <GuidedTour steps={isRep ? REP_STEPS : ADMIN_STEPS} seenKey={SEEN_KEY} ariaLabel="Dashboard guided tour" />;
}
