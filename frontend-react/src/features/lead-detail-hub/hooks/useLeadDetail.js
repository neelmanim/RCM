import { useState, useEffect, useCallback, useRef } from 'react';
import { LeadsService, EmailService } from '../../../services/api';
import { mergeActivity } from '../lib/normalizeActivity';

/**
 * useLeadDetail(leadId)
 *
 * Priority-1 (getLead) blocks the shell; Priority-2 (calls page 1, tasks,
 * notes, journey, status+field history) fire in parallel right after, each
 * patching its own state slice independently so one failure doesn't blank the
 * rest. Priority-3 (older activity pages) is fetch-on-demand via
 * loadMoreActivities. No TanStack Query — this page's real needs (parallel
 * fetch on mount, a few targeted re-fetches after the call-outcome-resolved
 * event, a cache-of-one prefetch for the next lead) don't need a server-cache
 * library; every other hub in this codebase uses this same plain-hook
 * convention.
 *
 * Generation-counter guard: a slow fetch for a previous leadId must never
 * write into the current leadId's state after the user has paged away —
 * every async setter below checks the generation before writing.
 */
export function useLeadDetail(leadId) {
  const [lead, setLead] = useState(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [leadError, setLeadError] = useState(null);

  const [calls, setCalls] = useState([]);
  const [callsLoading, setCallsLoading] = useState(true);
  const [callsError, setCallsError] = useState(null);
  const [hasMoreActivities, setHasMoreActivities] = useState(false);
  const callsPageRef = useRef(1);

  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState(null);

  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState(null);

  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(true);
  const [emailsError, setEmailsError] = useState(null);

  const [journey, setJourney] = useState([]);
  const [journeyLoading, setJourneyLoading] = useState(true);

  const [statusHistory, setStatusHistory] = useState([]);
  const [fieldHistory, setFieldHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState(null);
  const researchInFlightRef = useRef(false);

  const generationRef = useRef(0);
  const leadCacheRef = useRef(new Map()); // prefetch-of-one cache, keyed by leadId

  const fetchLead = useCallback(async (id, gen) => {
    setLeadLoading(true);
    setLeadError(null);
    try {
      const cached = leadCacheRef.current.get(id);
      const data = cached || await LeadsService.getLead(id);
      leadCacheRef.current.delete(id);
      if (gen !== generationRef.current) return;
      setLead(data);
    } catch (err) {
      if (gen !== generationRef.current) return;
      setLeadError(err);
    } finally {
      if (gen === generationRef.current) setLeadLoading(false);
    }
  }, []);

  const fetchCalls = useCallback(async (id, gen, page = 1) => {
    setCallsLoading(true);
    setCallsError(null);
    try {
      const data = await LeadsService.getCallsForLead(id, page, 20);
      if (gen !== generationRef.current) return;
      setCalls((prev) => (page === 1 ? data.calls : [...prev, ...data.calls]));
      setHasMoreActivities(Boolean(data.has_more));
      callsPageRef.current = page;
    } catch (err) {
      if (gen !== generationRef.current) return;
      setCallsError(err);
    } finally {
      if (gen === generationRef.current) setCallsLoading(false);
    }
  }, []);

  const fetchTasks = useCallback(async (id, gen) => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const data = await LeadsService.getTasks(id);
      if (gen !== generationRef.current) return;
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      if (gen !== generationRef.current) return;
      setTasksError(err);
    } finally {
      if (gen === generationRef.current) setTasksLoading(false);
    }
  }, []);

  const fetchNotes = useCallback(async (id, gen) => {
    setNotesLoading(true);
    setNotesError(null);
    try {
      const data = await LeadsService.getNotes(id);
      if (gen !== generationRef.current) return;
      setNotes(Array.isArray(data) ? data : []);
    } catch (err) {
      if (gen !== generationRef.current) return;
      setNotesError(err);
    } finally {
      if (gen === generationRef.current) setNotesLoading(false);
    }
  }, []);

  const fetchEmails = useCallback(async (id, gen) => {
    setEmailsLoading(true);
    setEmailsError(null);
    try {
      const data = await EmailService.getEmailsForLead(id);
      if (gen !== generationRef.current) return;
      setEmails(Array.isArray(data?.emails) ? data.emails : []);
    } catch (err) {
      if (gen !== generationRef.current) return;
      setEmailsError(err);
    } finally {
      if (gen === generationRef.current) setEmailsLoading(false);
    }
  }, []);

  const fetchJourney = useCallback(async (id, gen) => {
    setJourneyLoading(true);
    try {
      const data = await LeadsService.getJourney(id);
      if (gen !== generationRef.current) return;
      setJourney(Array.isArray(data) ? data : []);
    } catch {
      if (gen !== generationRef.current) return;
      setJourney([]);
    } finally {
      if (gen === generationRef.current) setJourneyLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async (id, gen) => {
    setHistoryLoading(true);
    try {
      const [statusRes, fieldRes] = await Promise.allSettled([
        LeadsService.getStatusHistory(id),
        LeadsService.getFieldHistory(id),
      ]);
      if (gen !== generationRef.current) return;
      setStatusHistory(statusRes.status === 'fulfilled' && Array.isArray(statusRes.value) ? statusRes.value : []);
      setFieldHistory(fieldRes.status === 'fulfilled' && Array.isArray(fieldRes.value) ? fieldRes.value : []);
    } finally {
      if (gen === generationRef.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!leadId) return;
    const gen = ++generationRef.current;
    // Reset all slices immediately so a previous lead's data never flashes
    // under the new lead's header while Priority-2 fetches are in flight.
    setLead(null); setCalls([]); setTasks([]); setNotes([]); setEmails([]); setJourney([]);
    setStatusHistory([]); setFieldHistory([]); setHasMoreActivities(false);
    callsPageRef.current = 1;
    setResearchError(null);

    fetchLead(leadId, gen);
    fetchCalls(leadId, gen, 1);
    fetchTasks(leadId, gen);
    fetchNotes(leadId, gen);
    fetchEmails(leadId, gen);
    fetchJourney(leadId, gen);
    fetchHistory(leadId, gen);
  }, [leadId, fetchLead, fetchCalls, fetchTasks, fetchNotes, fetchEmails, fetchJourney, fetchHistory]);

  const prefetchLead = useCallback((id) => {
    if (!id || leadCacheRef.current.has(id)) return;
    LeadsService.getLead(id).then((data) => leadCacheRef.current.set(id, data)).catch(() => {});
  }, []);

  // RCA (ported from legacy's auto-research guard): a single in-flight lock
  // prevents a 429 storm from rapid re-triggers (rerenders, fast prev/next).
  const triggerResearch = useCallback(async (force = false) => {
    if (researchInFlightRef.current || !leadId) return;
    researchInFlightRef.current = true;
    const gen = generationRef.current;
    setResearching(true);
    setResearchError(null);
    try {
      const data = await LeadsService.triggerAiResearch(leadId, force);
      if (gen !== generationRef.current) return;
      setLead((prev) => (prev ? { ...prev, ...data } : prev));
    } catch (err) {
      if (gen !== generationRef.current) return;
      setResearchError(err);
    } finally {
      researchInFlightRef.current = false;
      if (gen === generationRef.current) setResearching(false);
    }
  }, [leadId]);

  const activities = mergeActivity({ calls, tasks, notes, statusHistory, fieldHistory, emails });

  return {
    lead, leadLoading, leadError,
    activities,
    callsLoading, callsError, hasMoreActivities,
    loadMoreActivities: () => fetchCalls(leadId, generationRef.current, callsPageRef.current + 1),
    tasks, tasksLoading, tasksError,
    notes, notesLoading, notesError,
    emails, emailsLoading, emailsError,
    journey, journeyLoading,
    statusHistory, fieldHistory, historyLoading,
    researching, researchError, triggerResearch,
    refetch: {
      lead: () => fetchLead(leadId, generationRef.current),
      activity: () => fetchCalls(leadId, generationRef.current, 1),
      tasks: () => fetchTasks(leadId, generationRef.current),
      notes: () => fetchNotes(leadId, generationRef.current),
      emails: () => fetchEmails(leadId, generationRef.current),
      journey: () => fetchJourney(leadId, generationRef.current),
      history: () => fetchHistory(leadId, generationRef.current),
    },
    prefetchLead,
  };
}
