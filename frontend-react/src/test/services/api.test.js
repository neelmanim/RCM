import { describe, it, expect, vi } from 'vitest';

// A real (non-jsdom-network) axios double so request bodies can be asserted
// on directly — the LeadsHub-level tests mock the whole services/api module,
// which can't see down to the literal body key a fix like reprioritize's
// needs to get right.
vi.mock('axios', () => {
  const instance = {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { default: { create: () => instance }, __mockInstance: instance };
});

import {
  LeadsService, AssignmentsService, AnalyticsService,
  SearchService, FeedbackService, TasksService,
  EmailService, AdminService, SettingsService,
  PodsService, UploadService, CallsService,
  DialerService, AuthService
} from '../../services/api';

describe('API Service Layer — Method Existence', () => {
  describe('LeadsService', () => {
    it('has all required methods', () => {
      const methods = ['getLeads', 'getAllLeads', 'getLead', 'updateLead', 'deleteLead', 'createLead',
        'addNote', 'deleteNote', 'logCall', 'getCallsForLead', 'getNotes',
        'getStatusHistory', 'closeLead', 'reprioritize', 'getCompanies',
        'addTask', 'getTasks', 'patchTask', 'deleteTask', 'updateCallOutcome'];
      methods.forEach(m => expect(typeof LeadsService[m]).toBe('function'));
    });
  });

  describe('AssignmentsService', () => {
    it('has all required methods', () => {
      const methods = ['getUnassigned', 'getAssigned', 'bulkAssign', 'bulkUnassign', 'bulkDelete', 'autoAssignAll'];
      methods.forEach(m => expect(typeof AssignmentsService[m]).toBe('function'));
    });
  });

  describe('AnalyticsService', () => {
    it('has all required methods', () => {
      const methods = ['getFilters', 'getFunnel', 'getTrend', 'getSdrTable',
        'getEmailBreakdown', 'getBatchSummary', 'getAiRecommendation', 'downloadCsv'];
      methods.forEach(m => expect(typeof AnalyticsService[m]).toBe('function'));
    });
  });

  describe('SearchService', () => {
    it('has global search', () => {
      expect(typeof SearchService.global).toBe('function');
    });
  });

  describe('FeedbackService', () => {
    it('has all required methods', () => {
      expect(typeof FeedbackService.submit).toBe('function');
      expect(typeof FeedbackService.getAll).toBe('function');
      expect(typeof FeedbackService.patchStatus).toBe('function');
    });
  });

  describe('TasksService', () => {
    it('has all required methods', () => {
      expect(typeof TasksService.getPending).toBe('function');
      expect(typeof TasksService.dismiss).toBe('function');
      expect(typeof TasksService.snooze).toBe('function');
    });
  });

  describe('EmailService', () => {
    it('has all required methods', () => {
      const methods = ['getStatus', 'getEmailsForLead', 'sendEmail', 'getAuthUrl', 'disconnect', 'downloadAttachment'];
      methods.forEach(m => expect(typeof EmailService[m]).toBe('function'));
    });
  });

  describe('AdminService', () => {
    it('has all required methods', () => {
      expect(typeof AdminService.getMetricsSummary).toBe('function');
      expect(typeof AdminService.getUsers).toBe('function');
    });
  });

  describe('SettingsService', () => {
    it('has Salesforce methods', () => {
      expect(typeof SettingsService.getSfStatus).toBe('function');
      expect(typeof SettingsService.connectSf).toBe('function');
    });
  });

  describe('PodsService', () => {
    it('has CRUD methods', () => {
      expect(typeof PodsService.getAll).toBe('function');
      expect(typeof PodsService.create).toBe('function');
    });
  });

  describe('UploadService', () => {
    it('has upload methods', () => {
      expect(typeof UploadService.getLogs).toBe('function');
    });
  });
});

describe('LeadsService.reprioritize', () => {
  it('sends priority_score, matching what PATCH /leads/{id}/priority actually reads (not `score`)', async () => {
    const axios = await import('axios');
    await LeadsService.reprioritize('lead-1', 50);
    expect(axios.__mockInstance.patch).toHaveBeenCalledWith('/leads/lead-1/priority', { priority_score: 50 });
  });
});
