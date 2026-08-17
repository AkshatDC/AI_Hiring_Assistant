import { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, Users, PhoneCall, Search, CheckCircle,
  Play, RefreshCw, Sparkles, FileText, Compass,
  MapPin, Check, AlertCircle, Star,
  Bot, Plus, Zap, BarChart3,
  Mic, Globe, ArrowRight, Trash2,
  ExternalLink, Shield, Phone, Edit3, Save,
  Filter, CalendarDays, ClipboardList, Mail, Copy, ClipboardCheck, ShieldCheck
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  title: string;
  description: string;
  requirements: {
    title: string;
    skills: string[];
    experience_years: number;
    location: string;
    education: string;
    target_salary: string;
    notice_period_days: number;
    technical_requirements: string;
  };
  agent_config: any;
  created_at: string;
}

interface Candidate {
  id: string;
  job_id: string;
  name: string;
  phone: string;
  email?: string;
  pdl_id?: string;
  title?: string;
  company?: string;
  skills: string[];
  call_id?: string | null;
  call_status: string;
  agent_id?: string;
  recording_url?: string | null;
  answers: Record<string, any>;
  evaluation: {
    overall_score?: number;
    technical_score?: number;
    communication_score?: number;
    experience_score?: number;
    requirements_score?: number;
    recommendation?: 'SHORTLIST' | 'REJECT';
    decision?: 'ADVANCE' | 'HOLD' | 'DECLINE';
    confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
    strengths?: string[];
    risks?: string[];
    interview_focus?: string[];
    justification?: string;
  };
  stage?: string;
  recruiter_notes?: string;
  follow_up_at?: string | null;
  follow_up_status?: string;
  interview_feedback?: { interviewer: string; recommendation: string; notes?: string; score?: number; created_at?: string }[];
  offer?: { status?: string; amount?: string; joining_date?: string };
  consent_status?: string;
  preferred_contact_time?: string;
  outreach_log?: { type: string; message: string; prepared_at: string }[];
  created_at: string;
}

interface Analytics {
  total_candidates: number;
  calls_completed: number;
  evaluated: number;
  shortlisted: number;
  shortlist_rate: number;
  call_completion_rate: number;
  stage_counts: Record<string, number>;
  average_stage_age_hours: number;
  decline_reasons: Record<string, number>;
  overdue_follow_ups: Candidate[];
}

interface HunarAgent {
  id: string;
  name: string;
  status: string;
  voice_persona: string;
  persona_name: string;
  language: string;
  summary?: string;
  logo?: string;
  custom_variables?: string[];
  result_schema?: Record<string, any>;
  agent_prompt?: string;
  introduction?: string;
  objective?: string;
  silence_response?: string;
  conclusion?: string;
  result_prompt?: string;
  agent_code?: string;
  max_call_duration_seconds?: number;
  max_retries?: number;
  retry_delay_seconds?: number;
  calling_hours_start?: string;
  calling_hours_end?: string;
  do_not_call_topics?: string[];
}

interface Config {
  session_id?: string;
  hunar_configured: boolean;
  gemini_configured: boolean;
  apollo_configured: boolean;
  coresignal_configured: boolean;
  credentials_configured?: boolean;
  public_webhook_url: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  NOT_STARTED: 'bg-slate-100 text-slate-500 border-slate-200',
  INITIATED: 'bg-blue-50 text-blue-600 border-blue-200',
  RINGING: 'bg-violet-50 text-violet-600 border-violet-200 animate-pulse',
  IN_PROGRESS: 'bg-amber-50 text-amber-600 border-amber-200 animate-pulse',
  COMPLETED: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  FAILED: 'bg-red-50 text-red-600 border-red-200',
  NOT_CONNECTED: 'bg-rose-50 text-rose-600 border-rose-200',
};

const isMasked = (v: any) => !v || v === '' || (typeof v === 'string' && v.startsWith('['));

const readableLabel = (value?: string) => (value || 'Not set').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

const decisionCopy = (decision?: string, recommendation?: string) => {
  const value = decision ?? (recommendation === 'SHORTLIST' ? 'ADVANCE' : 'HOLD');
  if (value === 'ADVANCE') return { label: 'Recommended: move to interview', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (value === 'DECLINE') return { label: 'Not recommended to proceed', className: 'bg-red-50 text-red-700 border-red-200' };
  return { label: 'Needs recruiter review', className: 'bg-amber-50 text-amber-700 border-amber-200' };
};

/** Normalize a LinkedIn URL so it always starts with https://www.linkedin.com */
const normalizeLinkedIn = (url: string): string => {
  if (!url) return '';
  // Fix missing colon if present
  if (url.startsWith('https//')) url = url.replace('https//', 'https://');
  if (url.startsWith('http//')) url = url.replace('http//', 'http://');
  // Already fully qualified
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Starts with www.
  if (url.startsWith('www.')) return 'https://' + url;
  // Relative like linkedin.com/in/...
  return 'https://' + url;
};

const SESSION_STORAGE_KEY = 'ai_hiring_assistant_session_id';

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  // Global state
  const [activeTab, setActiveTab] = useState<'jd' | 'source' | 'calls' | 'dashboard'>('jd');
  const [config, setConfig] = useState<Config | null>(null);
  const [sessionId, setSessionId] = useState<string>(localStorage.getItem(SESSION_STORAGE_KEY) || '');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [credentialsForm, setCredentialsForm] = useState({
    hunar_api_key: '',
    apollo_api_key: '',
    coresignal_api_key: '',
    gemini_api_key: '',
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');

  // JD tab
  const [jdTitle, setJdTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [isParsingJd, setIsParsingJd] = useState(false);

  // Sourcing tab
  const [searchTitle, setSearchTitle] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [searchSkills, setSearchSkills] = useState('');
  const [searchExp, setSearchExp] = useState(2);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addedCandidateIds, setAddedCandidateIds] = useState<string[]>([]);
  const [isAutoAdding, setIsAutoAdding] = useState(false);

  // Candidates
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [phoneOverrides, setPhoneOverrides] = useState<Record<string, string>>({});

  // Calls tab
  const [agents, setAgents] = useState<HunarAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [isBulkCalling, setIsBulkCalling] = useState(false);
  const [bulkCallMsg, setBulkCallMsg] = useState('');

  // Pipeline limit for sourcing
  const [pipelineLimit, setPipelineLimit] = useState<number | ''>('');

  // Create agent form
  const [agentForm, setAgentForm] = useState({
    name: '',
    language: 'ENGLISH',
    voice_persona: 'NEHA',
    persona_name: 'Seema',
    agent_prompt: '',
    introduction: '',
    objective: '',
    silence_response: 'Are you there?',
    conclusion: 'Have a wonderful day!',
    result_prompt: '',
    custom_variables: 'callee_name,job_title,company,jd_summary',
    result_schema_keys: 'interested,notice_period,expected_ctc,years_of_experience,summary',
    // Guardrails
    max_call_duration_seconds: 300,
    max_retries: 2,
    retry_delay_seconds: 60,
    calling_hours_start: '09:00',
    calling_hours_end: '18:00',
    do_not_call_topics: 'salary negotiation,personal questions,competitor details',
  });
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);

  // Edit existing agent
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editAgentForm, setEditAgentForm] = useState<Record<string, any>>({});
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [editTab, setEditTab] = useState<'script' | 'guardrails'>('script');
  const [createTab, setCreateTab] = useState<'script' | 'guardrails'>('script');

  // Dashboard
  const [activeCandidateDetail, setActiveCandidateDetail] = useState<Candidate | null>(null);
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [outreachMessage, setOutreachMessage] = useState('');
  const [feedbackForm, setFeedbackForm] = useState({ interviewer: '', recommendation: 'HIRE', notes: '', score: '4' });

  // ─── Data fetchers ───────────────────────────────────────────────────────────

  const refreshSessionConfig = useCallback(async () => {
    const res = await fetch(`${API_BASE}/config`);
    const data = await res.json();
    setConfig(data);
    return data as Config;
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      await refreshSessionConfig();
    } catch (e) { console.error(e); }
  }, [refreshSessionConfig]);

  const bootstrapSession = useCallback(async () => {
    try {
      const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      const res = await fetch(`${API_BASE}/session`, {
        headers: storedSessionId ? { 'X-Session-ID': storedSessionId } : undefined,
      });
      const data = await res.json();
      const nextSessionId = data.session_id || storedSessionId || '';
      if (nextSessionId) {
        localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
        setSessionId(nextSessionId);
      }
      setConfig(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsBootstrapping(false);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      setJobs(await res.json());
    } catch (e) { console.error(e); }
  }, []);

  const fetchCandidates = useCallback(async (jobId: string) => {
    if (!jobId) return;
    try {
      const res = await fetch(`${API_BASE}/candidates?job_id=${jobId}`);
      setCandidates(await res.json());
    } catch (e) { console.error(e); }
  }, []);

  const updateCandidateWorkflow = async (candidateId: string, update: Record<string, any>) => {
    setIsSavingWorkflow(true);
    try {
      const res = await fetch(`${API_BASE}/candidates/${candidateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error('Could not save candidate workflow');
      const saved = await res.json();
      setActiveCandidateDetail(saved);
      await fetchCandidates(selectedJobId);
    } catch (error) {
      console.error(error);
      alert('Could not save the candidate update. Please try again.');
    } finally {
      setIsSavingWorkflow(false);
    }
  };

  const fetchAnalytics = useCallback(async (jobId: string) => {
    if (!jobId) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/analytics`);
      if (res.ok) setAnalytics(await res.json());
    } catch (error) { console.error(error); }
  }, []);

  const handleBulkStage = async (stage: string) => {
    if (compareIds.length === 0) return alert('Select candidates from the ranked pipeline first.');
    setIsSavingWorkflow(true);
    try {
      const res = await fetch(`${API_BASE}/candidates/bulk-update`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_ids: compareIds, stage }),
      });
      if (!res.ok) throw new Error('Bulk update failed');
      setCompareIds([]);
      await fetchCandidates(selectedJobId);
      await fetchAnalytics(selectedJobId);
    } catch (error) { console.error(error); alert('Could not update the selected candidates.'); }
    finally { setIsSavingWorkflow(false); }
  };

  const prepareOutreach = async (type: string) => {
    if (!activeCandidateDetail) return;
    try {
      const res = await fetch(`${API_BASE}/candidates/${activeCandidateDetail.id}/outreach`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not prepare message');
      setOutreachMessage(data.message);
      setActiveCandidateDetail(data.candidate);
      fetchCandidates(selectedJobId);
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not prepare message'); }
  };

  const addInterviewFeedback = async () => {
    if (!activeCandidateDetail || !feedbackForm.interviewer.trim()) return alert('Add the interviewer name first.');
    try {
      const res = await fetch(`${API_BASE}/candidates/${activeCandidateDetail.id}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...feedbackForm, score: Number(feedbackForm.score) }),
      });
      if (!res.ok) throw new Error('Feedback could not be saved');
      setActiveCandidateDetail(await res.json());
      setFeedbackForm({ interviewer: '', recommendation: 'HIRE', notes: '', score: '4' });
      fetchCandidates(selectedJobId);
    } catch (error) { console.error(error); alert('Could not save interview feedback.'); }
  };

  const copyHandoff = async () => {
    if (!activeCandidateDetail) return;
    try {
      const res = await fetch(`${API_BASE}/candidates/${activeCandidateDetail.id}/handoff`);
      if (!res.ok) throw new Error('Could not prepare handoff');
      await navigator.clipboard.writeText(JSON.stringify(await res.json(), null, 2));
      alert('Hiring-manager handoff copied to the clipboard.');
    } catch (error) { console.error(error); alert('Could not copy the handoff packet.'); }
  };

  const handleSaveCredentials = async () => {
    setIsSavingCredentials(true);
    try {
      const res = await fetch(`${API_BASE}/session/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentialsForm),
      });
      if (!res.ok) throw new Error('Could not save credentials');
      const data = await res.json();
      setConfig(prev => ({
        ...(prev || {}),
        ...data,
        public_webhook_url: prev?.public_webhook_url || config?.public_webhook_url || '',
      }));
      await fetchConfig();
      alert('Credentials saved for this session.');
    } catch (error) {
      console.error(error);
      alert('Could not save credentials.');
    } finally {
      setIsSavingCredentials(false);
    }
  };

  const fetchAgents = useCallback(async () => {
    setIsLoadingAgents(true);
    try {
      const res = await fetch(`${API_BASE}/agents`);
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setIsLoadingAgents(false); }
  }, []);

  // ─── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    if (!sessionId) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (requestUrl.startsWith(API_BASE)) {
        const headers = new Headers(init.headers || (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
        headers.set('X-Session-ID', sessionId);
        return originalFetch(input as any, { ...init, headers });
      }
      return originalFetch(input as any, init);
    }) as typeof window.fetch;
    return () => {
      window.fetch = originalFetch;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    void fetchConfig();
    void fetchJobs();
    void fetchAgents();
  }, [sessionId, fetchConfig, fetchJobs, fetchAgents]);

  useEffect(() => {
    if (!selectedJobId) return;
    fetchCandidates(selectedJobId);
    const job = jobs.find(j => j.id === selectedJobId);
    if (job) {
      setSearchTitle(job.requirements.title || job.title);
      setSearchLocation(job.requirements.location || '');
      setSearchSkills(job.requirements.skills.join(', '));
      setSearchExp(job.requirements.experience_years || 2);
    }
  }, [selectedJobId, jobs]);

  useEffect(() => { fetchAnalytics(selectedJobId); }, [selectedJobId, candidates, fetchAnalytics]);

  // Poll candidates every 4s when on calls/dashboard tabs
  useEffect(() => {
    if (!selectedJobId || (activeTab !== 'calls' && activeTab !== 'dashboard')) return;
    const id = setInterval(() => fetchCandidates(selectedJobId), 4000);
    return () => clearInterval(id);
  }, [selectedJobId, activeTab]);

  useEffect(() => {
    if (activeTab === 'calls') fetchAgents();
  }, [activeTab]);

  // Keep activeCandidateDetail in sync after polling
  useEffect(() => {
    if (!activeCandidateDetail) return;
    const updated = candidates.find(c => c.id === activeCandidateDetail.id);
    if (updated) setActiveCandidateDetail(updated);
  }, [candidates]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const currentJob = jobs.find(j => j.id === selectedJobId);

  const handleParseJD = async () => {
    if (!jdTitle || !jdText) return;
    setIsParsingJd(true);
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: jdTitle, description: jdText })
      });
      const newJob = await res.json();
      await fetchJobs();
      setSelectedJobId(newJob.id);
      setJdTitle('');
      setJdText('');
      // Pre-fill agent form from job's suggested config
      const cfg = newJob.agent_config || {};
      setAgentForm(prev => ({
        ...prev,
        name: cfg.name || `Screening: ${newJob.title}`,
        agent_prompt: cfg.agent_prompt || prev.agent_prompt,
        introduction: cfg.introduction || prev.introduction,
        objective: cfg.objective || prev.objective,
        result_prompt: cfg.result_prompt || prev.result_prompt,
      }));
      setActiveTab('source');
    } catch (e) { console.error(e); }
    finally { setIsParsingJd(false); }
  };

  const handleManualSearch = async () => {
    if (!selectedJobId) return alert('Select a job first');
    setIsSearching(true);
    try {
      const skillsArray = searchSkills.split(',').map(s => s.trim()).filter(Boolean);
      const res = await fetch(`${API_BASE}/sourcing/search?job_id=${selectedJobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: searchTitle || null,
          location: searchLocation || null,
          skills: skillsArray.length > 0 ? skillsArray : null,
          experience_years: searchExp || null,
          size: 10
        })
      });
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setIsSearching(false); }
  };

  const handleAddToPipeline = async (cand: any) => {
    if (!selectedJobId) return;
    const mobile = cand.mobile_phone;
    const phones = cand.phone_numbers || [];
    const phone = mobile && !isMasked(mobile) ? mobile : (phones[0] || 'Unknown');
    const email = cand.work_email && !isMasked(cand.work_email) ? cand.work_email : '';
    try {
      await fetch(`${API_BASE}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: selectedJobId,
          name: cand.full_name || `${cand.first_name} ${cand.last_name}`.trim() || 'Unknown',
          phone: String(phone),
          email,
          pdl_id: cand.id,
          title: cand.job_title,
          company: cand.job_company_name,
          skills: cand.skills || []
        })
      });
      setAddedCandidateIds(prev => [...prev, cand.id]);
      fetchCandidates(selectedJobId);
    } catch (e) { console.error(e); }
  };

  const handleAutoAddAll = async () => {
    if (!selectedJobId) return alert('Select a job first');
    setIsAutoAdding(true);
    try {
      const limitParam = pipelineLimit ? `&pipeline_limit=${pipelineLimit}` : '';
      const res = await fetch(`${API_BASE}/sourcing/auto-search?job_id=${selectedJobId}&auto_add=true${limitParam}`, {
        method: 'POST'
      });
      const data = await res.json();
      setSearchResults(data.results || []);
      setAddedCandidateIds(prev => [...prev, ...(data.results || []).map((r: any) => r.id)]);
      fetchCandidates(selectedJobId);
      if (data.ranked_applied) {
        alert(`✅ AI ranked ${data.total_sourced} candidates and selected the top ${data.added_count} for your pipeline.`);
      }
    } catch (e) { console.error(e); }
    finally { setIsAutoAdding(false); }
  };

  const handleRemoveCandidate = async (candidateId: string) => {
    try {
      await fetch(`${API_BASE}/candidates/${candidateId}`, { method: 'DELETE' });
      fetchCandidates(selectedJobId);
    } catch (e) { console.error(e); }
  };

  const handleBulkCall = async () => {
    if (!selectedAgentId) return alert('Please select or create a voice agent first');
    if (!selectedJobId) return alert('Please select a job first');
    const pending = candidates.filter(c => c.call_status === 'NOT_STARTED');
    if (pending.length === 0) return alert('No pending candidates to call');
    
    // Save any pending phone overrides
    for (const cand of pending) {
      if (phoneOverrides[cand.id] && phoneOverrides[cand.id] !== cand.phone) {
        try {
          await fetch(`${API_BASE}/candidates/${cand.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneOverrides[cand.id] })
          });
        } catch(e) {}
      }
    }

    setIsBulkCalling(true);
    setBulkCallMsg('');
    try {
      const res = await fetch(`${API_BASE}/calls/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: selectedJobId, agent_id: selectedAgentId })
      });
      const data = await res.json();
      setBulkCallMsg(`✅ Bulk call initiated for ${data.triggered} candidates!`);
      fetchCandidates(selectedJobId);
    } catch (e) { console.error(e); setBulkCallMsg('❌ Bulk call failed. Check console.'); }
    finally { setIsBulkCalling(false); }
  };

  const handleSimulateOne = async (candidateId: string) => {
    try {
      await fetch(`${API_BASE}/candidates/${candidateId}/simulate`, { method: 'POST' });
      fetchCandidates(selectedJobId);
    } catch (e) { console.error(e); }
  };

  const handlePreFillAgentFromJD = async () => {
    if (!selectedJobId) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${selectedJobId}/suggested-agent`);
      const cfg = await res.json();
      setAgentForm(prev => ({
        ...prev,
        name: cfg.name || prev.name,
        agent_prompt: cfg.agent_prompt || prev.agent_prompt,
        introduction: cfg.introduction || prev.introduction,
        objective: cfg.objective || prev.objective,
        result_prompt: cfg.result_prompt || prev.result_prompt,
      }));
    } catch (e) { console.error(e); }
  };

  const handleCreateAgent = async () => {
    setIsCreatingAgent(true);
    try {
      const customVars = agentForm.custom_variables.split(',').map(s => s.trim()).filter(Boolean);
      const resultKeys = agentForm.result_schema_keys.split(',').map(s => s.trim()).filter(Boolean);
      const resultSchema: Record<string, string> = {};
      resultKeys.forEach(k => { resultSchema[k] = ''; });

      const dncTopics = agentForm.do_not_call_topics.split(',').map(s => s.trim()).filter(Boolean);

      const res = await fetch(`${API_BASE}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentForm.name,
          language: agentForm.language,
          voice_persona: agentForm.voice_persona,
          persona_name: agentForm.persona_name,
          agent_prompt: agentForm.agent_prompt,
          introduction: agentForm.introduction,
          objective: agentForm.objective,
          silence_response: agentForm.silence_response,
          conclusion: agentForm.conclusion,
          result_prompt: agentForm.result_prompt,
          custom_variables: customVars,
          result_schema: resultSchema,
          max_call_duration_seconds: agentForm.max_call_duration_seconds || undefined,
          max_retries: agentForm.max_retries ?? undefined,
          retry_delay_seconds: agentForm.retry_delay_seconds || undefined,
          calling_hours_start: agentForm.calling_hours_start || undefined,
          calling_hours_end: agentForm.calling_hours_end || undefined,
          do_not_call_topics: dncTopics.length > 0 ? dncTopics : undefined,
        })
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Agent creation failed: ' + (err.detail || JSON.stringify(err)));
        return;
      }
      const newAgent = await res.json();
      setShowCreateAgent(false);
      await fetchAgents();
      setSelectedAgentId(newAgent.id);
    } catch (e) { console.error(e); alert('Failed to create agent'); }
    finally { setIsCreatingAgent(false); }
  };

  const handleStartEditAgent = (agent: HunarAgent) => {
    setEditingAgentId(agent.id);
    setEditAgentForm({
      name: agent.name || '',
      language: agent.language || 'ENGLISH',
      voice_persona: agent.voice_persona || 'NEHA',
      persona_name: agent.persona_name || '',
      agent_prompt: agent.agent_prompt || '',
      introduction: agent.introduction || '',
      objective: agent.objective || '',
      silence_response: agent.silence_response || 'Are you there?',
      conclusion: agent.conclusion || 'Have a wonderful day!',
      result_prompt: agent.result_prompt || '',
      custom_variables: (agent.custom_variables || []).join(','),
      result_schema_keys: Object.keys(agent.result_schema || {}).join(','),
      // Guardrails
      max_call_duration_seconds: agent.max_call_duration_seconds || 300,
      max_retries: agent.max_retries !== undefined ? agent.max_retries : 2,
      retry_delay_seconds: agent.retry_delay_seconds || 60,
      calling_hours_start: agent.calling_hours_start || '09:00',
      calling_hours_end: agent.calling_hours_end || '18:00',
      do_not_call_topics: (agent.do_not_call_topics || []).join(','),
    });
    setShowCreateAgent(false);
  };

  const handleSaveAgent = async () => {
    if (!editingAgentId) return;
    setIsSavingAgent(true);
    try {
      const customVars = editAgentForm.custom_variables?.split(',').map((s: string) => s.trim()).filter(Boolean);
      const resultKeys = editAgentForm.result_schema_keys?.split(',').map((s: string) => s.trim()).filter(Boolean);
      const resultSchema: Record<string, string> = {};
      (resultKeys || []).forEach((k: string) => { resultSchema[k] = ''; });
      const dncTopics = editAgentForm.do_not_call_topics?.split(',').map((s: string) => s.trim()).filter(Boolean);

      const patchBody: Record<string, any> = {
        name: editAgentForm.name,
        language: editAgentForm.language,
        voice_persona: editAgentForm.voice_persona,
        persona_name: editAgentForm.persona_name,
        agent_prompt: editAgentForm.agent_prompt,
        introduction: editAgentForm.introduction,
        objective: editAgentForm.objective,
        silence_response: editAgentForm.silence_response,
        conclusion: editAgentForm.conclusion,
        result_prompt: editAgentForm.result_prompt,
        custom_variables: customVars,
        result_schema: resultSchema,
        max_call_duration_seconds: editAgentForm.max_call_duration_seconds || undefined,
        max_retries: editAgentForm.max_retries ?? undefined,
        retry_delay_seconds: editAgentForm.retry_delay_seconds || undefined,
        calling_hours_start: editAgentForm.calling_hours_start || undefined,
        calling_hours_end: editAgentForm.calling_hours_end || undefined,
        do_not_call_topics: dncTopics?.length > 0 ? dncTopics : undefined,
      };

      const res = await fetch(`${API_BASE}/agents/${editingAgentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody)
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Agent update failed: ' + (err.detail || JSON.stringify(err)));
        return;
      }
      setEditingAgentId(null);
      await fetchAgents();
    } catch (e) { console.error(e); alert('Failed to save agent'); }
    finally { setIsSavingAgent(false); }
  };

  // ─── UI helpers ──────────────────────────────────────────────────────────────

  const notStarted = candidates.filter(c => c.call_status === 'NOT_STARTED').length;
  const activeCalls = candidates.filter(c => ['RINGING', 'IN_PROGRESS'].length > 0 && ['RINGING', 'IN_PROGRESS'].includes(c.call_status)).length;
  const completed = candidates.filter(c => c.call_status === 'COMPLETED').length;
  const shortlisted = candidates.filter(c => c.evaluation?.recommendation === 'SHORTLIST').length;

  const NavBtn = ({ tab, label, icon: Icon, badge }: { tab: typeof activeTab; label: string; icon: any; badge?: number }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
        activeTab === tab
          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent'
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge != null && badge > 0 && (
        <span className="bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center">
          {badge}
        </span>
      )}
    </button>
  );

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-500'}`}>
      {status.replace('_', ' ')}
    </span>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  const needsCredentialSetup = !isBootstrapping && !config?.credentials_configured;

  if (isBootstrapping) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-white px-6">
        <div className="max-w-md w-full rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-indigo-500/20 text-indigo-200">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black">Starting session</h1>
              <p className="text-sm text-slate-300">Preparing your private workspace</p>
            </div>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (needsCredentialSetup) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white px-6 py-10">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 rounded-2xl bg-white/10 text-cyan-300">
              <Shield className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">API Key Setup</h1>
              <p className="text-slate-300 mt-1">Enter your own credentials once. This browser session will keep them private on the backend.</p>
            </div>
          </div>

          <div className="grid md:grid-cols-[1.2fr_0.8fr] gap-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-6 shadow-2xl">
              <div className="grid gap-4">
                {[
                  { key: 'hunar_api_key', label: 'Hunar API Key' },
                  { key: 'apollo_api_key', label: 'Apollo API Key' },
                  { key: 'coresignal_api_key', label: 'CoreSignal API Key' },
                  { key: 'gemini_api_key', label: 'Gemini API Key' },
                ].map(field => (
                  <label key={field.key} className="flex flex-col gap-2 text-sm text-slate-200">
                    <span className="font-semibold">{field.label}</span>
                    <input
                      type="password"
                      value={credentialsForm[field.key as keyof typeof credentialsForm]}
                      onChange={event => setCredentialsForm(previous => ({ ...previous, [field.key]: event.target.value }))}
                      className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
                      placeholder="Paste your key here"
                    />
                  </label>
                ))}
                <button
                  onClick={handleSaveCredentials}
                  disabled={isSavingCredentials}
                  className="mt-2 rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
                >
                  {isSavingCredentials ? 'Saving...' : 'Save & Continue'}
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-6">
              <h2 className="text-lg font-bold mb-4">What happens next</h2>
              <div className="space-y-3 text-sm text-slate-300">
                <p>1. Your keys are tied to this browser session only.</p>
                <p>2. Jobs, candidates, calls, and evaluations stay isolated per session.</p>
                <p>3. The frontend automatically sends your session ID with every request.</p>
                <p>4. Hunar webhooks resolve back to the right candidate through that session-linked record.</p>
              </div>
              {sessionId && <p className="mt-5 text-xs text-slate-400 break-all">Session ID: {sessionId}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 text-slate-900 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-md">
            <Briefcase className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900 leading-none">
              HireFlow AI
            </h1>
            <p className="text-[10px] text-slate-400 mt-0.5">Voice-first AI Hiring Platform</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Job selector */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl">
            <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
            <select
              value={selectedJobId}
              onChange={e => setSelectedJobId(e.target.value)}
              className="bg-transparent text-sm text-slate-700 outline-none cursor-pointer font-medium pr-4 min-w-[180px]"
            >
              <option value="" disabled>— Select Job Pipeline —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </div>

          {/* Status indicators */}
          <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${config?.apollo_configured ? 'bg-emerald-400' : config?.coresignal_configured ? 'bg-blue-400' : 'bg-amber-400'}`} />
              <span>Sourcing: {config?.apollo_configured ? 'Apollo Live' : config?.coresignal_configured ? 'CoreSignal Live' : 'Mock'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${config?.hunar_configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>Voice: {config?.hunar_configured ? 'Live' : 'Sandbox'}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r border-slate-200 bg-white/70 backdrop-blur-sm p-4 flex flex-col gap-1.5 shadow-sm flex-shrink-0">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">Workflow</div>
          <NavBtn tab="jd" label="1. Create JD" icon={FileText} />
          <NavBtn tab="source" label="2. Source Candidates" icon={Search} badge={candidates.length > 0 ? candidates.length : undefined} />
          <NavBtn tab="calls" label="3. Voice Campaigns" icon={PhoneCall} badge={activeCalls > 0 ? activeCalls : undefined} />
          <NavBtn tab="dashboard" label="4. Results Dashboard" icon={BarChart3} badge={shortlisted > 0 ? shortlisted : undefined} />

          {/* Mini stats */}
          {selectedJobId && (
            <div className="mt-auto pt-4 border-t border-slate-100 flex flex-col gap-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2">Pipeline</div>
              {[
                { label: 'In Queue', val: notStarted, color: 'text-slate-600' },
                { label: 'Active Calls', val: activeCalls, color: 'text-amber-600' },
                { label: 'Completed', val: completed, color: 'text-emerald-600' },
                { label: 'Shortlisted', val: shortlisted, color: 'text-indigo-600' },
              ].map(s => (
                <div key={s.label} className="flex justify-between items-center px-2 text-xs">
                  <span className="text-slate-500">{s.label}</span>
                  <span className={`font-bold ${s.color}`}>{s.val}</span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* ═══════════════════════ TAB 1: CREATE JD ═══════════════════════ */}
          {activeTab === 'jd' && (
            <div className="max-w-4xl mx-auto flex flex-col gap-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Create Job Description</h2>
                <p className="text-sm text-slate-500 mt-1">AI parses your JD to extract skills, experience, location — auto-prepares sourcing & agent config</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* JD form */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-500" />
                    Job Description Input
                  </h3>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-slate-500">Job Title</label>
                    <input
                      type="text"
                      value={jdTitle}
                      onChange={e => setJdTitle(e.target.value)}
                      placeholder="e.g. Senior React Engineer"
                      className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-all"
                    />
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    <label className="text-xs font-medium text-slate-500">Full JD Text</label>
                    <textarea
                      rows={10}
                      value={jdText}
                      onChange={e => setJdText(e.target.value)}
                      placeholder="Paste the full job description here — required skills, experience, location, notice period, salary range, responsibilities..."
                      className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-all resize-none flex-1"
                    />
                  </div>
                  <button
                    onClick={handleParseJD}
                    disabled={isParsingJd || !jdTitle || !jdText}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all duration-200 shadow-md"
                  >
                    {isParsingJd ? (
                      <><RefreshCw className="h-4 w-4 animate-spin" /> Parsing with AI...</>
                    ) : (
                      <><Sparkles className="h-4 w-4" /> Parse JD & Create Pipeline</>
                    )}
                  </button>
                </div>

                {/* Existing jobs */}
                <div className="flex flex-col gap-4">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-indigo-500" />
                    Active Job Pipelines ({jobs.length})
                  </h3>
                  {jobs.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
                      <Briefcase className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                      <p className="text-sm">No jobs yet — create your first JD on the left</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {jobs.map(job => (
                        <div
                          key={job.id}
                          onClick={() => setSelectedJobId(job.id)}
                          className={`bg-white rounded-xl border p-4 cursor-pointer transition-all duration-200 ${
                            selectedJobId === job.id
                              ? 'border-indigo-400 shadow-md ring-2 ring-indigo-100'
                              : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-semibold text-slate-900 text-sm">{job.title}</h4>
                              <p className="text-xs text-slate-500 mt-0.5">{job.requirements.title} • {job.requirements.experience_years}+ yrs • {job.requirements.location}</p>
                            </div>
                            {selectedJobId === job.id && (
                              <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-bold flex-shrink-0">Active</span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {job.requirements.skills.slice(0, 4).map((s, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{s}</span>
                            ))}
                            {job.requirements.skills.length > 4 && (
                              <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">+{job.requirements.skills.length - 4} more</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {currentJob && (
                    <button
                      onClick={() => setActiveTab('source')}
                      className="w-full py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all"
                    >
                      Source Candidates for {currentJob.title} <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════ TAB 2: SOURCING ═══════════════════════ */}
          {activeTab === 'source' && (
            <div className="max-w-6xl mx-auto flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Source Candidates</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Search Apollo.io directory
                    {config?.apollo_configured
                      ? <span className="text-emerald-600 font-medium"> (Live Apollo API)</span>
                      : config?.coresignal_configured
                        ? <span className="text-blue-600 font-medium"> (CoreSignal Fallback)</span>
                        : <span className="text-amber-600 font-medium"> (Mock Data — add APOLLO_API_KEY to .env)</span>}
                  </p>
                </div>
                {selectedJobId && (
                  <div className="flex items-center gap-3">
                    {/* Pipeline Limit */}
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
                      <Filter className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Top</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={pipelineLimit}
                        onChange={e => setPipelineLimit(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="All"
                        className="w-14 text-sm font-semibold text-indigo-700 outline-none bg-transparent"
                      />
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">candidates</label>
                    </div>
                    <button
                      onClick={handleAutoAddAll}
                      disabled={isAutoAdding}
                      className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 shadow-md"
                    >
                      {isAutoAdding ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      {pipelineLimit ? `AI-Rank & Add Top ${pipelineLimit}` : 'Auto-Search & Add All'}
                    </button>
                  </div>
                )}
              </div>

              {!selectedJobId && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  Select or create a job pipeline first (Step 1) to enable sourcing.
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Search filters */}
                <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
                    <Search className="h-4 w-4 text-indigo-500" /> Search Filters
                  </h3>
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-500 block mb-1">Job Title</label>
                      <input type="text" value={searchTitle} onChange={e => setSearchTitle(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 block mb-1">Location</label>
                      <input type="text" value={searchLocation} onChange={e => setSearchLocation(e.target.value)}
                        placeholder="e.g. Bengaluru, India"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 block mb-1">Skills (comma separated)</label>
                      <input type="text" value={searchSkills} onChange={e => setSearchSkills(e.target.value)}
                        placeholder="React, Python, SQL"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 block mb-1">Min Experience (years)</label>
                      <input type="number" value={searchExp} onChange={e => setSearchExp(Number(e.target.value))}
                        min={0} max={20}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                    </div>
                    <button onClick={handleManualSearch} disabled={isSearching || !selectedJobId}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all">
                      {isSearching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      {isSearching ? 'Searching...' : 'Search Apollo'}
                    </button>
                  </div>

                  {/* Pipeline count */}
                  <div className="border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">In Pipeline:</span>
                      <span className="font-bold text-indigo-600">{candidates.length} candidates</span>
                    </div>
                    {candidates.length > 0 && (
                      <button onClick={() => setActiveTab('calls')}
                        className="mt-2 w-full text-xs text-indigo-600 font-semibold hover:underline flex items-center justify-center gap-1">
                        Go to Voice Campaigns <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Results */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                      Sourced Profiles
                      {isSearching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
                      {searchResults.length > 0 && <span className="text-slate-400 font-normal">({searchResults.length} results)</span>}
                    </h3>
                    {searchResults.length > 0 && searchResults[0]?.is_mock && (
                      <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-medium">Mock Data</span>
                    )}
                    {searchResults.length > 0 && !searchResults[0]?.is_mock && (
                      <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                        {searchResults[0]?.source === 'apollo' ? '⚡ Live Apollo Data' : searchResults[0]?.source === 'coresignal' ? '🔵 CoreSignal Data' : 'Live Data'}
                      </span>
                    )}
                  </div>

                  {searchResults.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
                      <Compass className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                      <p className="text-sm">Run a search or use "Auto-Search & Add All" to pull real candidates via Apollo.io</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {searchResults.map(cand => {
                        const isAdded = addedCandidateIds.includes(cand.id);
                        const phoneVal = cand.mobile_phone;
                        const emailVal = cand.work_email;
                        return (
                          <div key={cand.id} className={`bg-white rounded-xl border p-4 flex flex-col gap-3 shadow-sm transition-all duration-200 ${isAdded ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 hover:border-indigo-300 hover:shadow'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-slate-900 text-sm truncate">{cand.full_name}</h4>
                                <p className="text-xs text-slate-500 truncate">{cand.job_title} <span className="text-slate-700">@ {cand.job_company_name}</span></p>
                              </div>
                              {cand.linkedin_url && (
                                <a href={normalizeLinkedIn(cand.linkedin_url)} target="_blank" rel="noopener noreferrer"
                                  className="text-xs text-indigo-500 hover:text-indigo-700 flex-shrink-0">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-xs text-slate-500">
                              <MapPin className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{cand.location_name || '—'}</span>
                            </div>

                            {/* Contact info */}
                            <div className="text-xs flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <Phone className="h-3 w-3 text-slate-400" />
                                {phoneVal && !isMasked(phoneVal)
                                  ? <span className="text-slate-700 font-medium">{phoneVal}</span>
                                  : <span className="text-slate-400 italic">No phone available</span>}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Globe className="h-3 w-3 text-slate-400" />
                                {emailVal && !isMasked(emailVal)
                                  ? <span className="text-slate-700 truncate">{emailVal}</span>
                                  : <span className="text-slate-400 italic">No email available</span>}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1">
                              {(cand.skills || []).slice(0, 4).map((s: string, i: number) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{s}</span>
                              ))}
                              {(cand.skills || []).length > 4 && (
                                <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">+{cand.skills.length - 4}</span>
                              )}
                            </div>

                            <button
                              onClick={() => handleAddToPipeline(cand)}
                              disabled={isAdded}
                              className={`w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                                isAdded
                                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              }`}
                            >
                              {isAdded ? <><Check className="h-3.5 w-3.5" /> Added to Pipeline</> : 'Add to Pipeline'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Pipeline preview */}
              {candidates.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                      <Users className="h-4 w-4 text-indigo-500" /> Pipeline ({candidates.length})
                    </h3>
                    <button onClick={() => setActiveTab('calls')}
                      className="text-xs text-indigo-600 font-semibold flex items-center gap-1 hover:underline">
                      Proceed to Voice Campaigns <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {candidates.slice(0, 5).map(c => (
                      <div key={c.id} className="flex items-center justify-between text-sm py-2 border-b border-slate-50 last:border-0">
                        <div>
                          <span className="font-medium text-slate-800">{c.name}</span>
                          <span className="text-slate-500 ml-2 text-xs">{c.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={c.call_status} />
                          {c.call_status === 'NOT_STARTED' && (
                            <button onClick={() => handleRemoveCandidate(c.id)}
                              className="text-slate-300 hover:text-red-500 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {candidates.length > 5 && (
                      <p className="text-xs text-slate-400 text-center pt-1">+{candidates.length - 5} more candidates</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════ TAB 3: VOICE CAMPAIGNS ═══════════════════════ */}
          {activeTab === 'calls' && (
            <div className="max-w-6xl mx-auto flex flex-col gap-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Voice Call Campaigns</h2>
                <p className="text-sm text-slate-500 mt-1">Select a Hunar AI voice agent and launch bulk outbound screening calls</p>
              </div>

              {!selectedJobId && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  Select a job pipeline from the header dropdown first.
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left: Agent selection */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                  {/* Select agent */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                        <Bot className="h-4 w-4 text-indigo-500" /> Voice Agent
                      </h3>
                      <button onClick={fetchAgents} className="text-slate-400 hover:text-slate-600">
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoadingAgents ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    {isLoadingAgents ? (
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading agents...
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                        {agents.map(agent => (
                          <div
                            key={agent.id}
                            onClick={() => { setSelectedAgentId(agent.id); setEditingAgentId(null); setShowCreateAgent(false); }}
                            className={`p-3 rounded-xl border cursor-pointer transition-all duration-150 ${
                              selectedAgentId === agent.id
                                ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100'
                                : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {agent.logo ? (
                                <img src={agent.logo} alt="" className="h-7 w-7 rounded-full object-cover flex-shrink-0" />
                              ) : (
                                <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                                  <Mic className="h-3.5 w-3.5 text-indigo-600" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{agent.name}</p>
                                <p className="text-[10px] text-slate-500">{agent.voice_persona} · {agent.language}</p>
                              </div>
                              {selectedAgentId === agent.id && <Check className="h-4 w-4 text-indigo-600 flex-shrink-0" />}
                              {selectedAgentId === agent.id && (
                                <button
                                  onClick={e => { e.stopPropagation(); handleStartEditAgent(agent); }}
                                  title="Edit agent settings"
                                  className="p-1 rounded-lg hover:bg-indigo-200 text-indigo-600 transition-colors"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            {agent.summary && (
                              <p className="text-[10px] text-slate-400 mt-1.5 line-clamp-2">{agent.summary}</p>
                            )}
                            {agent.custom_variables && agent.custom_variables.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {agent.custom_variables.map((v, i) => (
                                  <span key={i} className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{`{${v}}`}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {agents.length === 0 && (
                          <p className="text-xs text-slate-400 text-center py-4">No agents found. Create one below.</p>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => { setShowCreateAgent(!showCreateAgent); setEditingAgentId(null); handlePreFillAgentFromJD(); }}
                      className="w-full py-2.5 border border-dashed border-indigo-300 text-indigo-600 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-all"
                    >
                      <Plus className="h-4 w-4" /> Create New Agent
                    </button>
                  </div>

                  {/* Bulk call launcher */}
                  <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 text-white shadow-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="h-5 w-5 text-yellow-300" />
                      <h3 className="font-bold text-sm">Launch Bulk Call Campaign</h3>
                    </div>
                    <p className="text-xs text-indigo-200 mb-4">
                      {notStarted > 0
                        ? `${notStarted} candidate${notStarted > 1 ? 's' : ''} in queue · agent: ${agents.find(a => a.id === selectedAgentId)?.name || 'None selected'}`
                        : 'No pending candidates — add some from Sourcing tab'}
                    </p>
                    <button
                      onClick={handleBulkCall}
                      disabled={isBulkCalling || !selectedAgentId || notStarted === 0}
                      className="w-full py-2.5 bg-white text-indigo-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-indigo-50 transition-all"
                    >
                      {isBulkCalling ? (
                        <><RefreshCw className="h-4 w-4 animate-spin" /> Launching...</>
                      ) : (
                        <><PhoneCall className="h-4 w-4" /> Start Campaign ({notStarted} calls)</>
                      )}
                    </button>
                    {bulkCallMsg && (
                      <p className="text-xs text-indigo-200 mt-2 text-center">{bulkCallMsg}</p>
                    )}
                  </div>
                </div>

                {/* Right: Create agent form + candidate queue */}
                <div className="lg:col-span-3 flex flex-col gap-4">
                  {/* Edit existing agent panel */}
                  {editingAgentId && (
                    <div className="bg-white rounded-2xl border border-amber-200 shadow-md p-5 flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                          <Edit3 className="h-4 w-4 text-amber-500" /> Edit Agent Settings
                          <span className="text-xs text-slate-400 font-normal">({agents.find(a => a.id === editingAgentId)?.name})</span>
                        </h3>
                        <button onClick={() => setEditingAgentId(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                      </div>

                      {/* Tabs: Script | Guardrails */}
                      <>
                        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                          <button onClick={() => setEditTab('script')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              editTab === 'script' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}>
                            <Mic className="h-3 w-3 inline mr-1" />Script & Voice
                          </button>
                          <button onClick={() => setEditTab('guardrails')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              editTab === 'guardrails' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}>
                            <Shield className="h-3 w-3 inline mr-1" />Guardrails & Limits
                          </button>
                        </div>

                            {editTab === 'script' && (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Agent Name</label>
                                  <input value={editAgentForm.name || ''} onChange={e => setEditAgentForm({...editAgentForm, name: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Voice Persona</label>
                                  <select value={editAgentForm.voice_persona || 'NEHA'} onChange={e => setEditAgentForm({...editAgentForm, voice_persona: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400">
                                    {['NEHA', 'ROY', 'PRIYA', 'ARJUN', 'ANANYA', 'RAVI'].map(v => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Persona Name</label>
                                  <input value={editAgentForm.persona_name || ''} onChange={e => setEditAgentForm({...editAgentForm, persona_name: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Language</label>
                                  <select value={editAgentForm.language || 'ENGLISH'} onChange={e => setEditAgentForm({...editAgentForm, language: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400">
                                    {['ENGLISH', 'HINDI', 'HINGLISH'].map(l => <option key={l}>{l}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Silence Response</label>
                                  <input value={editAgentForm.silence_response || ''} onChange={e => setEditAgentForm({...editAgentForm, silence_response: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Introduction Script</label>
                                  <textarea value={editAgentForm.introduction || ''} onChange={e => setEditAgentForm({...editAgentForm, introduction: e.target.value})}
                                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 resize-none" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Agent Prompt</label>
                                  <textarea value={editAgentForm.agent_prompt || ''} onChange={e => setEditAgentForm({...editAgentForm, agent_prompt: e.target.value})}
                                    rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 resize-none" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Objective</label>
                                  <textarea value={editAgentForm.objective || ''} onChange={e => setEditAgentForm({...editAgentForm, objective: e.target.value})}
                                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 resize-none" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Result Prompt</label>
                                  <textarea value={editAgentForm.result_prompt || ''} onChange={e => setEditAgentForm({...editAgentForm, result_prompt: e.target.value})}
                                    rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 resize-none" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Conclusion</label>
                                  <input value={editAgentForm.conclusion || ''} onChange={e => setEditAgentForm({...editAgentForm, conclusion: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Custom Variables (comma-sep)</label>
                                  <input value={editAgentForm.custom_variables || ''} onChange={e => setEditAgentForm({...editAgentForm, custom_variables: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Result Fields (comma-sep)</label>
                                  <input value={editAgentForm.result_schema_keys || ''} onChange={e => setEditAgentForm({...editAgentForm, result_schema_keys: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                              </div>
                            )}

                            {editTab === 'guardrails' && (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                  <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-2">⚠️ Guardrails and call limits are sent to Hunar. Support for specific fields depends on your Hunar plan.</p>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Max Call Duration (seconds)</label>
                                  <input type="number" value={editAgentForm.max_call_duration_seconds || ''} onChange={e => setEditAgentForm({...editAgentForm, max_call_duration_seconds: Number(e.target.value)})}
                                    placeholder="300" min={30} max={1800}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Max Retries (no-answer)</label>
                                  <input type="number" value={editAgentForm.max_retries ?? ''} onChange={e => setEditAgentForm({...editAgentForm, max_retries: Number(e.target.value)})}
                                    placeholder="2" min={0} max={10}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Retry Delay (seconds)</label>
                                  <input type="number" value={editAgentForm.retry_delay_seconds || ''} onChange={e => setEditAgentForm({...editAgentForm, retry_delay_seconds: Number(e.target.value)})}
                                    placeholder="60" min={10}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Calling Hours (Start)</label>
                                  <input type="time" value={editAgentForm.calling_hours_start || '09:00'} onChange={e => setEditAgentForm({...editAgentForm, calling_hours_start: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Calling Hours (End)</label>
                                  <input type="time" value={editAgentForm.calling_hours_end || '18:00'} onChange={e => setEditAgentForm({...editAgentForm, calling_hours_end: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Do-Not-Discuss Topics (comma-sep guardrails)</label>
                                  <input value={editAgentForm.do_not_call_topics || ''} onChange={e => setEditAgentForm({...editAgentForm, do_not_call_topics: e.target.value})}
                                    placeholder="salary negotiation, personal questions, competitor details"
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400" />
                                </div>
                              </div>
                            )}
                      </>

                      <button onClick={handleSaveAgent} disabled={isSavingAgent}
                        className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 shadow-md hover:from-amber-600 hover:to-orange-600 transition-all">
                        {isSavingAgent ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving...</> : <><Save className="h-4 w-4" /> Save Agent Changes</>}
                      </button>
                    </div>
                  )}

                  {/* Create agent form */}
                  {showCreateAgent && (
                    <div className="bg-white rounded-2xl border border-indigo-200 shadow-md p-5 flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                          <Plus className="h-4 w-4 text-indigo-500" /> Create New Hunar Agent
                        </h3>
                        <button onClick={() => setShowCreateAgent(false)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                      </div>

                      {/* Tabs: Script | Guardrails */}
                      <>
                        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                          <button onClick={() => setCreateTab('script')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              createTab === 'script' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}>
                            <Mic className="h-3 w-3 inline mr-1" />Script & Voice
                          </button>
                          <button onClick={() => setCreateTab('guardrails')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              createTab === 'guardrails' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}>
                            <Shield className="h-3 w-3 inline mr-1" />Guardrails & Limits
                          </button>
                        </div>

                            {createTab === 'script' && (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Agent Name</label>
                                  <input value={agentForm.name} onChange={e => setAgentForm({...agentForm, name: e.target.value})}
                                    placeholder="e.g. Screening: Senior React Engineer"
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Voice Persona</label>
                                  <select value={agentForm.voice_persona} onChange={e => setAgentForm({...agentForm, voice_persona: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400">
                                    {['NEHA', 'ROY', 'PRIYA', 'ARJUN', 'ANANYA', 'RAVI'].map(v => <option key={v}>{v}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Persona Name</label>
                                  <input value={agentForm.persona_name} onChange={e => setAgentForm({...agentForm, persona_name: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Language</label>
                                  <select value={agentForm.language} onChange={e => setAgentForm({...agentForm, language: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400">
                                    {['ENGLISH', 'HINDI', 'HINGLISH'].map(l => <option key={l}>{l}</option>)}
                                  </select>
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Introduction Script</label>
                                  <textarea value={agentForm.introduction} onChange={e => setAgentForm({...agentForm, introduction: e.target.value})}
                                    rows={2} placeholder="Hi! This is {persona_name} calling about a {job_title} opportunity..."
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 resize-none" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Agent Prompt</label>
                                  <textarea value={agentForm.agent_prompt} onChange={e => setAgentForm({...agentForm, agent_prompt: e.target.value})}
                                    rows={3} placeholder="You are {persona_name}, a professional AI recruiting assistant..."
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 resize-none" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Objective</label>
                                  <textarea value={agentForm.objective} onChange={e => setAgentForm({...agentForm, objective: e.target.value})}
                                    rows={2} placeholder="Screen the candidate for the {job_title} role..."
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 resize-none" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Result Prompt (what data to extract)</label>
                                  <textarea value={agentForm.result_prompt} onChange={e => setAgentForm({...agentForm, result_prompt: e.target.value})}
                                    rows={2} placeholder="Extract: interested (Yes/No), notice_period, expected_ctc, years_of_experience, summary"
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 resize-none" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Custom Variables (comma-sep)</label>
                                  <input value={agentForm.custom_variables} onChange={e => setAgentForm({...agentForm, custom_variables: e.target.value})}
                                    placeholder="callee_name,job_title,company,jd_summary"
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Result Fields (comma-sep)</label>
                                  <input value={agentForm.result_schema_keys} onChange={e => setAgentForm({...agentForm, result_schema_keys: e.target.value})}
                                    placeholder="interested,notice_period,expected_ctc,summary"
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Silence Response</label>
                                  <input value={agentForm.silence_response} onChange={e => setAgentForm({...agentForm, silence_response: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Conclusion</label>
                                  <input value={agentForm.conclusion} onChange={e => setAgentForm({...agentForm, conclusion: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                              </div>
                            )}

                            {createTab === 'guardrails' && (
                              <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                  <p className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg p-2">ℹ️ Guardrails and call limits are sent to Hunar. Support for specific fields depends on your Hunar plan.</p>
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Max Call Duration (seconds)</label>
                                  <input type="number" value={agentForm.max_call_duration_seconds} onChange={e => setAgentForm({...agentForm, max_call_duration_seconds: Number(e.target.value)})}
                                    placeholder="300" min={30} max={1800}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Max Retries (no-answer)</label>
                                  <input type="number" value={agentForm.max_retries} onChange={e => setAgentForm({...agentForm, max_retries: Number(e.target.value)})}
                                    placeholder="2" min={0} max={10}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Retry Delay (seconds)</label>
                                  <input type="number" value={agentForm.retry_delay_seconds} onChange={e => setAgentForm({...agentForm, retry_delay_seconds: Number(e.target.value)})}
                                    placeholder="60" min={10}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Calling Hours (Start)</label>
                                  <input type="time" value={agentForm.calling_hours_start} onChange={e => setAgentForm({...agentForm, calling_hours_start: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div>
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Calling Hours (End)</label>
                                  <input type="time" value={agentForm.calling_hours_end} onChange={e => setAgentForm({...agentForm, calling_hours_end: e.target.value})}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-xs font-medium text-slate-500 block mb-1">Do-Not-Discuss Topics (comma-sep guardrails)</label>
                                  <input value={agentForm.do_not_call_topics} onChange={e => setAgentForm({...agentForm, do_not_call_topics: e.target.value})}
                                    placeholder="salary negotiation, personal questions, competitor details"
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                                </div>
                              </div>
                            )}
                      </>

                      <button onClick={handleCreateAgent} disabled={isCreatingAgent || !agentForm.name || !agentForm.agent_prompt}
                        className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 shadow-md hover:from-indigo-700 hover:to-purple-700 transition-all">
                        {isCreatingAgent ? <><RefreshCw className="h-4 w-4 animate-spin" /> Creating Agent...</> : <><Bot className="h-4 w-4" /> Create Agent in Hunar</>}
                      </button>
                    </div>
                  )}

                  {/* Candidate queue */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
                    <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                      <Users className="h-4 w-4 text-indigo-500" /> Candidate Queue ({candidates.length})
                    </h3>

                    {candidates.length === 0 ? (
                      <div className="text-center py-8 text-slate-400">
                        <Users className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        <p className="text-sm">No candidates yet — source them in Step 2</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
                        {candidates.map(cand => (
                          <div key={cand.id} className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-all">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-800 text-sm truncate">{cand.name}</span>
                                <StatusBadge status={cand.call_status} />
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <p className="text-xs text-slate-500 truncate">{cand.title}</p>
                                <span className="text-slate-300">•</span>
                                {cand.call_status === 'NOT_STARTED' ? (
                                  <input 
                                    type="text"
                                    value={phoneOverrides[cand.id] !== undefined ? phoneOverrides[cand.id] : cand.phone}
                                    onChange={e => setPhoneOverrides({...phoneOverrides, [cand.id]: e.target.value})}
                                    placeholder="Enter real phone number"
                                    className="text-xs bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:border-indigo-400 w-32"
                                  />
                                ) : (
                                  <p className="text-xs text-slate-500 truncate">{cand.phone}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {cand.recording_url && (
                                <a href={cand.recording_url} target="_blank" rel="noopener noreferrer"
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
                                  <Play className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {cand.call_status === 'NOT_STARTED' && (
                                <>
                                  {config?.hunar_configured && selectedAgentId && (
                                    <button onClick={async () => {
                                      try {
                                        // Save phone override if changed
                                        const phoneToUse = phoneOverrides[cand.id] !== undefined ? phoneOverrides[cand.id] : cand.phone;
                                        if (phoneToUse !== cand.phone) {
                                          await fetch(`${API_BASE}/candidates/${cand.id}`, {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ phone: phoneToUse })
                                          });
                                        }

                                        await fetch(`${API_BASE}/candidates/reachout`, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ candidate_id: cand.id, agent_id: selectedAgentId, phone_override: phoneToUse })
                                        });
                                        fetchCandidates(selectedJobId);
                                      } catch(e) {}
                                    }}
                                      className="p-1.5 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-xs font-semibold">
                                      <Phone className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <button onClick={() => handleSimulateOne(cand.id)}
                                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                                    title="Simulate Call">
                                    <Sparkles className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => handleRemoveCandidate(cand.id)}
                                    className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              {cand.call_status === 'COMPLETED' && cand.evaluation?.overall_score != null && (
                                <button
                                  onClick={() => { setActiveCandidateDetail(cand); setActiveTab('dashboard'); }}
                                  className="px-2.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold">
                                  {cand.evaluation.overall_score}/100
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════ TAB 4: DASHBOARD ═══════════════════════ */}
          {activeTab === 'dashboard' && (
            <div className="max-w-6xl mx-auto flex flex-col gap-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Review candidates and decide what happens next</h2>
                <p className="text-sm text-slate-500 mt-1">Open a candidate, review the screening evidence, and complete their next hiring step.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                {[
                  { step: '1', title: 'Choose a candidate', text: 'Open a profile from the ranked list to see their screening call and fit scores.' },
                  { step: '2', title: 'Make a decision', text: 'Move them to interview, keep them on hold, or close their process.' },
                  { step: '3', title: 'Complete the next task', text: 'Prepare a message, schedule a follow-up, collect feedback, or track an offer.' },
                ].map(item => <div key={item.step} className="flex gap-3 rounded-xl bg-white/80 p-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{item.step}</span>
                  <div><p className="text-sm font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.text}</p></div>
                </div>)}
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Pipeline', val: candidates.length, icon: Users, color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200' },
                  { label: 'Calls Completed', val: completed, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
                  { label: 'Active Calls', val: activeCalls, icon: PhoneCall, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
                  { label: 'Shortlisted', val: shortlisted, icon: Star, color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-200' },
                ].map(stat => (
                  <div key={stat.label} className={`${stat.bg} border rounded-xl p-4 flex flex-col gap-2`}>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    <div className={`text-2xl font-extrabold ${stat.color}`}>{stat.val}</div>
                    <div className="text-xs text-slate-500">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-sm text-slate-800">Compare or update several candidates</h3>
                      <p className="text-xs text-slate-500 mt-1">{compareIds.length ? `${compareIds.length} candidates selected. Compare their fit below or update them together.` : 'Tick up to three candidates in the list to compare them or update them together.'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={isSavingWorkflow} onClick={() => handleBulkStage('INTERVIEW')} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">Move to interview</button>
                      <button disabled={isSavingWorkflow} onClick={() => handleBulkStage('ON_HOLD')} className="px-3 py-2 rounded-lg border border-amber-200 text-amber-700 text-xs font-bold disabled:opacity-50">Keep on hold</button>
                      <button disabled={isSavingWorkflow} onClick={() => handleBulkStage('DECLINED')} className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-bold disabled:opacity-50">Close process</button>
                    </div>
                  </div>
                  {compareIds.length >= 2 && (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {candidates.filter(candidate => compareIds.includes(candidate.id)).slice(0, 3).map(candidate => (
                        <div key={candidate.id} className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs">
                          <p className="font-bold text-slate-800">{candidate.name}</p>
                          <p className="text-slate-500 mt-1">{candidate.evaluation.overall_score ?? '—'}/100 · {candidate.stage ?? 'SCREENED'}</p>
                          <p className="text-slate-500">Technical: {candidate.evaluation.technical_score ?? '—'} · Experience: {candidate.evaluation.experience_score ?? '—'} · Notice period: {candidate.answers?.notice_period ?? '—'} days</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-800"><CalendarDays className="h-4 w-4" /><h3 className="font-bold text-sm">Tasks that need attention</h3></div>
                  <p className="text-2xl font-extrabold text-amber-700 mt-2">{analytics?.overdue_follow_ups.length ?? 0}</p>
                  <p className="text-xs text-amber-700">follow-ups are overdue</p>
                  {analytics?.overdue_follow_ups.slice(0, 2).map(candidate => <button key={candidate.id} onClick={() => setActiveCandidateDetail(candidate)} className="block text-xs font-semibold text-amber-900 mt-2 hover:underline">{candidate.name}</button>)}
                  <p className="text-[11px] text-amber-700 mt-2">Shortlist conversion: {analytics?.shortlist_rate ?? 0}%</p>
                  <p className="text-[11px] text-amber-700 mt-1">Calls completed: {analytics?.call_completion_rate ?? 0}% · Average time in a step: {analytics?.average_stage_age_hours ?? 0}h</p>
                  {analytics && Object.keys(analytics.decline_reasons).length > 0 && <p className="text-[11px] text-amber-700 mt-1 truncate" title={Object.keys(analytics.decline_reasons)[0]}>Most common reason not to proceed: {Object.keys(analytics.decline_reasons)[0]}</p>}
                </div>
              </div>

              {candidates.filter(c => c.evaluation?.overall_score !== undefined).length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                  <BarChart3 className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                  <p className="text-sm">No evaluated candidates yet — run calls or simulations in Step 3</p>
                  <button onClick={() => setActiveTab('calls')}
                    className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold">
                    Go to Voice Campaigns
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {/* Ranked list */}
                  <div className="lg:col-span-2 flex flex-col gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-800 text-sm">1. Choose a candidate to review</h3>
                      <p className="mt-1 text-xs text-slate-500">Higher fit scores appear first. Tick the checkbox only when you want to compare candidates or take the same action for several people.</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {candidates
                        .filter(c => c.evaluation?.overall_score !== undefined)
                        .sort((a, b) => (b.evaluation.overall_score || 0) - (a.evaluation.overall_score || 0))
                        .map((cand, rank) => {
                          const isSelected = activeCandidateDetail?.id === cand.id;
                          const decision = decisionCopy(cand.evaluation.decision, cand.evaluation.recommendation);
                          return (
                            <div
                              key={cand.id}
                              onClick={() => setActiveCandidateDetail(cand)}
                              className={`bg-white rounded-xl p-4 cursor-pointer transition-all duration-200 shadow-sm ${
                                isSelected ? 'border-2 border-indigo-500 bg-indigo-50/30' : 'border border-slate-200 hover:border-indigo-300'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <input type="checkbox" checked={compareIds.includes(cand.id)}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => setCompareIds(previous => event.target.checked ? [...previous, cand.id].slice(0, 3) : previous.filter(id => id !== cand.id))}
                                  aria-label={`Select ${cand.name} for comparison`}
                                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600" />
                                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 ${
                                  rank === 0 ? 'bg-yellow-100 text-yellow-700' :
                                  rank === 1 ? 'bg-slate-100 text-slate-600' :
                                  rank === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-50 text-slate-500'
                                }`}>
                                  #{rank + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h5 className="font-bold text-slate-900 text-sm truncate">{cand.name}</h5>
                                  <p className="text-xs text-slate-500 truncate">{cand.title}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <span className="text-base font-extrabold text-indigo-600">{cand.evaluation.overall_score}</span>
                                  <span className="text-xs text-slate-400">/100</span>
                                  <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-1 border ${decision.className}`}>
                                    {decision.label}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Detail panel */}
                  <div className="lg:col-span-3">
                    {activeCandidateDetail ? (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col gap-5 sticky top-6">
                        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                          <div>
                            <h4 className="font-extrabold text-lg text-slate-900">{activeCandidateDetail.name}</h4>
                            <p className="text-xs text-slate-500 mt-0.5">{activeCandidateDetail.title} · {activeCandidateDetail.company}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{activeCandidateDetail.phone}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-3xl font-extrabold text-indigo-600">{activeCandidateDetail.evaluation.overall_score}</div>
                            <div className="text-xs text-slate-400">/ 100</div>
                            <span className={`text-xs font-bold px-3 py-1 rounded-xl border mt-1 inline-block ${decisionCopy(activeCandidateDetail.evaluation.decision, activeCandidateDetail.evaluation.recommendation).className}`}>
                              {decisionCopy(activeCandidateDetail.evaluation.decision, activeCandidateDetail.evaluation.recommendation).label}
                            </span>
                          </div>
                        </div>

                        {/* Score bars */}
                        <div className="flex flex-col gap-3">
                          <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider">How the screening call matched this role</h5>
                          {[
                            { label: 'Technical', val: activeCandidateDetail.evaluation.technical_score, color: 'bg-indigo-500' },
                            { label: 'Communication', val: activeCandidateDetail.evaluation.communication_score, color: 'bg-purple-500' },
                            { label: 'Experience', val: activeCandidateDetail.evaluation.experience_score, color: 'bg-emerald-500' },
                            { label: 'Requirements Match', val: activeCandidateDetail.evaluation.requirements_score, color: 'bg-teal-500' },
                          ].map(m => (
                            <div key={m.label} className="flex flex-col gap-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-slate-600">{m.label}</span>
                                <span className="font-semibold text-slate-800">{m.val ?? '—'}%</span>
                              </div>
                              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${m.color} rounded-full transition-all duration-500`} style={{ width: `${m.val || 0}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Recruiter action hub */}
                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 flex flex-col gap-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h5 className="text-xs font-bold text-indigo-700 uppercase tracking-wider">2. Choose the candidate's next step</h5>
                              <p className="text-xs text-slate-500 mt-1">Current step: {readableLabel(activeCandidateDetail.stage)}{activeCandidateDetail.evaluation.confidence ? ` · Screening confidence: ${activeCandidateDetail.evaluation.confidence.toLowerCase()}` : ''}</p>
                            </div>
                            <ClipboardList className="h-5 w-5 text-indigo-500" />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: 'Move to interview', stage: 'INTERVIEW', style: 'bg-indigo-600 text-white hover:bg-indigo-700' },
                              { label: 'Keep on hold', stage: 'ON_HOLD', style: 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-50' },
                              { label: 'Close process', stage: 'DECLINED', style: 'bg-white text-red-600 border border-red-200 hover:bg-red-50' },
                            ].map(action => (
                              <button key={action.stage} disabled={isSavingWorkflow}
                                onClick={() => updateCandidateWorkflow(activeCandidateDetail.id, { stage: action.stage })}
                                className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${action.style}`}>
                                {action.label}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="text-xs text-slate-600 flex flex-col gap-1.5">
                              <span className="font-semibold"><CalendarDays className="h-3.5 w-3.5 inline mr-1" />Set a reminder to follow up</span>
                              <input type="datetime-local" defaultValue={activeCandidateDetail.follow_up_at?.slice(0, 16) ?? ''}
                                onBlur={(event) => updateCandidateWorkflow(activeCandidateDetail.id, {
                                  follow_up_at: event.target.value,
                                  follow_up_status: event.target.value ? 'SCHEDULED' : 'NOT_SCHEDULED',
                                })}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-700 outline-none focus:border-indigo-400" />
                            </label>
                            <label className="text-xs text-slate-600 flex flex-col gap-1.5">
                              <span className="font-semibold">Private recruiter notes</span>
                              <textarea rows={2} defaultValue={activeCandidateDetail.recruiter_notes ?? ''}
                                onBlur={(event) => updateCandidateWorkflow(activeCandidateDetail.id, { recruiter_notes: event.target.value })}
                                placeholder="Decision context, owner, or callback details"
                                className="resize-none rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-700 outline-none focus:border-indigo-400" />
                            </label>
                          </div>
                          {(activeCandidateDetail.evaluation.strengths?.length || activeCandidateDetail.evaluation.risks?.length || activeCandidateDetail.evaluation.interview_focus?.length) && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                              {[
                                { label: 'Why this candidate may be a fit', values: activeCandidateDetail.evaluation.strengths, color: 'text-emerald-700' },
                                { label: 'What to confirm before proceeding', values: activeCandidateDetail.evaluation.risks, color: 'text-amber-700' },
                                { label: 'Questions for the next interview', values: activeCandidateDetail.evaluation.interview_focus, color: 'text-indigo-700' },
                              ].map(group => group.values?.length ? (
                                <div key={group.label} className="rounded-lg bg-white/80 p-3 border border-white">
                                  <p className={`font-bold mb-1.5 ${group.color}`}>{group.label}</p>
                                  {group.values.map((value, index) => <p key={index} className="text-slate-600 leading-relaxed">{value}</p>)}
                                </div>
                              ) : null)}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
                            <div className="flex items-center justify-between"><h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider"><Mail className="h-3.5 w-3.5 inline mr-1" />3. Prepare candidate communication</h5><button onClick={copyHandoff} className="text-xs font-bold text-indigo-600"><Copy className="h-3.5 w-3.5 inline mr-1" />Copy hiring-manager summary</button></div>
                            <p className="text-xs text-slate-500">Choose a template, review the draft, then copy it into your email or WhatsApp tool. Nothing is sent automatically.</p>
                            <div className="flex flex-wrap gap-2">
                              {[['INTERVIEW_INVITE', 'Draft interview invite'], ['FOLLOW_UP', 'Draft follow-up'], ['ON_HOLD', 'Draft hold update'], ['DECLINE', 'Draft closure message']].map(([type, label]) => <button key={type} onClick={() => prepareOutreach(type)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-indigo-300">{label}</button>)}
                            </div>
                            {outreachMessage && <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 leading-relaxed"><p>{outreachMessage}</p><button onClick={() => navigator.clipboard.writeText(outreachMessage)} className="mt-2 font-bold text-indigo-600">Copy message</button></div>}
                            <div className="grid grid-cols-2 gap-2">
                              <select aria-label="Candidate contact permission" value={activeCandidateDetail.consent_status ?? 'CONTACT_ALLOWED'} onChange={(event) => updateCandidateWorkflow(activeCandidateDetail.id, { consent_status: event.target.value })} className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-600">
                                <option value="CONTACT_ALLOWED">Okay to contact</option><option value="DO_NOT_CONTACT">Do not contact</option>
                              </select>
                              <input defaultValue={activeCandidateDetail.preferred_contact_time ?? ''} onBlur={(event) => updateCandidateWorkflow(activeCandidateDetail.id, { preferred_contact_time: event.target.value })} placeholder="Preferred hours" className="rounded-lg border border-slate-200 px-2 py-2 text-xs" />
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
                            <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider"><ShieldCheck className="h-3.5 w-3.5 inline mr-1" />4. Track the offer</h5>
                            <p className="text-xs text-slate-500">Use this only after deciding to make an offer. Record its status, value, and expected joining date.</p>
                            <div className="grid grid-cols-2 gap-2">
                              <select value={activeCandidateDetail.offer?.status ?? 'NOT_STARTED'} onChange={(event) => updateCandidateWorkflow(activeCandidateDetail.id, { offer: { ...(activeCandidateDetail.offer ?? {}), status: event.target.value } })} className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-600">
                                {['NOT_STARTED', 'DRAFTING', 'SENT', 'NEGOTIATING', 'ACCEPTED', 'DECLINED'].map(status => <option key={status}>{status}</option>)}
                              </select>
                              <input defaultValue={activeCandidateDetail.offer?.amount ?? ''} onBlur={(event) => updateCandidateWorkflow(activeCandidateDetail.id, { offer: { ...(activeCandidateDetail.offer ?? {}), amount: event.target.value } })} placeholder="Offer amount" className="rounded-lg border border-slate-200 px-2 py-2 text-xs" />
                            </div>
                            <input type="date" defaultValue={activeCandidateDetail.offer?.joining_date ?? ''} onBlur={(event) => updateCandidateWorkflow(activeCandidateDetail.id, { offer: { ...(activeCandidateDetail.offer ?? {}), joining_date: event.target.value } })} className="rounded-lg border border-slate-200 px-2 py-2 text-xs" />
                            <p className="text-xs text-slate-400">This is an internal tracker. It does not send an offer to the candidate.</p>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
                          <div className="flex items-center justify-between"><h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider"><ClipboardCheck className="h-3.5 w-3.5 inline mr-1" />After the interview: collect feedback</h5><span className="text-xs text-slate-400">{activeCandidateDetail.interview_feedback?.length ?? 0} submitted</span></div>
                          <p className="text-xs text-slate-500">Each interviewer can record a recommendation, a 1-5 score, and evidence for their decision.</p>
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <input value={feedbackForm.interviewer} onChange={(event) => setFeedbackForm(previous => ({ ...previous, interviewer: event.target.value }))} placeholder="Interviewer name" className="rounded-lg border border-slate-200 px-2 py-2 text-xs" />
                            <select value={feedbackForm.recommendation} onChange={(event) => setFeedbackForm(previous => ({ ...previous, recommendation: event.target.value }))} className="rounded-lg border border-slate-200 px-2 py-2 text-xs"><option>STRONG_HIRE</option><option>HIRE</option><option>NO_HIRE</option></select>
                            <select value={feedbackForm.score} onChange={(event) => setFeedbackForm(previous => ({ ...previous, score: event.target.value }))} className="rounded-lg border border-slate-200 px-2 py-2 text-xs">{[5, 4, 3, 2, 1].map(score => <option key={score} value={score}>{score}/5</option>)}</select>
                            <button onClick={addInterviewFeedback} className="rounded-lg bg-slate-800 px-2 py-2 text-xs font-bold text-white">Save interview feedback</button>
                          </div>
                          <textarea value={feedbackForm.notes} onChange={(event) => setFeedbackForm(previous => ({ ...previous, notes: event.target.value }))} rows={2} placeholder="Evidence, concerns, and recommended next step" className="resize-none rounded-lg border border-slate-200 px-2 py-2 text-xs" />
                          {activeCandidateDetail.interview_feedback?.slice(-2).reverse().map((feedback, index) => <div key={`${feedback.created_at}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><span className="font-bold text-slate-800">{feedback.interviewer}</span> · {feedback.recommendation} · {feedback.score ?? '—'}/5 {feedback.notes ? `— ${feedback.notes}` : ''}</div>)}
                        </div>

                        {/* Call answers */}
                        {Object.keys(activeCandidateDetail.answers).length > 0 && (
                          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
                            <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">What the candidate said in the screening call</h5>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              {Object.entries(activeCandidateDetail.answers).map(([key, val]) => (
                                <div key={key}>
                                  <span className="text-slate-400 block capitalize">{key.replace(/_/g, ' ')}</span>
                                  <span className="text-slate-900 font-semibold">{String(val)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Justification */}
                        {activeCandidateDetail.evaluation.justification && (
                          <div className="flex flex-col gap-2">
                            <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Why the system made this recommendation</h5>
                            <p className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl p-4 leading-relaxed">
                              {activeCandidateDetail.evaluation.justification}
                            </p>
                          </div>
                        )}

                        {/* Recording */}
                        {activeCandidateDetail.recording_url && (
                          <a href={activeCandidateDetail.recording_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-indigo-600 font-semibold hover:underline">
                            <Play className="h-4 w-4" /> Listen to Call Recording
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400 h-full flex flex-col items-center justify-center">
                        <BarChart3 className="h-10 w-10 text-slate-300 mb-3" />
                        <p className="text-sm">Click a candidate on the left to see their evaluation details</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
