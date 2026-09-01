import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/ensure-schema';
import { getOwnerContext, isPublicDemoMode } from '@/lib/server/auth';
import { forgeQuestions, verifyForgeAnchor } from '@/lib/server/forge-anchor';
import { GUIDED_DEMO_EVIDENCE, isCanonicalNoCostGuidedDemo } from '@/lib/server/guided-demo-state';
import { apiError, hashText, nowIso, parseJson } from '@/lib/server/http';
import { listOwnedSourceSummaries, projectDto, sourceDto } from '@/lib/server/projects';
import { validateQuamputeOutput } from '@/lib/server/quampute-schema';

const DEMO_TITLE = 'Guided WebMCP Example — Museum Night v2';
const DEMO_CONCEPT = 'An impeccably dressed adult museum registrar is mistaken for cold and judgmental, while his dry literal humor and quiet acts of care keep turning a routine night inventory into slow-burn workplace comedy. The first person to understand him is intentionally unspecified.';
const DEMO_LOCKS = [
  'He is an adult human whose immaculate presentation and reserve must not be mistaken for cruelty.',
  'His precision must coexist with warmth, dry humor, competence, and an independent life.',
  'Comedy comes from social misreading and over-formal habits, never humiliation or forced incompetence.',
];
const DEMO_PLAYER_BOUNDARY = 'Do not supply actions, inner states, speech, appearance, or permission on behalf of the participant.';
const DEMO_SOURCE_TEXT = 'Creator note: Keep the character adult, reserved, capable, quietly caring, and unintentionally funny. Leave participant decisions open. Let trust, disagreement, and affiliation emerge from interaction. The first person to recognize his quiet care remains unresolved until the creator chooses that role or leaves discovery open for play.';
const PUBLIC_DEMO_TOTAL_PROJECT_LIMIT = 3;
const PUBLIC_DEMO_SOURCE_SLOT_LIMIT = 12;
const GUIDED_SOURCE_UPSERT_SQL = `INSERT INTO sources (
  id, project_id, owner_id, name, kind, role, authority, visibility, uri, r2_key,
  text_content, content_hash, read_status, coverage_state, metadata_json, created_at, updated_at
) SELECT ?, ?, ?, 'Creator intent note', 'text', 'canon', 'creator_source',
  'creator_only', NULL, NULL, ?, ?, 'verified_full', 'ready', ?, ?, ?
WHERE (
  ? = 0 OR EXISTS (
    SELECT 1 FROM sources WHERE id = ? AND project_id = ? AND owner_id = ?
  ) OR ((
    SELECT COUNT(*) FROM sources WHERE owner_id = ?
  ) + (
    SELECT COUNT(*) FROM pending_file_deletions WHERE owner_id = ?
  )) < ?
) AND NOT EXISTS (
  SELECT 1 FROM runs WHERE project_id = ? AND owner_id = ? AND status IN ('running', 'unknown')
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, kind = excluded.kind, role = excluded.role,
  authority = excluded.authority, visibility = excluded.visibility, uri = NULL, r2_key = NULL,
  text_content = excluded.text_content, content_hash = excluded.content_hash,
  read_status = excluded.read_status, coverage_state = excluded.coverage_state,
  metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
WHERE sources.project_id = excluded.project_id AND sources.owner_id = excluded.owner_id`;
const GUIDED_PROJECT_RESET_SQL = `UPDATE projects SET title = ?, build_type = 'character', concept = ?, status = 'review',
  revision = 1, locks_revision = 1, forge_document_id = ?, forge_revision_id = ?, forge_manifest_hash = ?,
  player_boundary = ?, content_boundary = 'general', authority_map_json = '[]', locks_json = ?,
  result_json = ?, qa_json = ?, research_enabled = 0, research_cost_approved = 0,
  processing_consent_version = 0, updated_at = ?
  WHERE id = ? AND owner_id = ?
    AND EXISTS (
      SELECT 1 FROM sources WHERE id = ? AND project_id = ? AND owner_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM runs WHERE project_id = ? AND owner_id = ? AND status IN ('running', 'unknown')
    )`;
const GUIDED_SOURCE_REPAIR_REVISION_SQL = `UPDATE projects SET revision = revision + 1, updated_at = ?
  WHERE id = ? AND owner_id = ? AND revision = ? AND locks_revision = ?
    AND EXISTS (
      SELECT 1 FROM sources WHERE id = ? AND project_id = ? AND owner_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM runs WHERE project_id = ? AND owner_id = ? AND status IN ('running', 'unknown')
    )`;

function guidedSourceUpsert(input: {
  sourceId: string;
  projectId: string;
  ownerId: string;
  sourceHash: string;
  now: string;
}) {
  return env.DB.prepare(GUIDED_SOURCE_UPSERT_SQL)
    .bind(
      input.sourceId, input.projectId, input.ownerId, DEMO_SOURCE_TEXT, input.sourceHash,
      JSON.stringify({ syntheticDemo: true, modelCall: false }), input.now, input.now,
      isPublicDemoMode() ? 1 : 0,
      input.sourceId, input.projectId, input.ownerId,
      input.ownerId, input.ownerId, PUBLIC_DEMO_SOURCE_SLOT_LIMIT,
      input.projectId, input.ownerId,
    );
}

async function guidedRepairError(projectId: string, ownerId: string, sourceId: string) {
  const active = await env.DB.prepare(`SELECT 1 AS present FROM runs
    WHERE project_id = ? AND owner_id = ? AND status IN ('running', 'unknown') LIMIT 1`)
    .bind(projectId, ownerId).first<{ present: number }>();
  if (active) {
    return apiError('RUN_SUPERSEDED', 'The guided example could not be repaired while another run was active.', 409, 'demo');
  }
  const availability = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM sources WHERE id = ? AND project_id = ? AND owner_id = ?) AS canonical_present,
      (SELECT COUNT(*) FROM sources WHERE owner_id = ?)
        + (SELECT COUNT(*) FROM pending_file_deletions WHERE owner_id = ?) AS occupied_slots`)
    .bind(sourceId, projectId, ownerId, ownerId, ownerId)
    .first<{ canonical_present: number; occupied_slots: number }>();
  if (isPublicDemoMode() && !availability?.canonical_present
    && Number(availability?.occupied_slots ?? PUBLIC_DEMO_SOURCE_SLOT_LIMIT) >= PUBLIC_DEMO_SOURCE_SLOT_LIMIT) {
    return apiError('RATE_LIMITED', `Repairing the guided example would exceed the ${PUBLIC_DEMO_SOURCE_SLOT_LIMIT}-slot public evidence limit. The existing project was not reset.`, 429, 'demo');
  }
  return apiError('OUTPUT_INVALID', 'The guided example repair did not persist a complete canonical source and project pair.', 500, 'demo');
}

export async function POST() {
  const owner = await getOwnerContext();
  if (!owner) return apiError('UNAUTHORIZED', 'Sign in to open your private guided example.', 401, 'authentication');

  await ensureSchema();
  const anchor = await verifyForgeAnchor();
  if (anchor.status !== 'verified') {
    return apiError('FORGE_PARTIAL', 'The demonstration authority pack did not pass integrity verification.', 409, 'anchor');
  }

  const demoIdentityHash = await hashText(`${owner.ownerId}\n${anchor.manifestHash}\n${DEMO_TITLE}`);
  const projectId = `guided-demo-${demoIdentityHash.slice(0, 32)}`;
  const sourceId = `guided-source-${demoIdentityHash.slice(32)}`;

  const now = nowIso();
  const [conceptHash, sourceHash] = await Promise.all([hashText(DEMO_CONCEPT), hashText(DEMO_SOURCE_TEXT)]);
  const result = buildDemoResult({ projectId, concept: DEMO_CONCEPT, conceptHash, anchor, sourceId, sourceHash, sourceCharacters: DEMO_SOURCE_TEXT.length });
  if (!validateQuamputeOutput(result) || !isCanonicalNoCostGuidedDemo(result)) {
    return apiError('OUTPUT_INVALID', 'The guided example failed its result-schema or evidence-provenance gate.', 500, 'demo');
  }

  const existing = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ? LIMIT 1')
    .bind(projectId, owner.ownerId)
    .first();
  const existingResult = existing && typeof existing.result_json === 'string'
    ? parseJson<Record<string, unknown> | null>(existing.result_json, null)
    : null;
  if (existing && existing.status === 'review'
    && existing.forge_revision_id === anchor.revisionId
    && existing.forge_manifest_hash === anchor.manifestHash
    && isVerifiedGuidedDemo(existingResult)) {
    const sources = await listOwnedSourceSummaries(String(existing.id), owner.ownerId);
    if (sources.some((source) => source.id === sourceId)) {
      return NextResponse.json({ ok: true, created: false, repaired: false, project: projectDto(existing as never), sources: sources.map(sourceDto), runs: [] });
    }
    const sourceRepair = await env.DB.batch([
      guidedSourceUpsert({ sourceId, projectId, ownerId: owner.ownerId, sourceHash, now }),
      env.DB.prepare(GUIDED_SOURCE_REPAIR_REVISION_SQL).bind(
        now, projectId, owner.ownerId, existing.revision, existing.locks_revision,
        sourceId, projectId, owner.ownerId,
        projectId, owner.ownerId,
      ),
    ]);
    const repairedProject = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
      .bind(projectId, owner.ownerId).first();
    const repairedSources = await listOwnedSourceSummaries(projectId, owner.ownerId);
    if (Number((sourceRepair[0].meta as { changes?: number }).changes ?? 0) !== 1
      || Number((sourceRepair[1].meta as { changes?: number }).changes ?? 0) !== 1
      || !repairedProject
      || !repairedSources.some((source) => source.id === sourceId)) {
      return guidedRepairError(projectId, owner.ownerId, sourceId);
    }
    return NextResponse.json({ ok: true, created: false, repaired: true, project: projectDto(repairedProject as never), sources: repairedSources.map(sourceDto), runs: [] });
  }
  if (existing && !isPublicDemoMode()) {
    return apiError('OUTPUT_INVALID', 'The private guided example exists but failed its no-cost result receipt.', 409, 'demo');
  }
  if (existing) {
    const repaired = await env.DB.batch([
      guidedSourceUpsert({ sourceId, projectId, ownerId: owner.ownerId, sourceHash, now }),
      env.DB.prepare(GUIDED_PROJECT_RESET_SQL)
        .bind(
          DEMO_TITLE, DEMO_CONCEPT, anchor.documentId, anchor.revisionId, anchor.manifestHash,
          DEMO_PLAYER_BOUNDARY, JSON.stringify(DEMO_LOCKS), JSON.stringify(result), JSON.stringify(result.qa), now,
          projectId, owner.ownerId,
          sourceId, projectId, owner.ownerId,
          projectId, owner.ownerId,
        ),
    ]);
    if (Number((repaired[1].meta as { changes?: number }).changes ?? 0) !== 1) {
      return guidedRepairError(projectId, owner.ownerId, sourceId);
    }
    const repairedProject = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
      .bind(projectId, owner.ownerId).first();
    const repairedSources = await listOwnedSourceSummaries(projectId, owner.ownerId);
    const repairedResult = repairedProject && typeof repairedProject.result_json === 'string'
      ? parseJson<Record<string, unknown> | null>(repairedProject.result_json, null)
      : null;
    if (!repairedProject || !isVerifiedGuidedDemo(repairedResult)) {
      return apiError('OUTPUT_INVALID', 'The guided example reset did not produce a complete no-cost receipt.', 500, 'demo');
    }
    if (!repairedSources.some((source) => source.id === sourceId)) {
      return isPublicDemoMode()
        ? apiError('RATE_LIMITED', `Repairing the guided example would exceed the ${PUBLIC_DEMO_SOURCE_SLOT_LIMIT}-slot public evidence limit.`, 429, 'demo')
        : apiError('OUTPUT_INVALID', 'The guided example reset could not restore its canonical source.', 500, 'demo');
    }
    return NextResponse.json({ ok: true, created: false, repaired: true, project: projectDto(repairedProject as never), sources: repairedSources.map(sourceDto), runs: [] });
  }

  const writes = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO projects (
      id, owner_id, title, build_type, concept, status, revision, locks_revision,
      forge_document_id, forge_revision_id, forge_manifest_hash,
      player_boundary, content_boundary, authority_map_json, locks_json, answers_json,
      result_json, qa_json, research_enabled, research_cost_approved, created_at, updated_at
    ) SELECT ?, ?, ?, 'character', ?, 'review', 1, 1, ?, ?, ?, ?, 'general', '[]', ?, '[]', ?, ?, 0, 0, ?, ?
      WHERE ? = 0 OR ((
        SELECT COUNT(*) FROM projects WHERE owner_id = ?
      ) < ? AND (
        (SELECT COUNT(*) FROM sources WHERE owner_id = ?)
        + (SELECT COUNT(*) FROM pending_file_deletions WHERE owner_id = ?)
      ) < ?)`)
      .bind(
        projectId, owner.ownerId, DEMO_TITLE, DEMO_CONCEPT,
        anchor.documentId, anchor.revisionId, anchor.manifestHash,
        DEMO_PLAYER_BOUNDARY,
        JSON.stringify(DEMO_LOCKS), JSON.stringify(result), JSON.stringify(result.qa), now, now,
        isPublicDemoMode() ? 1 : 0,
        owner.ownerId, PUBLIC_DEMO_TOTAL_PROJECT_LIMIT,
        owner.ownerId, owner.ownerId, PUBLIC_DEMO_SOURCE_SLOT_LIMIT,
      ),
    env.DB.prepare(`INSERT OR IGNORE INTO sources (
      id, project_id, owner_id, name, kind, role, authority, visibility, uri, r2_key,
      text_content, content_hash, read_status, coverage_state, metadata_json, created_at, updated_at
    ) SELECT ?, ?, ?, 'Creator intent note', 'text', 'canon', 'creator_source',
      'creator_only', NULL, NULL, ?, ?, 'verified_full', 'ready', ?, ?, ?
      FROM projects WHERE id = ? AND owner_id = ?`)
      .bind(
        sourceId, projectId, owner.ownerId, DEMO_SOURCE_TEXT, sourceHash,
        JSON.stringify({ syntheticDemo: true, modelCall: false }), now, now,
        projectId, owner.ownerId,
      ),
  ]);
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
    .bind(projectId, owner.ownerId).first();
  if (!project) {
    return apiError(
      'RATE_LIMITED',
      `The public demo keeps up to ${PUBLIC_DEMO_TOTAL_PROJECT_LIMIT} private records and ${PUBLIC_DEMO_SOURCE_SLOT_LIMIT} occupied evidence slots per account.`,
      429,
      'demo',
    );
  }
  const sources = await listOwnedSourceSummaries(projectId, owner.ownerId);
  const storedResult = typeof project.result_json === 'string'
    ? parseJson<Record<string, unknown> | null>(project.result_json, null)
    : null;
  if (!isVerifiedGuidedDemo(storedResult) || !sources.some((source) => source.id === sourceId)) {
    if (Number((writes[0].meta as { changes?: number }).changes ?? 0) === 1) {
      await env.DB.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?')
        .bind(projectId, owner.ownerId).run();
    }
    return apiError('OUTPUT_INVALID', 'The guided example could not persist a complete no-cost receipt.', 500, 'demo');
  }
  const created = Number((writes[0].meta as { changes?: number }).changes ?? 0) === 1;
  return NextResponse.json({ ok: true, created, repaired: false, project: projectDto(project as never), sources: sources.map(sourceDto), runs: [] }, { status: created ? 201 : 200 });
}

function buildDemoResult(input: {
  projectId: string;
  concept: string;
  conceptHash: string;
  anchor: Awaited<ReturnType<typeof verifyForgeAnchor>>;
  sourceId: string;
  sourceHash: string;
  sourceCharacters: number;
}) {
  const demoRouteSpecs = [
    { category: 'Identity', publicQuestionId: 'SYN-01-01', tabTerms: ['person', 'identity'], promptTerms: ['identity', 'character', 'stable'] },
    { category: 'Embodiment', publicQuestionId: 'SYN-17-01', tabTerms: ['person', 'embodiment', 'body'], promptTerms: ['physical', 'sensory', 'movement', 'character', 'appearance'] },
    { category: 'Voice', publicQuestionId: 'SYN-16-01', tabTerms: ['voice', 'speech'], promptTerms: ['speech', 'rhythms', 'word choices', 'character'] },
    { category: 'Ordinary life', publicQuestionId: 'SYN-25-01', tabTerms: ['adult life', 'ordinary'], promptTerms: ['routines', 'responsibilities', 'interests', 'relationships', 'character', 'life'] },
    { category: 'Comedy', publicQuestionId: 'SYN-10-01', tabTerms: ['comedy', 'humor'], promptTerms: ['character', 'humor', 'comic', 'competence', 'dignity'] },
    { category: 'Agency', publicQuestionId: 'SYN-12-01', tabTerms: ['agency', 'decision'], promptTerms: ['decisions', 'character', 'participants', 'open'] },
    { category: 'Relationship', publicQuestionId: 'SYN-03-01', tabTerms: ['relationship', 'social'], promptTerms: ['character', 'relationships', 'participant', 'response', 'automatic'] },
  ] as const;
  const publicSyntheticPack = forgeQuestions.some((question) => question.id.startsWith('SYN-'));
  const usedQuestionIds = new Set<string>();
  const demoQuestions = demoRouteSpecs.map((route) => {
    const candidates = publicSyntheticPack
      ? forgeQuestions.filter((question) => question.id === route.publicQuestionId)
      : forgeQuestions;
    const ranked = candidates
      .filter((question) => !usedQuestionIds.has(question.id))
      .map((question) => {
        const tab = question.tabTitle.toLowerCase();
        const prompt = question.question.toLowerCase();
        const promptMatches = route.promptTerms.filter((term) => prompt.includes(term)).length;
        const tabMatches = route.tabTerms.filter((term) => tab.includes(term)).length;
        return { question, promptMatches, tabMatches };
      })
      .sort((left, right) => right.promptMatches - left.promptMatches
        || right.tabMatches - left.tabMatches
        || left.question.id.localeCompare(right.question.id));
    const selected = ranked[0];
    const minimumPromptMatches = publicSyntheticPack ? Math.min(3, route.promptTerms.length) : 1;
    if (!selected || selected.promptMatches < minimumPromptMatches) {
      throw new Error(`The synthetic demo could not find prompt-level semantic evidence for its ${route.category} question route.`);
    }
    if (publicSyntheticPack && selected.question.id !== route.publicQuestionId) {
      throw new Error(`The public ${route.category} route did not resolve to ${route.publicQuestionId}.`);
    }
    usedQuestionIds.add(selected.question.id);
    return selected.question;
  });
  if (demoQuestions.length !== 7) throw new Error('The synthetic demo requires seven verified question routes.');
  const resolution = (
    resolutionId: string,
    category: string,
    status: 'confirmed' | 'derived' | 'reserved',
    statement: string,
    justification: string,
    compilationTargets: string[],
    questionIndex: number,
  ) => ({
    resolutionId,
    category,
    status,
    reviewState: status === 'reserved' ? 'reserved' : 'pending',
    subjectId: 'museum-registrar',
    statement,
    justification,
    evidenceRefs: [...GUIDED_DEMO_EVIDENCE[resolutionId as keyof typeof GUIDED_DEMO_EVIDENCE]],
    forgeQuestionIds: [demoQuestions[questionIndex].id],
    adaptationBridge: null,
    sceneSafeBoundary: status === 'reserved' ? 'Do not assign the first-recognition role until the creator chooses it or explicitly reserves discovery for play.' : null,
    dependencies: ['creator intent', 'adult identity', 'participant-choice boundary'],
    compilationTargets,
    surfaces: ['runtime'] as const,
    knowledgeAccess: [{ holder: 'narrator', access: 'truth' as const, carrier: compilationTargets[0] ?? null }],
  });

  return {
    schemaVersion: 'pre_quampute_v1',
    runId: 'guided-demo-no-model-call',
    projectId: input.projectId,
    runKind: 'guided_demo',
    buildShape: 'character',
    inputSnapshot: {
      projectRevision: 1,
      conceptRaw: input.concept,
      conceptHash: input.conceptHash,
      locksRevision: 1,
      forge: {
        documentId: input.anchor.documentId,
        revisionId: input.anchor.revisionId,
        manifestHash: input.anchor.manifestHash,
        expectedTabCount: input.anchor.expectedTabCount,
        verifiedTabCount: input.anchor.verifiedTabCount,
        totalCharacters: input.anchor.totalCharacters,
        questionCount: input.anchor.questionCount,
        verifiedAt: input.anchor.verifiedAt,
        status: input.anchor.status,
      },
      sources: [{ sourceId: input.sourceId, revisionOrHash: input.sourceHash, readStatus: 'verified_full', includedCharacters: input.sourceCharacters, truncated: false }],
    },
    processingReceipt: {
      provider: 'Deterministic local demonstration',
      background: false,
      storedForRecovery: false,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelCallMade: false,
    },
    conceptKernel: {
      concisePremise: 'A meticulous museum registrar whose quiet care keeps being mistaken for chilly judgment.',
      entities: [{ entityId: 'museum-registrar', name: 'The museum registrar', kind: 'adult character' }],
      creatorIntentKnown: ['Adult human character', 'Reserved and precise', 'Competent', 'Workplace comedy through social misreading'],
      unresolvedScope: ['Who first recognizes that his reserve and quiet care do not match the cold reputation?'],
    },
    sourceAssessment: { conflicts: [], unreadSources: [], promptInjectionDetected: false },
    resolutions: [
      resolution('R-DEMO-001', 'Identity', 'confirmed', 'He is an adult human whose immaculate presentation and reserve must not be treated as proof of cruelty.', 'This repeats the first creator lock without adding an inferred motive.', ['Identity profile'], 0),
      resolution('R-DEMO-002', 'Embodiment', 'derived', 'His immaculate dress makes him visually recognizable, while his care, competence, and humor prevent that marker from reducing him to appearance; sensory and movement details remain open.', 'The premise supplies immaculate dress, care, and humor, while the second lock supplies competence; neither source establishes sensory traits or movement habits.', ['Embodiment profile', 'Runtime constraints'], 1),
      resolution('R-DEMO-003', 'Voice', 'derived', 'His deliberate precision can support dry humor when literal observations contrast with quiet care.', 'The premise supplies dry literal humor and quiet care; the second lock supports precision without requiring a fixed speech formula.', ['Dialogue examples', 'Narrative style'], 2),
      resolution('R-DEMO-004', 'Ordinary life', 'derived', 'Night inventory and registrar duties establish a recurring responsibility; specific interests and off-shift relationships remain open rather than invented.', 'The premise supplies his registrar role and routine night inventory, while the second lock requires an independent life without specifying its interests or relationships.', ['Daily-life profile', 'World memory'], 3),
      resolution('R-DEMO-005', 'Comedy', 'confirmed', 'Comedy comes from social misreading and over-formal habits, never humiliation or forced incompetence.', 'This repeats the third creator lock.', ['Runtime constraints', 'Narrative style'], 4),
      resolution('R-DEMO-006', 'Participant choice', 'confirmed', 'The review leaves the participant’s appearance, inner state, speech, choices, and permission undefined.', 'This restates the project boundary without assigning conduct to either participant.', ['Participant-choice rules'], 5),
      resolution('R-DEMO-007', 'Relationship', 'reserved', 'The current evidence does not establish different behavior across relationships; it establishes coworkers’ misreading and leaves the first relationship that recognizes his quiet care unresolved.', 'The submitted premise supplies the workplace misreading and explicitly reserves the first-recognition relationship instead of making another participant’s response automatic.', ['Relationship memory', 'Opening scene'], 6),
    ],
    questions: [{
      questionId: 'creator-demo-first-recognition',
      factBeingDetermined: 'Who first recognizes that his reserve and quiet acts of care do not match the cold reputation?',
      meaning: 'This sets the first durable social counterweight without deciding the player response.',
      whyCreatorMustAnswer: 'reserved_field',
      requiredAnswerShape: ['Name a role, not the player reaction', 'Or explicitly reserve discovery for play'],
      affectedDependencies: ['Opener', 'Relationship web', 'Knowledge access'],
      blocking: false,
    }],
    research: [],
    propagationPlan: [
      { resolutionId: 'R-DEMO-001', destination: 'Identity profile', transformation: 'Compile presentation-versus-conduct contrast.', status: 'planned' },
      { resolutionId: 'R-DEMO-003', destination: 'Dialogue examples', transformation: 'Draft dialogue examples that test precise delivery with dry literal humor.', status: 'planned' },
      { resolutionId: 'R-DEMO-006', destination: 'Participant-choice rules', transformation: 'Carry the participant-choice boundary into every interactive surface.', status: 'planned' },
    ],
    qa: {
      runStatus: 'passed',
      projectCompletion: 'questionnaire_in_progress',
      releaseEligible: false,
      coverage: {
        expectedTabs: input.anchor.expectedTabCount,
        representedTabs: new Set(demoQuestions.map((question) => question.tabId)).size,
        fullyEvaluatedTabs: 0,
        includedCharacters: 0,
        totalCharacters: input.anchor.totalCharacters,
        coverageMode: 'sampled_prepass',
        questionInventory: { expected: input.anchor.questionCount, routed: demoQuestions.length },
        applicableAreas: ['Identity', 'Embodiment', 'Voice', 'Ordinary life', 'Comedy', 'Agency', 'Relationship'],
        evaluatedAreas: ['Identity', 'Embodiment', 'Voice', 'Ordinary life', 'Comedy', 'Agency', 'Relationship'],
      },
      gates: [
        { gate: 'Forge anchor integrity', status: 'pass', evidence: `${input.anchor.verifiedTabCount} / ${input.anchor.expectedTabCount} tabs verified.` },
        { gate: 'Paid execution', status: 'not_tested', evidence: 'This guided example made no model call and incurred no API cost.' },
        { gate: 'Creator authority', status: 'pass', evidence: 'One premise-changing fact remains explicitly reserved.' },
      ],
      blockers: [],
    },
    nextAction: { kind: 'review_resolutions', explanation: 'Review the seven routed resolutions and decide whether the first-recognition role should remain open for play.' },
    citations: [],
  };
}

function isVerifiedGuidedDemo(value: Record<string, unknown> | null) {
  return isCanonicalNoCostGuidedDemo(value) && validateQuamputeOutput(value);
}
