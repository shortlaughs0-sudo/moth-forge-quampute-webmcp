'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

const buildTypes = ['Character', 'Scenario', 'Cast', 'World', 'Hybrid'] as const;
const railSteps = [
  ['01', 'Spark', 'Concept kernel'],
  ['02', 'Sources', 'Evidence & canon'],
  ['03', 'Locks', 'What stays yours'],
  ['04', 'Quampute', 'FRAME → MODEL → PEOPLE'],
  ['05', 'Review', 'Known, derived, reserved'],
  ['06', 'Export', 'Reviewable package'],
] as const;
const statuses = ['all', 'confirmed', 'derived', 'adapted', 'reserved', 'not_applicable'] as const;

type BuildType = (typeof buildTypes)[number];
type Step = 0 | 1 | 2 | 3 | 4 | 5;
type Status = (typeof statuses)[number];

type ForgeAnchor = {
  documentId: string;
  revisionId: string;
  manifestHash: string;
  expectedTabCount: number;
  verifiedTabCount: number;
  totalCharacters: number;
  verifiedAt: string;
  status: 'verified' | 'partial';
  traversal: string[];
};

type Project = {
  id: string;
  title: string;
  buildType: string;
  concept: string;
  status: string;
  revision: number;
  locksRevision: number;
  forgeRevisionId: string;
  playerBoundary: string;
  contentBoundary: string;
  locks: string[];
  answers: unknown[];
  result: QuamputeResult | null;
  qa: Record<string, unknown> | null;
  researchEnabled: boolean;
  researchCostApproved: boolean;
  updatedAt: string;
};

type ProjectSummary = Pick<Project,
  'id' | 'title' | 'buildType' | 'status' | 'revision' | 'locksRevision' | 'forgeRevisionId' | 'updatedAt'>;

type Source = {
  id: string;
  name: string;
  kind: string;
  role: string;
  authority: string;
  visibility: string;
  uri: string | null;
  hasStoredFile: boolean;
  textCharacters: number;
  contentHash: string;
  readStatus: string;
  coverageState: string;
};

type RunReceipt = {
  id: string;
  status: string;
  traceId: string | null;
  projectRevision: number;
  locksRevision: number;
  researchEnabled: boolean;
  forgeRevisionId: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type Resolution = {
  resolutionId: string;
  category: string;
  status: 'confirmed' | 'derived' | 'adapted' | 'reserved' | 'not_applicable';
  statement: string;
  justification: string;
  evidenceRefs: string[];
  adaptationBridge: string | null;
  sceneSafeBoundary: string | null;
  dependencies: string[];
  compilationTargets: string[];
  surfaces: string[];
  knowledgeAccess: Array<{ holder: string; access: string; carrier: string | null }>;
};

type CreatorQuestion = {
  questionId: string;
  factBeingDetermined: string;
  meaning: string;
  whyCreatorMustAnswer: string;
  requiredAnswerShape: string[];
  affectedDependencies: string[];
  blocking: boolean;
};

type QuamputeResult = {
  schemaVersion: string;
  runId: string;
  inputSnapshot: {
    forge: { verifiedTabCount: number; expectedTabCount: number; revisionId: string };
  };
  conceptKernel: { concisePremise: string; creatorIntentKnown: string[]; unresolvedScope: string[] };
  sourceAssessment: { conflicts: Array<{ conflictId: string; claim: string; blocking: boolean }>; unreadSources: string[]; promptInjectionDetected: boolean };
  resolutions: Resolution[];
  questions: CreatorQuestion[];
  research: Array<{ researchId: string; title: string; url: string; claimSupported: string; limitation: string }>;
  propagationPlan: Array<{ resolutionId: string; destination: string; transformation: string; status: string }>;
  qa: {
    runStatus: string;
    projectCompletion: string;
    releaseEligible: boolean;
    coverage: {
      expectedTabs: number;
      representedTabs?: number;
      consideredTabs?: number;
      fullyEvaluatedTabs?: number;
      includedCharacters?: number;
      totalCharacters?: number;
      coverageMode?: 'sampled_prepass';
      questionInventory?: { expected: number; routed: number };
      applicableAreas: string[];
      evaluatedAreas: string[];
    };
    gates: Array<{ gate: string; status: string; evidence: string }>;
    blockers: string[];
  };
  nextAction: { kind: string; explanation: string };
};

type Session = {
  owner: { displayName: string; email: string | null; local: boolean };
  forge: ForgeAnchor;
  engine: { configured: boolean; demoMode?: boolean; paidExecutionDisabled?: boolean; model: string; researchDefault: boolean; externalProcessing: string };
  projects: ProjectSummary[];
  projectsCursor: string | null;
};

type ApiFailure = {
  error?: {
    code?: string;
    message?: string;
    preserveIdempotencyKey?: boolean;
    traceId?: string;
    runId?: string;
  };
};

type WebMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
};

type WebMcpModelContext = {
  registerTool: (tool: WebMcpToolDefinition) => void | Promise<void>;
  unregisterTool?: (name: string) => void | Promise<void>;
};

type AgentActivity = {
  id: string;
  name: string;
  summary: string;
  kind: 'read' | 'write' | 'handoff';
  at: string;
};

const forgeSiteToolNames = [
  'inspect_forge_studio',
  'list_forge_projects',
  'set_forge_spark',
  'create_forge_project',
  'open_completed_forge_demo',
  'open_forge_project',
  'add_forge_text_source',
  'update_forge_creator_locks',
  'inspect_forge_review',
  'stage_forge_question_answer',
  'navigate_forge_stage',
  'prepare_forge_run',
  'get_forge_export_links',
] as const;

export default function ForgeStudio({ displayName }: { displayName: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [buildType, setBuildType] = useState<BuildType>('Character');
  const [concept, setConcept] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<RunReceipt[]>([]);
  const [locksText, setLocksText] = useState('');
  const [playerBoundary, setPlayerBoundary] = useState('Do not supply actions, inner states, speech, appearance, or permission on behalf of the participant.');
  const [contentBoundary, setContentBoundary] = useState('general');
  const [researchEnabled, setResearchEnabled] = useState(false);
  const [researchApproved, setResearchApproved] = useState(false);
  const [sourceMode, setSourceMode] = useState<'text' | 'url' | 'file'>('text');
  const [sourceName, setSourceName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceRole, setSourceRole] = useState('canon');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [result, setResult] = useState<QuamputeResult | null>(null);
  const [reviewFilter, setReviewFilter] = useState<Status>('all');
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [webMcpStatus, setWebMcpStatus] = useState<'checking' | 'available' | 'unavailable' | 'error'>('checking');
  const [agentActivity, setAgentActivity] = useState<AgentActivity[]>([]);
  const webMcpStateRef = useRef<Record<string, unknown>>({});

  const firstName = useMemo(() => {
    const source = session?.owner.displayName || displayName;
    return source.split(/[\s@]/)[0] || 'Moth';
  }, [displayName, session]);
  const canBegin = concept.trim().length >= 12;
  const forgeRevisionId = session?.forge.revisionId;
  const filteredResolutions = useMemo(() => {
    const rows = result?.resolutions ?? [];
    return reviewFilter === 'all' ? rows : rows.filter((item) => item.status === reviewFilter);
  }, [result, reviewFilter]);

  useEffect(() => {
    void loadSession();
  }, []);

  async function loadSession() {
    setBusy('Loading the private Forge');
    setError('');
    try {
      const data = await requestJson<{ ok: true } & Session>('/api/session');
      setSession(data);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function createProject(targetStep: Step) {
    if (!canBegin || busy) return;
    setBusy('Holding the spark');
    setError('');
    try {
      const data = await requestJson<{ ok: true; project: Project }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, buildType }),
      });
      hydrateProject(data.project, [], []);
      setSourceMode('text');
      setSourceName('');
      setSourceText('');
      setSourceUrl('');
      setSourceRole('canon');
      setSourceFile(null);
      setStep(targetStep);
      await refreshProjectList();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function resumeProject(projectId: string) {
    setBusy('Opening the work order');
    setError('');
    try {
      const data = await requestJson<{ ok: true; project: Project; sources: Source[]; runs: RunReceipt[] }>('/api/projects/' + projectId);
      hydrateProject(data.project, data.sources, data.runs);
      const hasActiveRun = data.runs.some((run) => run.status === 'running' || run.status === 'unknown');
      setStep(data.project.result ? 4 : hasActiveRun ? 3 : 1);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function openCompletedDemo() {
    const data = await requestJson<{ ok: true; created: boolean; repaired: boolean; project: Project; sources: Source[]; runs: RunReceipt[] }>('/api/demo', {
      method: 'POST',
    });
    hydrateProject(data.project, data.sources, data.runs);
    setStep(4);
    await refreshProjectList();
    return data;
  }

  async function openCompletedDemoFromUi() {
    if (busy) return;
    setBusy('Opening the guided example');
    setError('');
    setNotice('');
    try {
      const data = await openCompletedDemo();
      setNotice(data.repaired
        ? 'The deterministic guided example was repaired to its canonical no-cost Review state.'
        : data.created ? 'The deterministic no-cost Review was created.' : 'The existing deterministic no-cost Review was reopened without replacement.');
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  function hydrateProject(next: Project, nextSources: Source[], nextRuns?: RunReceipt[]) {
    setProject(next);
    setSources(nextSources);
    if (nextRuns) setRuns(nextRuns);
    setConcept(next.concept);
    setBuildType(capitalizeBuildType(next.buildType));
    setLocksText((next.locks ?? []).join('\n'));
    setPlayerBoundary(next.playerBoundary);
    setContentBoundary(next.contentBoundary);
    setResearchEnabled(next.researchEnabled);
    setResearchApproved(next.researchCostApproved);
    setResult(next.result);
    setQuestionAnswers(Object.fromEntries((next.answers ?? []).flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const answer = value as { questionId?: unknown; answer?: unknown };
      return typeof answer.questionId === 'string' && typeof answer.answer === 'string'
        ? [[answer.questionId, answer.answer] as const]
        : [];
    })));
  }

  async function reloadProjectDetail(projectId: string) {
    const data = await requestJson<{ ok: true; project: Project; sources: Source[]; runs: RunReceipt[] }>('/api/projects/' + projectId);
    hydrateProject(data.project, data.sources, data.runs);
  }

  async function abandonUncertainRun(run: RunReceipt) {
    if (!project || busy) return;
    const traceId = run.traceId || run.id;
    const staleActive = run.status === 'running';
    const confirmed = window.confirm(`${staleActive ? 'Abandon active run pinned to the older Forge' : 'Abandon uncertain run'} ${traceId}?\n\nOnly do this after you accept that the earlier provider request may have been charged${staleActive ? ' and may still be processing' : ''}. The server will require a durable provider handle and confirmed deletion or absence before abandonment can commit. A fresh run can create another charge. This action never happens automatically.`);
    if (!confirmed) return;
    setBusy('Reconciling the uncertain run');
    setError('');
    try {
      await requestJson<{ ok: true; abandonedRunId: string }>(`/api/projects/${project.id}/runs/${run.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmTrace: traceId,
          confirmAction: staleActive ? 'ABANDON_STALE_ACTIVE_RUN' : 'ABANDON_UNCERTAIN_RUN',
        }),
      });
      clearProjectRunKeys(project.id);
      await reloadProjectDetail(project.id);
      setError(`${staleActive ? 'The stale active run' : 'The uncertain run'} was deliberately abandoned. Review the work order and cost approval before starting a fresh paid run.`);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  function newProject() {
    setProject(null);
    setSources([]);
    setRuns([]);
    setResult(null);
    setConcept('');
    setLocksText('');
    setQuestionAnswers({});
    setPlayerBoundary('Do not supply actions, inner states, speech, appearance, or permission on behalf of the participant.');
    setContentBoundary('general');
    setResearchEnabled(false);
    setResearchApproved(false);
    setSourceMode('text');
    setSourceName('');
    setSourceText('');
    setSourceUrl('');
    setSourceRole('canon');
    setSourceFile(null);
    setError('');
    setStep(0);
  }

  async function refreshProjectList() {
    const data = await requestJson<{ ok: true; projects: ProjectSummary[]; nextCursor: string | null }>('/api/projects');
    setSession((current) => current ? { ...current, projects: data.projects, projectsCursor: data.nextCursor } : current);
  }

  async function loadMoreProjects() {
    if (!session?.projectsCursor || busy) return;
    setBusy('Loading more private work orders');
    setError('');
    try {
      const data = await requestJson<{ ok: true; projects: ProjectSummary[]; nextCursor: string | null }>(
        '/api/projects?cursor=' + encodeURIComponent(session.projectsCursor),
      );
      setSession((current) => {
        if (!current) return current;
        const seen = new Set(current.projects.map((item) => item.id));
        return {
          ...current,
          projects: [...current.projects, ...data.projects.filter((item) => !seen.has(item.id))],
          projectsCursor: data.nextCursor,
        };
      });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function addSource(event: FormEvent) {
    event.preventDefault();
    if (!project || busy) return;
    setBusy('Anchoring the source');
    setError('');
    try {
      let options: RequestInit;
      if (sourceMode === 'file') {
        if (!sourceFile) throw new Error('Choose the file you want the Forge to hold.');
        const form = new FormData();
        form.set('file', sourceFile);
        form.set('name', sourceName);
        form.set('role', sourceRole);
        options = { method: 'POST', body: form };
      } else {
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sourceName,
            role: sourceRole,
            textContent: sourceMode === 'text' ? sourceText : undefined,
            uri: sourceMode === 'url' ? sourceUrl : undefined,
          }),
        };
      }
      const data = await requestJson<{ ok: true; source: Source }>('/api/projects/' + project.id + '/sources', options);
      setSources((current) => [...current, data.source]);
      setSourceName('');
      setSourceText('');
      setSourceUrl('');
      setSourceFile(null);
      const fresh = await requestJson<{ ok: true; project: Project; sources: Source[] }>('/api/projects/' + project.id);
      hydrateProject(fresh.project, fresh.sources);
      setStep(1);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function changeSourceRole(sourceId: string, role: string) {
    if (!project || busy) return;
    setBusy('Reclassifying the source');
    setError('');
    try {
      await requestJson<{ ok: true; source: Source }>('/api/projects/' + project.id + '/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, role }),
      });
      const fresh = await requestJson<{ ok: true; project: Project; sources: Source[] }>('/api/projects/' + project.id);
      hydrateProject(fresh.project, fresh.sources);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function removeSource(source: Source) {
    if (!project || busy) return;
    if (!window.confirm(`Remove “${source.name}” from this work order? The source itself will not be recoverable from the Forge.`)) return;
    setBusy('Removing the source');
    setError('');
    try {
      await requestJson<{ ok: true; deletedSourceId: string }>('/api/projects/' + project.id + '/sources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.id }),
      });
      const fresh = await requestJson<{ ok: true; project: Project; sources: Source[] }>('/api/projects/' + project.id);
      hydrateProject(fresh.project, fresh.sources);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function rebaseForge() {
    if (!project || busy) return;
    if (project.result && !window.confirm('Rebasing clears the current review candidate and QA state. Export it first if you want a copy. Continue with the rebase?')) return;
    setBusy('Rebasing to the verified Forge');
    setError('');
    try {
      const data = await requestJson<{ ok: true; project: Project }>('/api/projects/' + project.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rebaseForge: true }),
      });
      hydrateProject(data.project, sources);
      setStep(3);
      await refreshProjectList();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function saveLocks(nextStep: Step) {
    if (!project || busy) return;
    setBusy('Locking creator authority');
    setError('');
    const locks = locksText.split('\n').map((item) => item.trim()).filter(Boolean);
    try {
      const data = await requestJson<{ ok: true; project: Project }>('/api/projects/' + project.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locks,
          locksMode: 'replace',
          expectedLocksRevision: project.locksRevision,
          playerBoundary,
          contentBoundary,
          researchEnabled,
          researchCostApproved: researchApproved,
        }),
      });
      setProject(data.project);
      setResult(data.project.result);
      setStep(nextStep);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  async function runQuampute(activeResearchEnabled?: boolean) {
    if (!project || busy) return;
    setBusy('Building FRAME → MODEL → PEOPLE review');
    setError('');
    const effectiveResearchEnabled = activeResearchEnabled ?? researchEnabled;
    const signature = `${project.id}:${project.revision}:${project.locksRevision}:${effectiveResearchEnabled ? 1 : 0}`;
    const storageKey = `moth-forge:paid-run:${signature}`;
    const idempotencyKey = getOrCreateRunKey(storageKey, project.id);
    try {
      const nextResult = await requestQuamputeResult(project.id, idempotencyKey, effectiveResearchEnabled);
      removeRunKey(storageKey);
      setResult(nextResult);
      setProject((current) => current ? { ...current, result: nextResult, status: 'review' } : current);
      setStep(4);
      await refreshProjectList();
    } catch (caught) {
      if (caught instanceof PaidRunError && !caught.preserveKey) removeRunKey(storageKey);
      setError(messageOf(caught));
      if (caught instanceof PaidRunError && caught.preserveKey) {
        try {
          await reloadProjectDetail(project.id);
        } catch {
          // The original recovery error remains the useful message.
        }
      }
    } finally {
      setBusy('');
    }
  }

  async function saveAnswersAndRerun() {
    if (!project || !result) return;
    const answers = result.questions.map((question) => ({
      questionId: question.questionId,
      factBeingDetermined: question.factBeingDetermined,
      answer: questionAnswers[question.questionId]?.trim() ?? '',
    })).filter((answer) => answer.answer);
    if (!answers.length) {
      setError('Answer at least one reserved question before continuing.');
      return;
    }
    setBusy('Returning your decisions to the Forge');
    setError('');
    try {
      const data = await requestJson<{ ok: true; project: Project }>('/api/projects/' + project.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      setProject(data.project);
      setResult(data.project.result);
      setStep(data.project.result ? 4 : 3);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  function recordAgentActivity(name: string, summary: string, kind: AgentActivity['kind']) {
    setAgentActivity((current) => [{
      id: crypto.randomUUID(),
      name,
      summary,
      kind,
      at: new Date().toISOString(),
    }, ...current].slice(0, 4));
  }

  webMcpStateRef.current = {
    session,
    project,
    sources,
    runs,
    result,
    step,
    busy,
    concept,
    buildType,
    locksText,
    playerBoundary,
    contentBoundary,
    researchEnabled,
    researchApproved,
    questionAnswers,
    setConcept,
    setBuildType,
    setStep,
    setLocksText,
    setPlayerBoundary,
    setContentBoundary,
    setQuestionAnswers,
    hydrateProject,
    reloadProjectDetail,
    refreshProjectList,
    openCompletedDemo,
    recordAgentActivity,
  };

  useEffect(() => {
    if (!forgeRevisionId) return;
    let cancelled = false;
    const modelContext = (document as Document & { modelContext?: WebMcpModelContext }).modelContext;
    if (typeof modelContext?.registerTool !== 'function') {
      queueMicrotask(() => {
        if (!cancelled) setWebMcpStatus('unavailable');
      });
      return () => { cancelled = true; };
    }

    const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const localWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
    const localReplace = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
    const persistentWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
    const destructiveWrite = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
    const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
      type: 'object', properties, required, additionalProperties: false,
    });
    const current = () => webMcpStateRef.current as {
      session: Session;
      project: Project | null;
      sources: Source[];
      runs: RunReceipt[];
      result: QuamputeResult | null;
      step: Step;
      busy: string;
      concept: string;
      buildType: BuildType;
      locksText: string;
      playerBoundary: string;
      contentBoundary: string;
      researchEnabled: boolean;
      researchApproved: boolean;
      questionAnswers: Record<string, string>;
      setConcept: typeof setConcept;
      setBuildType: typeof setBuildType;
      setStep: typeof setStep;
      setLocksText: typeof setLocksText;
      setPlayerBoundary: typeof setPlayerBoundary;
      setContentBoundary: typeof setContentBoundary;
      setQuestionAnswers: typeof setQuestionAnswers;
      hydrateProject: typeof hydrateProject;
      reloadProjectDetail: typeof reloadProjectDetail;
      refreshProjectList: typeof refreshProjectList;
      openCompletedDemo: typeof openCompletedDemo;
      recordAgentActivity: typeof recordAgentActivity;
    };
    const requireProject = () => {
      const active = current().project;
      if (!active) throw new Error('No Forge project is open. Create or open one first.');
      return active;
    };
    const requireIdle = () => {
      if (current().busy) throw new Error(`The Forge is busy: ${current().busy}`);
    };
    const textSourceSchemaLimit = current().session.engine.demoMode ? 100_000 : 1_400_000;

    const tools: WebMcpToolDefinition[] = [
      {
        name: 'inspect_forge_studio',
        description: 'Inspect the shared Moth Forge workbench, verified Forge anchor, current stage, open project, evidence counts, and human-only gates. Use this before proposing or changing work.',
        inputSchema: objectSchema({}),
        annotations: readOnly,
        execute: () => {
          const state = current();
          return {
            forge: state.session.forge,
            stage: railSteps[state.step][1],
            busy: state.busy || null,
            project: state.project ? projectToolSummary(state.project) : null,
            sources: state.sources.map(sourceToolSummary),
            activeRuns: state.runs.filter((run) => ['running', 'unknown'].includes(run.status)),
            humanOnlyGates: ['Approve API cost and processing terms', 'Start a paid Quampute run', 'Remove evidence', 'Abandon an uncertain paid run', 'Publish or submit'],
          };
        },
      },
      {
        name: 'list_forge_projects',
        description: 'List the creator-owned Forge work orders currently loaded in the studio so an agent can resume the correct project instead of guessing.',
        inputSchema: objectSchema({}),
        annotations: readOnly,
        execute: () => {
          const state = current();
          return { projects: state.session.projects, moreAvailable: Boolean(state.session.projectsCursor) };
        },
      },
      {
        name: 'set_forge_spark',
        description: 'Stage a concept and build shape in the visible Spark editor without saving. Use this to let the creator inspect or revise the framing before a work order is created.',
        inputSchema: objectSchema({
          concept: { type: 'string', minLength: 12, maxLength: 18000, description: 'The creator-owned premise or concept spark.' },
          buildType: { type: 'string', enum: buildTypes, description: 'Character, Scenario, Cast, World, or Hybrid.' },
        }, ['concept', 'buildType']),
        annotations: localReplace,
        execute: (input) => {
          requireIdle();
          const stagedConcept = requiredString(input.concept, 'concept', 12, 18000);
          const stagedBuild = buildTypeInput(input.buildType);
          const state = current();
          state.setConcept(stagedConcept);
          state.setBuildType(stagedBuild);
          state.setStep(0);
          state.recordAgentActivity('set_forge_spark', `Staged a ${stagedBuild.toLowerCase()} spark for creator review.`, 'handoff');
          return { staged: true, persisted: false, stage: 'Spark', concept: stagedConcept, buildType: stagedBuild, nextHumanChoice: 'Revise the spark or ask the agent to create the work order.' };
        },
      },
      {
        name: 'create_forge_project',
        description: 'Create a private, version-pinned Forge work order from an agreed concept. This persists the project but does not run the paid model, publish anything, or approve costs.',
        inputSchema: objectSchema({
          concept: { type: 'string', minLength: 12, maxLength: 18000 },
          buildType: { type: 'string', enum: buildTypes },
          title: { type: 'string', minLength: 1, maxLength: 120 },
        }, ['concept', 'buildType']),
        annotations: persistentWrite,
        execute: async (input) => {
          requireIdle();
          const nextConcept = requiredString(input.concept, 'concept', 12, 18000);
          const nextBuild = buildTypeInput(input.buildType);
          const title = optionalString(input.title, 120);
          const data = await requestJson<{ ok: true; project: Project }>('/api/projects', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concept: nextConcept, buildType: nextBuild, title: title || undefined }),
          });
          const state = current();
          state.hydrateProject(data.project, [], []);
          state.setStep(1);
          await state.refreshProjectList();
          state.recordAgentActivity('create_forge_project', `Created “${data.project.title}” and handed off at Sources.`, 'write');
          return { created: true, project: projectToolSummary(data.project), stage: 'Sources', paidRunStarted: false, published: false };
        },
      },
      {
        name: 'open_completed_forge_demo',
        description: 'Open a free, completed, owner-scoped example so the creator can inspect Review and Export without an API key or model charge. The example is visibly labeled and never claims to be a real Quampute run.',
        inputSchema: objectSchema({}),
        annotations: localReplace,
        execute: async () => {
          requireIdle();
          const state = current();
          const data = await state.openCompletedDemo();
          state.recordAgentActivity('open_completed_forge_demo', data.repaired
            ? 'Repaired and opened the deterministic no-cost example at Review.'
            : `Opened the free completed example at Review${data.created ? '.' : ' from the existing private copy.'}`, 'write');
          return {
            opened: true,
            created: data.created,
            repaired: data.repaired,
            project: projectToolSummary(data.project),
            stage: 'Review',
            modelCallMade: false,
            apiCost: 0,
            published: false,
          };
        },
      },
      {
        name: 'open_forge_project',
        description: 'Open an existing creator-owned Forge work order by exact project ID and synchronize the visible workbench to it.',
        inputSchema: objectSchema({ projectId: { type: 'string', minLength: 8 } }, ['projectId']),
        annotations: localReplace,
        execute: async (input) => {
          requireIdle();
          const projectId = requiredString(input.projectId, 'projectId', 8, 100);
          const data = await requestJson<{ ok: true; project: Project; sources: Source[]; runs: RunReceipt[] }>('/api/projects/' + encodeURIComponent(projectId));
          const state = current();
          state.hydrateProject(data.project, data.sources, data.runs);
          const nextStep: Step = data.project.result ? 4 : data.runs.some((run) => ['running', 'unknown'].includes(run.status)) ? 3 : 1;
          state.setStep(nextStep);
          state.recordAgentActivity('open_forge_project', `Opened “${data.project.title}” at ${railSteps[nextStep][1]}.`, 'handoff');
          return { opened: true, project: projectToolSummary(data.project), sources: data.sources.map(sourceToolSummary), stage: railSteps[nextStep][1] };
        },
      },
      {
        name: 'add_forge_text_source',
        description: 'Attach readable text evidence to the open work order with an explicit authority role. Supplied source text remains evidence; it is never silently promoted or published.',
        inputSchema: objectSchema({
          name: { type: 'string', minLength: 1, maxLength: 180 },
          text: { type: 'string', minLength: 1, maxLength: textSourceSchemaLimit, description: current().session.engine.demoMode ? 'Public demo limit: 100 KB after UTF-8 encoding.' : 'Private studio limit: 1.4 MB after UTF-8 encoding.' },
          role: { type: 'string', enum: ['canon', 'reference', 'inspiration', 'format_only'] },
        }, ['name', 'text', 'role']),
        annotations: persistentWrite,
        execute: async (input) => {
          requireIdle();
          const active = requireProject();
          const name = requiredString(input.name, 'name', 1, 180);
          const text = requiredString(input.text, 'text', 1, textSourceSchemaLimit);
          const role = enumInput(input.role, ['canon', 'reference', 'inspiration', 'format_only'] as const, 'role');
          const data = await requestJson<{ ok: true; source: Source }>(`/api/projects/${active.id}/sources`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, textContent: text, role }),
          });
          const state = current();
          await state.reloadProjectDetail(active.id);
          state.setStep(1);
          state.recordAgentActivity('add_forge_text_source', `Attached “${data.source.name}” as ${role}.`, 'write');
          return { attached: true, source: sourceToolSummary(data.source), stage: 'Sources', reviewNote: 'The creator can inspect or reclassify this evidence in the visible ledger.' };
        },
      },
      {
        name: 'update_forge_creator_locks',
        description: 'Append creator locks by default, or explicitly replace them. Both modes require the exact locks revision returned by inspect/open so the server can reject stale writes. Current locks and boundaries are exposed by inspect/open tools so an agent can preserve them. This cannot approve API charges, enable research, start a run, delete evidence, or publish.',
        inputSchema: objectSchema({
          locks: { type: 'array', maxItems: 80, items: { type: 'string', minLength: 1, maxLength: 500 } },
          mode: { type: 'string', enum: ['append', 'replace'], description: 'Defaults to append. Replace can remove existing locks and is destructive.' },
          expectedLocksRevision: { type: 'integer', minimum: 1, description: 'Required for every save and must match the inspected open project.' },
          playerBoundary: { type: 'string', minLength: 1, maxLength: 500 },
          contentBoundary: { type: 'string', enum: ['general', 'mature_18_plus', 'mixed_private'] },
        }, ['locks', 'expectedLocksRevision']),
        annotations: destructiveWrite,
        execute: async (input) => {
          requireIdle();
          const active = requireProject();
          const incomingLocks = stringArrayInput(input.locks, 'locks', 80, 500);
          const mode = input.mode === undefined ? 'append' : enumInput(input.mode, ['append', 'replace'] as const, 'mode');
          const expectedLocksRevision = integerInput(input.expectedLocksRevision, 1, Number.MAX_SAFE_INTEGER, 0);
          if (expectedLocksRevision !== active.locksRevision) {
            throw new Error(`Saving locks requires expectedLocksRevision ${active.locksRevision}; inspect the project again before changing anything.`);
          }
          const state = current();
          const nextPlayerBoundary = optionalString(input.playerBoundary, 500) || state.playerBoundary;
          const nextContentBoundary = input.contentBoundary === undefined
            ? state.contentBoundary
            : enumInput(input.contentBoundary, ['general', 'mature_18_plus', 'mixed_private'] as const, 'contentBoundary');
          const data = await requestJson<{ ok: true; project: Project }>(`/api/projects/${active.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              locks: incomingLocks,
              locksMode: mode,
              expectedLocksRevision,
              playerBoundary: nextPlayerBoundary,
              contentBoundary: nextContentBoundary,
            }),
          });
          state.hydrateProject(data.project, state.sources);
          state.setStep(2);
          state.recordAgentActivity('update_forge_creator_locks', `${mode === 'append' ? 'Appended' : 'Replaced with'} ${incomingLocks.length} submitted creator lock${incomingLocks.length === 1 ? '' : 's'}; ${data.project.locks.length} are now active. Cost approval was untouched.`, 'write');
          return {
            saved: true,
            mode,
            project: projectToolSummary(data.project),
            resultingLocks: data.project.locks,
            playerBoundary: data.project.playerBoundary,
            contentBoundary: data.project.contentBoundary,
            stage: 'Locks',
            costApprovalChanged: false,
            runStarted: false,
          };
        },
      },
      {
        name: 'inspect_forge_review',
        description: 'Read the current review candidate, reserved creator questions, QA gates, and next action without changing the work order.',
        inputSchema: objectSchema({
          status: { type: 'string', enum: statuses, description: 'Optional resolution-status filter.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        }),
        annotations: readOnly,
        execute: (input) => {
          const state = current();
          if (!state.result) return { available: false, explanation: 'No review candidate exists yet.' };
          const status = input.status === undefined ? 'all' : enumInput(input.status, statuses, 'status');
          const limit = integerInput(input.limit, 1, 50, 20);
          const rows = status === 'all' ? state.result.resolutions : state.result.resolutions.filter((item) => item.status === status);
          return {
            available: true,
            conceptKernel: state.result.conceptKernel,
            resolutions: rows.slice(0, limit),
            totalMatching: rows.length,
            questions: state.result.questions,
            qa: state.result.qa,
            nextAction: state.result.nextAction,
          };
        },
      },
      {
        name: 'stage_forge_question_answer',
        description: 'Stage an answer to one Forge-reserved creator question in the visible review form. It remains unsaved until the creator reviews and presses the save control.',
        inputSchema: objectSchema({
          questionId: { type: 'string', minLength: 1 },
          answer: { type: 'string', minLength: 1, maxLength: 2000 },
        }, ['questionId', 'answer']),
        annotations: localReplace,
        execute: (input) => {
          requireIdle();
          const state = current();
          const questionId = requiredString(input.questionId, 'questionId', 1, 200);
          const answer = requiredString(input.answer, 'answer', 1, 2000);
          const question = state.result?.questions.find((item) => item.questionId === questionId);
          if (!question) throw new Error('That reserved question is not present in the current review candidate.');
          state.setQuestionAnswers((answers) => ({ ...answers, [questionId]: answer }));
          state.setStep(4);
          state.recordAgentActivity('stage_forge_question_answer', `Staged an answer for “${question.factBeingDetermined}”.`, 'handoff');
          return { staged: true, persisted: false, question, answer, nextHumanChoice: 'Review the staged answer, revise it if needed, then use the visible save control.' };
        },
      },
      {
        name: 'navigate_forge_stage',
        description: 'Move the shared visible workbench to an available Forge stage so the creator and agent stay oriented on the same surface.',
        inputSchema: objectSchema({ stage: { type: 'string', enum: railSteps.map((item) => item[1]) } }, ['stage']),
        annotations: localWrite,
        execute: (input) => {
          requireIdle();
          const stage = enumInput(input.stage, railSteps.map((item) => item[1]), 'stage');
          const index = railSteps.findIndex((item) => item[1] === stage) as Step;
          const state = current();
          if (index > 0 && !state.project) throw new Error('Create or open a Forge project before navigating beyond Spark.');
          if (index === 4 && !state.result) throw new Error('No review candidate exists yet.');
          state.setStep(index);
          state.recordAgentActivity('navigate_forge_stage', `Moved the shared view to ${stage}.`, 'handoff');
          return { navigated: true, stage, projectId: state.project?.id ?? null };
        },
      },
      {
        name: 'prepare_forge_run',
        description: current().session.engine.demoMode
          ? 'Open or restore the deterministic no-cost demo and move to Review. Restoring the demo can replace its saved guided state, so this public path is deliberately marked destructive.'
          : 'Inspect run readiness and move the creator to the paid-run gate. This tool deliberately cannot approve charges or start a Quampute run.',
        inputSchema: objectSchema({}),
        annotations: current().session.engine.demoMode ? destructiveWrite : localWrite,
        execute: async () => {
          requireIdle();
          const state = current();
          if (state.session.engine.demoMode) {
            const data = await state.openCompletedDemo();
            state.recordAgentActivity('prepare_forge_run', 'Opened or restored the deterministic no-cost review because paid execution is disabled in public mode.', 'write');
            return {
              prepared: true,
              runStarted: false,
              openedCompletedDemo: true,
              repaired: data.repaired,
              project: projectToolSummary(data.project),
              stage: 'Review',
              blockers: [],
              humanOnlyAction: 'Inspect the completed Review or export its receipt.',
            };
          }
          const active = requireProject();
          state.setStep(3);
          const forgeCurrent = state.session.forge.revisionId === active.forgeRevisionId;
          const activeRuns = state.runs.filter((run) => ['running', 'unknown'].includes(run.status));
          const blockers = [
            state.session.engine.demoMode ? 'Paid execution is intentionally disabled in the public challenge demo.' : null,
            !state.session.engine.demoMode && !state.session.engine.configured ? 'Server-side OpenAI API secret is not configured.' : null,
            !forgeCurrent ? 'Project is pinned to an older Forge revision.' : null,
            !state.researchApproved ? 'Creator has not approved separate API charges and processing terms.' : null,
            activeRuns.some((run) => run.status === 'unknown') ? 'An earlier paid request has uncertain provider state.' : null,
          ].filter(Boolean);
          state.recordAgentActivity('prepare_forge_run', blockers.length ? 'Opened the run gate with blockers visible.' : 'Opened the human-only paid-run gate.', 'handoff');
          return { prepared: true, runStarted: false, stage: 'Quampute', blockers, humanOnlyAction: 'The creator must inspect the receipt and press the visible run button.' };
        },
      },
      {
        name: 'get_forge_export_links',
        description: 'Return export links for the open project and its honest completion state. This does not download, publish, or submit anything.',
        inputSchema: objectSchema({}),
        annotations: readOnly,
        execute: () => {
          const state = current();
          const active = requireProject();
          return {
            project: projectToolSummary(active),
            json: `/api/projects/${active.id}/export?format=json`,
            markdown: `/api/projects/${active.id}/export?format=markdown`,
            completionState: state.result?.qa.projectCompletion ?? 'No Quampute result yet',
            published: false,
          };
        },
      },
    ];

    void (async () => {
      try {
        if (typeof modelContext.unregisterTool === 'function') {
          await Promise.all(forgeSiteToolNames.map(async (name) => {
            try { await modelContext.unregisterTool?.(name); } catch { /* The tool may not exist yet. */ }
          }));
        }
        for (const tool of tools) {
          if (cancelled) return;
          await modelContext.registerTool(tool);
        }
        if (!cancelled) setWebMcpStatus('available');
      } catch (caught) {
        if (!cancelled) {
          setWebMcpStatus('error');
          setError(`Site tools could not register: ${messageOf(caught)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [forgeRevisionId]);

  const anchor = session?.forge;
  const anchorHealthy = anchor?.status === 'verified';
  const currentIndex = step;
  const hasActiveRun = runs.some((run) => run.status === 'running' || run.status === 'unknown');

  return (
    <main className="forge-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <button className="brand-lockup brand-button" aria-label="Start a new Moth Forge project" onClick={newProject} type="button">
          <span className="forge-mark" aria-hidden="true"><span /></span>
          <span>
            <span className="eyebrow">MOTH FORGE</span>
            <span className="brand-title">Quampute</span>
          </span>
        </button>

        <div className={'anchor-status ' + (anchorHealthy ? '' : 'warning')} title="Verified against the bundled live Forge revision">
          <span className="status-pulse" />
          <span>{anchorHealthy ? 'Forge verified' : 'Forge checking'}</span>
          <strong>{anchor ? anchor.verifiedTabCount + ' / ' + anchor.expectedTabCount : '— / 29'}</strong>
        </div>

        <div className="identity-chip">
          <span className="avatar">{firstName.slice(0, 1).toUpperCase()}</span>
          <span>
            <small>{session?.owner.local ? 'Local private studio' : 'Private studio'}</small>
            <strong>{firstName}</strong>
          </span>
        </div>
      </header>

      <div className="mobile-stage-strip" aria-label="Current Forge stage">
        <span>{railSteps[currentIndex][0]}</span>
        <strong>{railSteps[currentIndex][1]}</strong>
        <small>{railSteps[currentIndex][2]}</small>
      </div>

      <div className="studio-grid">
        <aside className="process-rail" aria-label="Forge stages">
          <p className="rail-label">THE PASS</p>
          <ol>
            {railSteps.map(([number, title, detail], index) => {
              const available = index === 0 || Boolean(project) && (!hasActiveRun || index === 3);
              return (
                <li className={(index === currentIndex ? 'active ' : '') + (index < currentIndex ? 'complete' : '')} key={title}>
                  <button disabled={!available} onClick={() => available && setStep(index as Step)} type="button">
                    <span className="step-number">{index < currentIndex ? '✓' : number}</span>
                    <span><strong>{title}</strong><small>{detail}</small></span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="privacy-note">
            <span aria-hidden="true">⌁</span>
            <p><strong>Owner-scoped</strong>Private-site authentication and per-owner storage protect every work order.</p>
          </div>
        </aside>

        <section className="spark-workspace workbench">
          {error ? <div className="error-banner" role="alert"><strong>Forge paused.</strong>{error}</div> : null}
          {notice ? <div className="working-banner" role="status"><span>✓</span>{notice}</div> : null}
          {busy ? <div className="working-banner" role="status"><span>✦</span>{busy}</div> : null}

          {step === 0 ? (
            <SparkStep
              buildType={buildType}
              canBegin={canBegin}
              concept={concept}
              firstName={firstName}
              nextProjectsCursor={session?.projectsCursor ?? null}
              projects={session?.projects ?? []}
              setBuildType={setBuildType}
              setConcept={setConcept}
              onCreate={createProject}
              onLoadMore={loadMoreProjects}
              onOpenDemo={() => void openCompletedDemoFromUi()}
              onResume={resumeProject}
              webMcpStatus={webMcpStatus}
            />
          ) : null}

          {step === 1 && project ? (
            <SourcesStep
              mode={sourceMode}
              name={sourceName}
              role={sourceRole}
              sourceFile={sourceFile}
              sources={sources}
              publicDemoMode={Boolean(session?.engine.demoMode)}
              text={sourceText}
              url={sourceUrl}
              onAdd={addSource}
              onChangeRole={changeSourceRole}
              onRemove={removeSource}
              onBack={() => setStep(0)}
              onContinue={() => setStep(2)}
              setMode={setSourceMode}
              setName={setSourceName}
              setRole={setSourceRole}
              setSourceFile={setSourceFile}
              setText={setSourceText}
              setUrl={setSourceUrl}
            />
          ) : null}

          {step === 2 && project ? (
            <LocksStep
              contentBoundary={contentBoundary}
              locksText={locksText}
              playerBoundary={playerBoundary}
              publicDemoMode={Boolean(session?.engine.demoMode)}
              researchApproved={researchApproved}
              researchEnabled={researchEnabled}
              setContentBoundary={setContentBoundary}
              setLocksText={setLocksText}
              setPlayerBoundary={setPlayerBoundary}
              setResearchApproved={setResearchApproved}
              setResearchEnabled={setResearchEnabled}
              onBack={() => setStep(1)}
              onContinue={() => void saveLocks(3)}
            />
          ) : null}

          {step === 3 && project ? (
            <QuamputeStep
              anchor={anchor}
              engine={session?.engine ?? null}
              project={project}
              researchApproved={researchApproved}
              researchEnabled={researchEnabled}
              runningRuns={runs.filter((run) => run.status === 'running')}
              uncertainRuns={runs.filter((run) => run.status === 'unknown')}
              sourceCount={sources.length}
              onBack={() => setStep(2)}
              onAbandon={abandonUncertainRun}
              onRebase={rebaseForge}
              onOpenDemo={() => void openCompletedDemoFromUi()}
              onRun={() => void runQuampute(Boolean(runs.find((run) => run.status === 'running')?.researchEnabled ?? researchEnabled))}
            />
          ) : null}

          {step === 4 && project && result ? (
            <ReviewStep
              answers={questionAnswers}
              filtered={filteredResolutions}
              filter={reviewFilter}
              result={result}
              setAnswers={setQuestionAnswers}
              setFilter={setReviewFilter}
              onBack={() => setStep(3)}
              onExport={() => setStep(5)}
              onSaveAnswers={saveAnswersAndRerun}
            />
          ) : null}

          {step === 4 && project && !result ? (
            <EmptyReview onRun={() => setStep(3)} />
          ) : null}

          {step === 5 && project ? (
            <ExportStep project={project} result={result} onBack={() => setStep(4)} />
          ) : null}
        </section>

        <aside className="evidence-panel">
          <section className="panel-card anchor-card">
            <div className="panel-heading">
              <span className="opal-dot" />
              <div><p>VERSIONED AUTHORITY</p><h2>Forge Anchor</h2></div>
            </div>
            <dl>
              <div><dt>Revision</dt><dd>{shortRevision(anchor?.revisionId)}</dd></div>
              <div><dt>Integrity</dt><dd>{anchor ? anchor.verifiedTabCount + ' / ' + anchor.expectedTabCount + ' tabs' : 'Checking'}</dd></div>
              <div><dt>Workflow</dt><dd>FRAME → MODEL → PEOPLE</dd></div>
              <div><dt>Corpus</dt><dd>{anchor ? Math.round(anchor.totalCharacters / 1000) + 'k chars' : '—'}</dd></div>
            </dl>
            <p className="anchor-foot">Each project pins this exact revision. A mismatch stops the run before a paid model call.</p>
          </section>

          <section className="panel-card state-card">
            <p className="panel-overline">HOW TRUTH IS HELD</p>
            <ul>
              <li><span className="status-token confirmed">confirmed</span><p><strong>Confirmed</strong>Direct support from a human statement or eligible primary source</p></li>
              <li><span className="status-token derived">derived</span><p><strong>Derived</strong>A supported working conclusion that remains revisable</p></li>
              <li><span className="status-token adapted">adapted</span><p><strong>Adapted</strong>A conclusion translated for a named destination</p></li>
              <li><span className="status-token reserved">reserved</span><p><strong>Reserved</strong>A human-owned choice intentionally left open</p></li>
              <li><span className="status-token not-applicable">not applicable</span><p><strong>Not applicable</strong>Reviewed and excluded with a recorded reason</p></li>
            </ul>
          </section>

          <section className="panel-card engine-card">
            <p className="panel-overline">ENGINE</p>
            <div className="engine-line"><span className={session?.engine.configured || session?.engine.demoMode ? 'engine-on' : 'engine-off'} />{session?.engine.configured ? 'Paid engine ready' : session?.engine.demoMode ? 'Free example ready' : 'Secret needed'}</div>
            <p>{session?.engine.configured ? `${session.engine.model} · API approval required` : 'Guided review makes no model call'} · research off by default</p>
          </section>

          <section className="panel-card agent-card">
            <p className="panel-overline">HUMAN + AGENT</p>
            <div className="site-tools-line">
              <span className={'site-tools-dot ' + webMcpStatus} />
              <strong>{webMcpStatus === 'available' ? `${forgeSiteToolNames.length} site tools ready` : webMcpStatus === 'checking' ? 'Checking site tools' : 'Browser tools unavailable'}</strong>
            </div>
            <p className="agent-card-copy">The agent can prepare and inspect the work. You keep the costly, destructive, and public gates.</p>
            {agentActivity.length ? <ol>{agentActivity.map((activity) => <li key={activity.id}><span>{activity.kind === 'read' ? '↗' : activity.kind === 'write' ? '✦' : '→'}</span><div><strong>{humanize(activity.name)}</strong><small>{activity.summary}</small></div></li>)}</ol> : <p className="agent-card-empty">Try: “Inspect this Forge, stage my premise, and tell me the one decision only I should make.”</p>}
          </section>

          <blockquote>“You provide identity and authority. The system performs the labor of consequence.”</blockquote>
        </aside>
      </div>
    </main>
  );
}

function SparkStep(props: {
  buildType: BuildType;
  canBegin: boolean;
  concept: string;
  firstName: string;
  nextProjectsCursor: string | null;
  projects: ProjectSummary[];
  setBuildType: (value: BuildType) => void;
  setConcept: (value: string) => void;
  onCreate: (step: Step) => void;
  onLoadMore: () => void;
  onOpenDemo: () => void;
  onResume: (id: string) => void;
  webMcpStatus: 'checking' | 'available' | 'unavailable' | 'error';
}) {
  return (
    <>
      <div className="section-kicker"><span>01</span><p>THE SPARK</p></div>
      <div className="hero-copy">
        <p className="welcome">Welcome back, {props.firstName}.</p>
        <h1>What are we <em>forging?</em></h1>
        <p className="lede">Give the Forge the part only you can know. It will inspect evidence, derive consequences, and bring back only the decisions that truly belong to you.</p>
      </div>
      <div className={'collaboration-banner ' + props.webMcpStatus}>
        <span className={'site-tools-dot ' + props.webMcpStatus} />
        <div>
          <strong>{props.webMcpStatus === 'available' ? `${forgeSiteToolNames.length} WebMCP tools are ready to collaborate` : props.webMcpStatus === 'checking' ? 'Connecting the shared agent workbench' : 'Use the studio directly; agent tools are unavailable here'}</strong>
          <p>Ask ChatGPT to inspect evidence, stage the premise, save locks, or prepare a run. You remain the final hand on cost, deletion, and publication.</p>
        </div>
      </div>
      <fieldset className="type-picker">
        <legend>Build shape</legend>
        <div>
          {buildTypes.map((type) => (
            <button aria-pressed={props.buildType === type} className={props.buildType === type ? 'selected' : ''} key={type} onClick={() => props.setBuildType(type)} type="button">{type}</button>
          ))}
        </div>
      </fieldset>
      <div className="concept-card">
        <label htmlFor="concept">Concept kernel</label>
        <textarea
          id="concept"
          maxLength={18000}
          onChange={(event) => props.setConcept(event.target.value)}
          placeholder="An overprepared museum registrar turns a routine inventory night into an accidental social mystery..."
          value={props.concept}
        />
        <div className="concept-footer">
          <p><span className="status-token derived">derived</span>Unconfirmed conclusions remain open to revision.</p>
          <span>{props.concept.length.toLocaleString()} / 18,000</span>
        </div>
      </div>
      <div className="action-row">
        <button className="quiet-action" disabled={!props.canBegin} onClick={() => props.onCreate(1)} type="button"><span aria-hidden="true">＋</span>Add sources first</button>
        <button className="primary-action" disabled={!props.canBegin} onClick={() => props.onCreate(2)} type="button">Begin pre-quampute <span aria-hidden="true">→</span></button>
      </div>
      <button className="demo-example-action" onClick={props.onOpenDemo} type="button"><span aria-hidden="true">◇</span> Explore a completed, no-cost example</button>
      {props.projects.length ? (
        <section className="recent-projects">
          <div className="mini-heading"><p>PRIVATE WORK ORDERS</p><span>{props.projects.length}</span></div>
          <div className="recent-grid">
            {props.projects.map((project) => (
              <button key={project.id} onClick={() => props.onResume(project.id)} type="button">
                <span>{project.buildType}</span>
                <strong>{project.title}</strong>
                <small>{project.status} · revision {project.revision}</small>
              </button>
            ))}
          </div>
          {props.nextProjectsCursor ? <button className="quiet-action load-more-projects" onClick={props.onLoadMore} type="button">Load older work orders</button> : null}
        </section>
      ) : null}
    </>
  );
}

function SourcesStep(props: {
  mode: 'text' | 'url' | 'file';
  name: string;
  role: string;
  sourceFile: File | null;
  sources: Source[];
  publicDemoMode: boolean;
  text: string;
  url: string;
  onAdd: (event: FormEvent) => void;
  onBack: () => void;
  onChangeRole: (sourceId: string, role: string) => void;
  onContinue: () => void;
  onRemove: (source: Source) => void;
  setMode: (value: 'text' | 'url' | 'file') => void;
  setName: (value: string) => void;
  setRole: (value: string) => void;
  setSourceFile: (value: File | null) => void;
  setText: (value: string) => void;
  setUrl: (value: string) => void;
}) {
  const canonCharacters = props.sources
    .filter((source) => source.role === 'canon')
    .reduce((total, source) => total + source.textCharacters, 0);
  const canonNeedsRepair = props.sources.some((source) => source.role === 'canon' && !['verified_full', 'verified_visual'].includes(source.readStatus))
    || canonCharacters > 90_000;
  const deferredSupporting = props.sources.filter((source) => source.role !== 'canon' && !['verified_full', 'verified_visual'].includes(source.readStatus));
  const readableSupporting = props.sources.filter((source) => source.role !== 'canon'
    && source.readStatus === 'verified_full' && source.textCharacters > 0);
  const packetAllocation = readableSupporting.reduce((state, source, index) => {
    const remainingSources = readableSupporting.length - index;
    const allocated = Math.min(source.textCharacters, Math.floor(state.remaining / Math.max(1, remainingSources)));
    return {
      remaining: state.remaining - allocated,
      sampled: allocated < source.textCharacters ? [...state.sampled, source] : state.sampled,
    };
  }, { remaining: Math.max(0, 90_000 - canonCharacters), sampled: [] as Source[] });
  const sampledSupporting = packetAllocation.sampled;
  return (
    <>
      <StepHeading number="02" overline="SOURCE CUSTODY" title="What does the Forge answer to?" description="Canon, approved references, URLs, and private notes stay distinct. A source may inform the build; it never gets to command the system." />
      <form className="source-composer" onSubmit={props.onAdd}>
        <div className="mode-tabs">
          {(props.publicDemoMode ? ['text', 'url'] as const : ['text', 'url', 'file'] as const).map((mode) => <button className={props.mode === mode ? 'selected' : ''} key={mode} onClick={() => props.setMode(mode)} type="button">{mode === 'text' ? 'Paste evidence' : mode === 'url' ? 'Add URL' : 'Upload file'}</button>)}
        </div>
        <div className="source-grid">
          <label><span>Source name</span><input onChange={(event) => props.setName(event.target.value)} placeholder="Character bible, approved portrait, creator note…" value={props.name} /></label>
          <label><span>Role</span><select onChange={(event) => props.setRole(event.target.value)} value={props.role}><option value="canon">Canon</option><option value="reference">Reference</option><option value="inspiration">Inspiration</option><option value="format_only">Format only</option></select></label>
        </div>
        {props.mode === 'text' ? <label className="full-field"><span>Evidence</span><textarea onChange={(event) => props.setText(event.target.value)} placeholder="Paste the exact information the Forge should preserve…" value={props.text} /></label> : null}
        {props.mode === 'url' ? <label className="full-field"><span>Source URL</span><input onChange={(event) => props.setUrl(event.target.value)} placeholder="https://…" type="url" value={props.url} /><small>URLs are kept in the private source ledger and are not sent to OpenAI or fetched in this pre-pass. Paste readable text when the contents must inform the run.</small></label> : null}
        {props.mode === 'file' ? <label className="file-drop"><input accept=".txt,.md,.json,.csv,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif" onChange={(event) => props.setSourceFile(event.target.files?.[0] ?? null)} type="file" /><span>＋</span><strong>{props.sourceFile?.name ?? 'Choose a private source file'}</strong><small>UTF-8 text is read directly. PNG, JPEG, WEBP, and non-animated GIF images are sent as private visual evidence during a paid pass. PDF and DOCX remain stored but deferred.</small></label> : null}
        <button className="secondary-action" type="submit">Anchor source</button>
      </form>
      <section className="source-ledger">
        <div className="mini-heading"><p>SOURCE LEDGER</p><span>{props.sources.length}</span></div>
        {canonNeedsRepair ? <p className="source-warning">A canon source is opaque or the readable canon packet exceeds 90,000 characters. Reclassify or remove it here before a paid run; the Forge will stop safely instead of sampling canon.</p> : null}
        {deferredSupporting.length ? <p className="source-warning deferred">{deferredSupporting.length} non-canon source{deferredSupporting.length === 1 ? ' is' : 's are'} deferred and will not inform this paid pre-pass. Paste readable text to use the contents; leaving them attached will be receipted but will not block the run.</p> : null}
        {sampledSupporting.length ? <p className="source-warning deferred">The 90,000-character model packet will sample or omit {sampledSupporting.length} readable non-canon source{sampledSupporting.length === 1 ? '' : 's'} after canon is allocated first. Their full hashes and coverage will be receipted, but only the allocated excerpts can inform this paid pre-pass.</p> : null}
        {props.sources.length ? props.sources.map((source) => (
          <article key={source.id}>
            <span className={'source-state ' + (['verified_full', 'verified_visual'].includes(source.readStatus) ? 'ready' : 'opaque')}>{source.readStatus === 'verified_full' ? 'READ' : source.readStatus === 'verified_visual' ? 'VISION' : 'OPAQUE'}</span>
            <div><strong>{source.name}</strong><small>{source.role} · {source.kind} · {source.coverageState} · {source.textCharacters.toLocaleString()} chars</small></div>
            <div className="source-actions">
              <select aria-label={'Role for ' + source.name} onChange={(event) => props.onChangeRole(source.id, event.target.value)} value={source.role}>
                <option value="canon">Canon</option><option value="reference">Reference</option><option value="inspiration">Inspiration</option><option value="format_only">Format only</option>
              </select>
              <button aria-label={'Remove ' + source.name} onClick={() => props.onRemove(source)} type="button">Remove</button>
              <code>{source.contentHash.slice(0, 10)}</code>
            </div>
          </article>
        )) : <p className="empty-ledger">No sources yet. A compact premise can still produce a review draft, while supplied primary evidence remains authoritative.</p>}
      </section>
      <StepActions back="Back to spark" next="Continue to creator locks" onBack={props.onBack} onNext={props.onContinue} />
    </>
  );
}

function LocksStep(props: {
  contentBoundary: string;
  locksText: string;
  playerBoundary: string;
  publicDemoMode: boolean;
  researchApproved: boolean;
  researchEnabled: boolean;
  setContentBoundary: (value: string) => void;
  setLocksText: (value: string) => void;
  setPlayerBoundary: (value: string) => void;
  setResearchApproved: (value: boolean) => void;
  setResearchEnabled: (value: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <>
      <StepHeading number="03" overline="CREATOR AUTHORITY" title="What must remain yours?" description="Locks are not a questionnaire. Name only the facts, vetoes, and identity choices the Forge may not revise." />
      <div className="locks-grid">
        <label className="full-field"><span>Creator locks · one per line</span><textarea onChange={(event) => props.setLocksText(event.target.value)} placeholder="Preserve the protagonist's adult human identity.&#10;Keep reserve distinct from cruelty or incompetence.&#10;Never supply the participant's appearance." value={props.locksText} /></label>
        <label className="full-field"><span>Player boundary</span><textarea className="compact-textarea" onChange={(event) => props.setPlayerBoundary(event.target.value)} value={props.playerBoundary} /></label>
        <label><span>Content lane</span><select onChange={(event) => props.setContentBoundary(event.target.value)} value={props.contentBoundary}><option value="general">General / adaptable</option><option value="mature_18_plus">Mature · confirmed adults only</option><option value="mixed_private">Mixed private project</option></select></label>
      </div>
      {!props.publicDemoMode ? <section className="research-control">
        <label className="cost-approval always"><input checked={props.researchApproved} onChange={(event) => props.setResearchApproved(event.target.checked)} type="checkbox" /><span>I approve separate OpenAI API charges and stored response recovery. The run may send readable source excerpts and attached image pixels to OpenAI as private evidence. The Forge requests deletion after saving my private receipt and records whether the provider confirms, rejects, leaves pending, or cannot confirm deletion. This approval does not publish anything.</span></label>
        <label className="switch-row"><input checked={props.researchEnabled} onChange={(event) => props.setResearchEnabled(event.target.checked)} type="checkbox" /><span /><div><strong>Use live web research</strong><small>Off by default. Adds current external grounding when the concept needs it.</small></div></label>
        {props.researchEnabled ? (
          <p className="research-cost-note">Web search adds its own usage charges. Research remains evidence, never canon.</p>
        ) : null}
      </section> : <section className="research-control"><p className="research-cost-note">Paid processing and live research controls are unavailable in public demonstration mode. The completed guided review remains available at no cost.</p></section>}
      <div className="boundary-note"><strong>The Forge can decide boldly.</strong><p>It asks only when two strong answers materially alter your premise, identity, rating, relationship contract, or canon direction.</p></div>
      <StepActions back="Back to sources" next="Lock and inspect the work order" onBack={props.onBack} onNext={props.onContinue} />
    </>
  );
}

function QuamputeStep(props: {
  anchor: ForgeAnchor | undefined;
  engine: Session['engine'] | null;
  project: Project;
  researchApproved: boolean;
  researchEnabled: boolean;
  runningRuns: RunReceipt[];
  uncertainRuns: RunReceipt[];
  sourceCount: number;
  onAbandon: (run: RunReceipt) => void;
  onBack: () => void;
  onOpenDemo: () => void;
  onRebase: () => void;
  onRun: () => void;
}) {
  const forgeCurrent = props.anchor?.revisionId === props.project.forgeRevisionId;
  const activeRunning = props.runningRuns[0];
  const ready = Boolean(props.engine?.configured) && !props.engine?.demoMode && props.uncertainRuns.length === 0
    && (activeRunning
      ? true
      : props.anchor?.status === 'verified' && forgeCurrent && props.researchApproved);
  return (
    <>
      <StepHeading number="04" overline="THE PASS" title="Quampute the living system." description="One bounded review preserves the premise, examines relevant evidence, forms provisional conclusions, and returns only decisions that need human input." />
      <div className="pass-map">
        <article><span>FRAME</span><strong>Scope and ownership</strong><p>Define the task, evidence owners, protected choices, exclusions, and review boundary.</p></article>
        <i>→</i>
        <article><span>MODEL</span><strong>Dependencies and behavior</strong><p>Represent constraints, causal links, uncertainty, failure modes, and observable effects.</p></article>
        <i>→</i>
        <article><span>PEOPLE</span><strong>Participant context</strong><p>Keep distinct perspectives, capabilities, relationships, information access, and decisions visible.</p></article>
      </div>
      <section className="work-order">
        <div className="mini-heading"><p>WORK ORDER RECEIPT</p><span>revision {props.project.revision}</span></div>
        <dl>
          <div><dt>Build</dt><dd>{props.project.buildType}</dd></div>
          <div><dt>Sources</dt><dd>{props.sourceCount}</dd></div>
          <div><dt>Creator locks</dt><dd>{props.project.locks.length}</dd></div>
          <div><dt>Forge</dt><dd>{props.anchor?.verifiedTabCount ?? 0} / {props.anchor?.expectedTabCount ?? 29} verified</dd></div>
          <div><dt>API cost</dt><dd>{props.engine?.demoMode ? 'Disabled in public demo' : activeRunning ? 'Already claimed · recovery only' : props.researchApproved ? 'Explicitly approved' : 'Approval required'}</dd></div>
          <div><dt>Research</dt><dd>{props.researchEnabled ? 'Enabled · additional search usage' : 'Off · no web-search charge'}</dd></div>
          <div><dt>Output</dt><dd>pre_quampute_v1 · review candidate</dd></div>
        </dl>
      </section>
      {props.engine?.demoMode ? (
        <section className="engine-blocker">
          <span>$0</span><div><strong>Paid runs are disabled in this public demonstration.</strong><p>Open the completed no-cost example to inspect Review and Export. Even an accidentally configured server key cannot start a provider request here.</p></div>
        </section>
      ) : !props.engine?.configured ? (
        <section className="engine-blocker">
          <span>KEY</span><div><strong>The studio is built; the live mind still needs its server secret.</strong><p>Configure OPENAI_API_KEY through the private Sites secret flow. Never paste the key into the page or this chat.</p></div>
        </section>
      ) : null}
      {props.engine?.configured && !props.researchApproved && !activeRunning ? (
        <section className="engine-blocker">
          <span>$</span><div><strong>Cost approval is still reserved for you.</strong><p>Return to Creator Locks and approve separately billed OpenAI API usage before the run button can activate.</p></div>
        </section>
      ) : null}
      {!forgeCurrent ? (
        <section className="engine-blocker">
          <span>↻</span><div><strong>This work order is pinned to an older Forge.</strong><p>{activeRunning ? 'Its active run retains the exact pinned validation receipt. Resume and save that already-paid result before deciding whether to rebase.' : 'Rebase deliberately to the currently verified 29-tab revision before any paid model call.'}</p>{!activeRunning ? <button className="secondary-action" onClick={props.onRebase} type="button">Rebase to verified Forge</button> : null}</div>
        </section>
      ) : null}
      {props.uncertainRuns.length ? (
        <section className="engine-blocker uncertain-run-blocker">
          <span>?</span><div><strong>An earlier paid request has an uncertain provider state.</strong><p>The Forge has frozen this exact snapshot so it cannot charge twice automatically. Deliberate abandonment commits only after a durable provider handle exists and the provider confirms that its stored response was deleted or absent; a later fresh run may still create another charge.</p>{props.uncertainRuns.map((run) => <button className="secondary-action" key={run.id} onClick={() => props.onAbandon(run)} type="button">Review and clean up trace {run.traceId || run.id}</button>)}</div>
        </section>
      ) : null}
      {activeRunning ? (
        <section className="engine-blocker">
          <span>↻</span><div><strong>A paid pre-Quampute is already active.</strong><p>{forgeCurrent ? `This work order is frozen at revision ${activeRunning.projectRevision}. Resume it with the same snapshot; the Forge will retrieve its existing provider response instead of starting a second paid request.` : 'The Forge will retrieve and validate this response against its stored older-Forge receipt; it will not start a second request. Emergency abandonment is cleanup-first and cannot commit without a durable provider handle.'}</p>{!forgeCurrent ? <button className="secondary-action" onClick={() => props.onAbandon(activeRunning)} type="button">Emergency cleanup and abandon trace {activeRunning.traceId || activeRunning.id}</button> : null}</div>
        </section>
      ) : null}
      <div className="run-action">
        <button className="primary-action forge-run" disabled={!ready && !props.engine?.demoMode} onClick={props.engine?.demoMode ? props.onOpenDemo : props.onRun} type="button"><span>✦</span>{props.engine?.demoMode ? 'Open the $0 completed review' : ready ? activeRunning ? forgeCurrent ? 'Resume active pre-Quampute' : 'Resume pinned active pre-Quampute' : 'Run pre-Quampute' : props.uncertainRuns.length ? 'Reconcile uncertain run' : !forgeCurrent ? 'Forge rebase required' : !props.engine?.configured ? 'Engine activation required' : 'API cost approval required'}</button>
        <small>{props.engine?.externalProcessing}</small>
        <small>The Forge requests deletion of the stored response after the private receipt is saved. The result records whether deletion was confirmed, rejected, still pending, or unknown; it never invents a retention-expiry date. Background mode is not Zero Data Retention compatible.</small>
        <small><strong>You can keep this page open for the fastest handoff.</strong> After a recovery handle is pinned, closing the page is recoverable by returning to the unchanged work order and run key. If acknowledgement is lost before that handle is pinned, the Forge freezes the trace for deliberate reconciliation and never sends an automatic duplicate.</small>
      </div>
      {!activeRunning && props.uncertainRuns.length === 0 ? <StepActions back="Back to locks" onBack={props.onBack} /> : null}
    </>
  );
}

function ReviewStep(props: {
  answers: Record<string, string>;
  filtered: Resolution[];
  filter: Status;
  result: QuamputeResult;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setFilter: (value: Status) => void;
  onBack: () => void;
  onExport: () => void;
  onSaveAnswers: () => void;
}) {
  return (
    <>
      <StepHeading number="05" overline="REVIEWABLE ACTUALITY" title="See what the Forge decided." description={props.result.conceptKernel.concisePremise} />
      <section className="qa-ribbon">
        <div><span>RUN</span><strong>{props.result.qa.runStatus}</strong></div>
        <div><span>TABS REPRESENTED</span><strong>{props.result.qa.coverage.representedTabs ?? props.result.qa.coverage.consideredTabs ?? 0} / {props.result.qa.coverage.expectedTabs}</strong></div>
        <div><span>FORGE EXCERPT</span><strong>{props.result.qa.coverage.totalCharacters ? Math.round(((props.result.qa.coverage.includedCharacters ?? 0) / props.result.qa.coverage.totalCharacters) * 100) + '% sampled' : 'legacy receipt'}</strong></div>
        <div><span>QUESTION ROUTES</span><strong>{props.result.qa.coverage.questionInventory ? props.result.qa.coverage.questionInventory.routed + ' / ' + props.result.qa.coverage.questionInventory.expected : 'legacy receipt'}</strong></div>
        <div><span>PROJECT STATE</span><strong>{humanize(props.result.qa.projectCompletion)}</strong></div>
        <div><span>RELEASE</span><strong>{props.result.qa.releaseEligible ? 'eligible' : 'not claimed'}</strong></div>
      </section>
      <div className="review-filters">
        {statuses.map((status) => <button className={props.filter === status ? 'selected' : ''} key={status} onClick={() => props.setFilter(status)} type="button">{status}<span>{status === 'all' ? props.result.resolutions.length : props.result.resolutions.filter((item) => item.status === status).length}</span></button>)}
      </div>
      <section className="resolution-ledger">
        {props.filtered.map((resolution) => (
          <details key={resolution.resolutionId}>
            <summary><span className={'status-token ' + tokenClass(resolution.status)}>{resolution.status}</span><div><strong>{resolution.category}</strong><p>{resolution.statement}</p></div><i>＋</i></summary>
            <div className="resolution-body">
              <p><strong>Why this answer:</strong>{resolution.justification}</p>
              {resolution.adaptationBridge ? <p><strong>Adaptation bridge:</strong>{resolution.adaptationBridge}</p> : null}
              {resolution.sceneSafeBoundary ? <p><strong>Safe boundary:</strong>{resolution.sceneSafeBoundary}</p> : null}
              <div className="receipt-pills">{resolution.evidenceRefs.map((ref) => <span key={ref}>{ref}</span>)}</div>
              <dl><div><dt>Compiles toward</dt><dd>{resolution.compilationTargets.join(', ') || 'not yet routed'}</dd></div><div><dt>Surfaces</dt><dd>{resolution.surfaces.join(', ')}</dd></div></dl>
            </div>
          </details>
        ))}
      </section>
      {props.result.questions.length ? (
        <section className="creator-questions">
          <div className="mini-heading"><p>HUMAN DECISION REQUIRED</p><span>{props.result.questions.length} / 6 max</span></div>
          {props.result.questions.map((question, index) => (
            <label key={question.questionId}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{question.factBeingDetermined}</strong><p>{question.meaning}</p><small>{humanize(question.whyCreatorMustAnswer)} · affects {question.affectedDependencies.join(', ')}</small><textarea onChange={(event) => props.setAnswers((current) => ({ ...current, [question.questionId]: event.target.value }))} placeholder="Your decision…" value={props.answers[question.questionId] ?? ''} /></div>
            </label>
          ))}
          <button className="secondary-action" onClick={props.onSaveAnswers} type="button">Save answers and keep this canonical Review open</button>
        </section>
      ) : null}
      {props.result.research.length ? (
        <section className="research-receipts"><div className="mini-heading"><p>RESEARCH RECEIPTS</p><span>{props.result.research.length}</span></div>{props.result.research.map((item) => <a href={item.url} key={item.researchId} rel="noreferrer" target="_blank"><strong>{item.title}</strong><p>{item.claimSupported}</p><small>{item.limitation}</small></a>)}</section>
      ) : null}
      <StepActions back="Inspect the pass" next="Export review package" onBack={props.onBack} onNext={props.onExport} />
    </>
  );
}

function ExportStep(props: { project: Project; result: QuamputeResult | null; onBack: () => void }) {
  return (
    <>
      <StepHeading number="06" overline="PORTABLE RECEIPT" title="Take the Forge work with you." description="Exports preserve the pinned Forge revision, source hashes, creator locks, provenance, resolutions, questions, propagation plan, and QA state." />
      <div className="export-grid">
        <a className="export-card" href={'/api/projects/' + props.project.id + '/export?format=json'}><span>{'{ }'}</span><div><strong>Structured JSON manifest</strong><p>Review state, source hashes, and provenance. It is not a backup of pasted text or uploaded files.</p></div><i>↓</i></a>
        <a className="export-card" href={'/api/projects/' + props.project.id + '/export?format=markdown'}><span>¶</span><div><strong>Review Markdown</strong><p>A human-readable work order with provenance and QA receipts.</p></div><i>↓</i></a>
      </div>
      <section className="release-truth">
        <strong>Honest completion state</strong>
        <p>{props.result ? humanize(props.result.qa.projectCompletion) : 'No Quampute run yet'}. Exported does not mean compiled, installed, runtime-tested, or public.</p>
      </section>
      <StepActions back="Back to review" onBack={props.onBack} />
    </>
  );
}

function EmptyReview({ onRun }: { onRun: () => void }) {
  return <section className="empty-review"><span>✦</span><h2>No review candidate exists yet.</h2><p>Run the pre-Quampute pass first. The Forge will not pretend an ungenerated result is complete.</p><button className="primary-action" onClick={onRun} type="button">Return to the pass</button></section>;
}

function StepHeading({ number, overline, title, description }: { number: string; overline: string; title: string; description: string }) {
  return <><div className="section-kicker"><span>{number}</span><p>{overline}</p></div><div className="step-heading"><h1>{title}</h1><p>{description}</p></div></>;
}

function StepActions({ back, next, onBack, onNext }: { back: string; next?: string; onBack: () => void; onNext?: () => void }) {
  return <div className="step-actions"><button className="quiet-action" onClick={onBack} type="button">← {back}</button>{next && onNext ? <button className="primary-action" onClick={onNext} type="button">{next}<span>→</span></button> : null}</div>;
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & ApiFailure;
  if (!response.ok) throw new Error(data.error?.message || 'The Forge request failed.');
  return data;
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : 'Something interrupted the Forge.';
}

function projectToolSummary(project: Project) {
  return {
    id: project.id,
    title: project.title,
    buildType: project.buildType,
    status: project.status,
    revision: project.revision,
    locksRevision: project.locksRevision,
    concept: project.concept,
    locks: [...project.locks],
    playerBoundary: project.playerBoundary,
    contentBoundary: project.contentBoundary,
    forgeRevisionId: project.forgeRevisionId,
    sourceResultAvailable: Boolean(project.result),
    researchEnabled: project.researchEnabled,
    costApproved: project.researchCostApproved,
    updatedAt: project.updatedAt,
  };
}

function sourceToolSummary(source: Source) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    role: source.role,
    authority: source.authority,
    readStatus: source.readStatus,
    coverageState: source.coverageState,
    textCharacters: source.textCharacters,
    contentHash: source.contentHash,
  };
}

function requiredString(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${field} must be between ${min} and ${max} characters.`);
  return text;
}

function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error('Optional text input must be text.');
  const text = value.trim();
  if (text.length > max) throw new Error(`Optional text input must be no longer than ${max} characters.`);
  return text;
}

function enumInput<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`${field} must be one of: ${values.join(', ')}.`);
  return value as T[number];
}

function buildTypeInput(value: unknown): BuildType {
  if (typeof value !== 'string') throw new Error('buildType must be text.');
  const match = buildTypes.find((item) => item.toLowerCase() === value.toLowerCase());
  if (!match) throw new Error(`buildType must be one of: ${buildTypes.join(', ')}.`);
  return match;
}

function stringArrayInput(value: unknown, field: string, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of at most ${maxItems} text values.`);
  }
  if (value.some((item) => item.length > maxLength || !item.trim())) {
    throw new Error(`${field} values must be non-empty and no longer than ${maxLength} characters.`);
  }
  return value.map((item) => item.trim());
}

function integerInput(value: unknown, min: number, max: number, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`Number must be between ${min} and ${max}.`);
  return Number(value);
}

function shortRevision(value: string | undefined) {
  if (!value) return 'Checking…';
  return value.slice(0, 8) + '…' + value.slice(-6);
}

function humanize(value: string) {
  return value.replaceAll('_', ' ');
}

function tokenClass(status: Resolution['status']) {
  return status.replaceAll('_', '-');
}

class PaidRunError extends Error {
  constructor(message: string, readonly preserveKey: boolean) {
    super(message);
  }
}

function getOrCreateRunKey(storageKey: string, projectId: string) {
  const prefix = `moth-forge:paid-run:${projectId}:`;
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix) && key !== storageKey) localStorage.removeItem(key);
    }
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    const existing = volatileRunKeys.get(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    volatileRunKeys.set(storageKey, created);
    return created;
  }
}

const volatileRunKeys = new Map<string, string>();

function removeRunKey(storageKey: string) {
  volatileRunKeys.delete(storageKey);
  try { localStorage.removeItem(storageKey); } catch { /* in-memory cleanup is enough */ }
}

function clearProjectRunKeys(projectId: string) {
  const prefix = `moth-forge:paid-run:${projectId}:`;
  for (const key of volatileRunKeys.keys()) if (key.startsWith(prefix)) volatileRunKeys.delete(key);
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // The server's input-hash single-flight still prevents duplicate paid calls.
  }
}

async function requestQuamputeResult(projectId: string, idempotencyKey: string, researchEnabled: boolean) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`/api/projects/${projectId}/quampute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ idempotencyKey, researchEnabled }),
      });
    } catch {
      throw new PaidRunError('The connection dropped while Quampute was running. The unchanged run key was preserved for recovery.', true);
    }
    const data = await response.json().catch(() => null) as (({ ok: true; pending?: boolean; result?: QuamputeResult } & ApiFailure) | null);
    if (!response.ok) {
      const ambiguousTransport = response.status === 408 || response.status === 429 || response.status >= 500;
      const preserveKey = data?.error?.preserveIdempotencyKey === true || data === null || ambiguousTransport;
      const trace = data?.error?.traceId ? ` Trace: ${data.error.traceId}` : '';
      throw new PaidRunError((data?.error?.message || 'The Forge request failed before its receipt could be read.') + trace, preserveKey);
    }
    if (!data) throw new PaidRunError('The Forge returned an unreadable receipt. The unchanged run key was preserved for recovery.', true);
    if (data.result) return data.result;
    if (!data.pending) throw new PaidRunError('The run returned without a result or a pending receipt.', false);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new PaidRunError('The run is still active. Its recovery key was preserved; return to this work order and try once more.', true);
}

function capitalizeBuildType(value: string): BuildType {
  const match = buildTypes.find((type) => type.toLowerCase() === value.toLowerCase());
  return match ?? 'Character';
}
