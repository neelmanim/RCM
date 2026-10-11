import React from 'react';
import { GuidedTour as SharedGuidedTour } from '../../components/ui/GuidedTour';

export const CONTROL_CENTER_TOUR_KEY = 'alternate:control-center-tour-seen-v2';

// Control Center, in plain language. The tabs are always on the page; the steps inside a tab press that tab first (`click`), so the
// guide opens the right screen itself. A step for something this person cannot see (Export History is Super Admin only) is skipped.
export const CONTROL_CENTER_STEPS = [
  {
    target: '[data-tour="cc-search"]',
    title: 'Welcome to Control Center',
    body: 'This is where Alternate CRM is set up for your organisation. The tabs below are Integrations, Team & Access, AI & Automation, Data and Monitoring (you see the ones your role allows). Use this search box to jump straight to any setting.',
  },
  {
    target: '.controlcenter [data-tab="team-access"]',
    title: 'Team & Access',
    body: 'Who is on the team, their role and pod, and what each person may do, including who may download data.',
  },
  {
    target: '[data-tour="cc-data-export"]',
    click: '.controlcenter [data-tab="team-access"]',
    title: 'Who may download data',
    body: 'Data Export decides who can download CSV and Excel files. It is off for everyone except Super Admins until you switch it on for a person here. You are asked to confirm, and it takes effect straight away.',
  },
  {
    target: '[data-tour="cc-export-history"]',
    click: ['.controlcenter [data-tab="team-access"]', '.controlcenter [data-tab="exports"]'],
    title: 'Export History',
    body: 'Every download, with who took it and when, and every change to who may download. It is kept for good and cannot be edited. Only Super Admins see this tab.',
  },
  {
    target: '[data-tour="cc-sf-overview"]',
    click: ['.controlcenter [data-tab="integrations"]', '.controlcenter [data-tab="salesforce"]'],
    title: 'Salesforce at a glance',
    body: 'How many leads are in Alternate CRM, how many are already in Salesforce, how many exist only in Alternate CRM, and how many are waiting to be sent.',
  },
  {
    target: '[data-tour="cc-sf-sync"]',
    click: ['.controlcenter [data-tab="integrations"]', '.controlcenter [data-tab="salesforce"]'],
    title: 'What syncs',
    body: 'Switches apply straight away. Anything that writes data into Salesforce asks you to confirm first, so nothing moves by accident.',
  },
  {
    target: '[data-tour="cc-sf-mapping"]',
    click: ['.controlcenter [data-tab="integrations"]', '.controlcenter [data-tab="salesforce"]'],
    title: 'Field mapping',
    body: 'Choose which Alternate CRM field fills which Salesforce field. Everything except name, email, phone and status can be changed or switched off. History shows who added, changed or removed a mapping, and when.',
  },
  {
    target: '.controlcenter [data-tab="automation"]',
    title: 'AI & Automation',
    body: 'AI research settings, call outcomes and the sending windows for sales cadences.',
  },
  {
    target: '.controlcenter [data-tab="data"]',
    title: 'Data',
    body: 'Upload leads, see every upload with a per-rep breakdown and undo one if needed, export a rep\'s leads, and refresh the sandbox.',
  },
  {
    target: '.controlcenter [data-tab="monitoring"]',
    title: 'Monitoring',
    body: 'The Salesforce sync log with live numbers, plus error and performance logs when something looks wrong.',
  },
];

export function ControlCenterTour() {
  return <SharedGuidedTour steps={CONTROL_CENTER_STEPS} seenKey={CONTROL_CENTER_TOUR_KEY} ariaLabel="Control Center guided tour" />;
}
