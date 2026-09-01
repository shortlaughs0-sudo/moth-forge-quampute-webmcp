export const quamputeOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'conceptKernel',
    'sourceAssessment',
    'resolutions',
    'questions',
    'research',
    'propagationPlan',
    'qa',
    'nextAction',
  ],
  properties: {
    conceptKernel: {
      type: 'object',
      additionalProperties: false,
      required: ['concisePremise', 'entities', 'creatorIntentKnown', 'unresolvedScope'],
      properties: {
        concisePremise: { type: 'string' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['entityId', 'name', 'kind'],
            properties: {
              entityId: { type: 'string' },
              name: { type: 'string' },
              kind: { type: 'string' },
            },
          },
        },
        creatorIntentKnown: { type: 'array', items: { type: 'string' } },
        unresolvedScope: { type: 'array', items: { type: 'string' } },
      },
    },
    sourceAssessment: {
      type: 'object',
      additionalProperties: false,
      required: ['conflicts', 'unreadSources', 'promptInjectionDetected'],
      properties: {
        conflicts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['conflictId', 'claim', 'evidenceRefs', 'blocking', 'requiredAuthority'],
            properties: {
              conflictId: { type: 'string' },
              claim: { type: 'string' },
              evidenceRefs: { type: 'array', items: { type: 'string' } },
              blocking: { type: 'boolean' },
              requiredAuthority: { type: 'string', enum: ['creator', 'steward'] },
            },
          },
        },
        unreadSources: { type: 'array', items: { type: 'string' } },
        promptInjectionDetected: { type: 'boolean' },
      },
    },
    resolutions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'resolutionId',
          'forgeQuestionIds',
          'subjectId',
          'category',
          'status',
          'statement',
          'justification',
          'evidenceRefs',
          'adaptationBridge',
          'sceneSafeBoundary',
          'dependencies',
          'compilationTargets',
          'surfaces',
          'knowledgeAccess',
          'reviewState',
        ],
        properties: {
          resolutionId: { type: 'string' },
          forgeQuestionIds: { type: 'array', items: { type: 'string' } },
          subjectId: { type: 'string' },
          category: { type: 'string' },
          status: { type: 'string', enum: ['confirmed', 'derived', 'adapted', 'reserved', 'not_applicable'] },
          statement: { type: 'string' },
          justification: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          adaptationBridge: { type: ['string', 'null'] },
          sceneSafeBoundary: { type: ['string', 'null'] },
          dependencies: { type: 'array', items: { type: 'string' } },
          compilationTargets: { type: 'array', items: { type: 'string' } },
          surfaces: {
            type: 'array',
            items: { type: 'string', enum: ['creator_meta', 'runtime', 'player_facing'] },
          },
          knowledgeAccess: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['holder', 'access', 'carrier'],
              properties: {
                holder: { type: 'string' },
                access: { type: 'string', enum: ['truth', 'knows', 'believes', 'rumor', 'unknown', 'restricted'] },
                carrier: { type: ['string', 'null'] },
              },
            },
          },
          reviewState: { type: 'string', enum: ['pending', 'reserved'] },
        },
      },
    },
    questions: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'questionId',
          'factBeingDetermined',
          'meaning',
          'whyCreatorMustAnswer',
          'requiredAnswerShape',
          'affectedDependencies',
          'blocking',
        ],
        properties: {
          questionId: { type: 'string' },
          factBeingDetermined: { type: 'string' },
          meaning: { type: 'string' },
          whyCreatorMustAnswer: {
            type: 'string',
            enum: ['premise_change', 'creator_intent', 'canon_conflict', 'reserved_field', 'high_support_tie'],
          },
          requiredAnswerShape: { type: 'array', items: { type: 'string' } },
          affectedDependencies: { type: 'array', items: { type: 'string' } },
          blocking: { type: 'boolean' },
        },
      },
    },
    research: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['researchId', 'query', 'url', 'title', 'publisher', 'fetchedAt', 'claimSupported', 'limitation', 'freshness', 'evidenceRef'],
        properties: {
          researchId: { type: 'string' },
          query: { type: 'string' },
          url: { type: 'string' },
          title: { type: 'string' },
          publisher: { type: 'string' },
          fetchedAt: { type: 'string' },
          claimSupported: { type: 'string' },
          limitation: { type: 'string' },
          freshness: { type: 'string', enum: ['current', 'dated', 'unknown'] },
          evidenceRef: { type: 'string' },
        },
      },
    },
    propagationPlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['resolutionId', 'destination', 'transformation', 'status'],
        properties: {
          resolutionId: { type: 'string' },
          destination: { type: 'string' },
          transformation: { type: 'string' },
          status: { type: 'string', enum: ['planned', 'blocked'] },
        },
      },
    },
    qa: {
      type: 'object',
      additionalProperties: false,
      required: ['runStatus', 'projectCompletion', 'releaseEligible', 'coverage', 'gates', 'blockers'],
      properties: {
        runStatus: { type: 'string', enum: ['passed', 'blocked', 'invalid', 'superseded'] },
        projectCompletion: {
          type: 'string',
          enum: ['source_anchored', 'questionnaire_in_progress'],
        },
        releaseEligible: { type: 'boolean' },
        coverage: {
          type: 'object',
          additionalProperties: false,
          required: [
            'expectedTabs',
            'representedTabs',
            'fullyEvaluatedTabs',
            'includedCharacters',
            'totalCharacters',
            'coverageMode',
            'questionInventory',
            'applicableAreas',
            'evaluatedAreas',
          ],
          properties: {
            expectedTabs: { type: 'integer' },
            representedTabs: { type: 'integer' },
            fullyEvaluatedTabs: { type: 'integer' },
            includedCharacters: { type: 'integer' },
            totalCharacters: { type: 'integer' },
            coverageMode: { type: 'string', enum: ['sampled_prepass'] },
            questionInventory: {
              type: 'object',
              additionalProperties: false,
              required: ['expected', 'routed'],
              properties: {
                expected: { type: 'integer' },
                routed: { type: 'integer' },
              },
            },
            applicableAreas: { type: 'array', items: { type: 'string' } },
            evaluatedAreas: { type: 'array', items: { type: 'string' } },
          },
        },
        gates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['gate', 'status', 'evidence'],
            properties: {
              gate: { type: 'string' },
              status: { type: 'string', enum: ['pass', 'fail', 'blocked', 'not_tested'] },
              evidence: { type: 'string' },
            },
          },
        },
        blockers: { type: 'array', items: { type: 'string' } },
      },
    },
    nextAction: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'explanation'],
      properties: {
        kind: { type: 'string', enum: ['answer_questions', 'review_resolutions', 'continue_quampute'] },
        explanation: { type: 'string' },
      },
    },
  },
} as const;

export type QuamputeModelOutput = {
  conceptKernel: {
    concisePremise: string;
    entities: Array<{ entityId: string; name: string; kind: string }>;
    creatorIntentKnown: string[];
    unresolvedScope: string[];
  };
  sourceAssessment: {
    conflicts: Array<{ conflictId: string; claim: string; evidenceRefs: string[]; blocking: boolean; requiredAuthority: 'creator' | 'steward' }>;
    unreadSources: string[];
    promptInjectionDetected: boolean;
  };
  resolutions: Array<{
    resolutionId: string;
    forgeQuestionIds: string[];
    subjectId: string;
    category: string;
    status: 'confirmed' | 'derived' | 'adapted' | 'reserved' | 'not_applicable';
    statement: string;
    justification: string;
    evidenceRefs: string[];
    adaptationBridge: string | null;
    sceneSafeBoundary: string | null;
    dependencies: string[];
    compilationTargets: string[];
    surfaces: Array<'creator_meta' | 'runtime' | 'player_facing'>;
    knowledgeAccess: Array<{ holder: string; access: 'truth' | 'knows' | 'believes' | 'rumor' | 'unknown' | 'restricted'; carrier: string | null }>;
    reviewState: 'pending' | 'reserved';
  }>;
  questions: Array<{
    questionId: string;
    factBeingDetermined: string;
    meaning: string;
    whyCreatorMustAnswer: 'premise_change' | 'creator_intent' | 'canon_conflict' | 'reserved_field' | 'high_support_tie';
    requiredAnswerShape: string[];
    affectedDependencies: string[];
    blocking: boolean;
  }>;
  research: Array<{
    researchId: string;
    query: string;
    url: string;
    title: string;
    publisher: string;
    fetchedAt: string;
    claimSupported: string;
    limitation: string;
    freshness: 'current' | 'dated' | 'unknown';
    evidenceRef: string;
  }>;
  propagationPlan: Array<{ resolutionId: string; destination: string; transformation: string; status: 'planned' | 'blocked' }>;
  qa: {
    runStatus: 'passed' | 'blocked' | 'invalid' | 'superseded';
    projectCompletion: 'source_anchored' | 'questionnaire_in_progress';
    releaseEligible: boolean;
    coverage: {
      expectedTabs: number;
      representedTabs: number;
      fullyEvaluatedTabs: number;
      includedCharacters: number;
      totalCharacters: number;
      coverageMode: 'sampled_prepass';
      questionInventory: { expected: number; routed: number };
      applicableAreas: string[];
      evaluatedAreas: string[];
    };
    gates: Array<{ gate: string; status: 'pass' | 'fail' | 'blocked' | 'not_tested'; evidence: string }>;
    blockers: string[];
  };
  nextAction: { kind: 'answer_questions' | 'review_resolutions' | 'continue_quampute'; explanation: string };
};

export function validateQuamputeOutput(value: unknown): value is QuamputeModelOutput {
  if (!value || typeof value !== 'object') return false;
  const output = value as Partial<QuamputeModelOutput>;
  if (!output.conceptKernel || !output.sourceAssessment || !Array.isArray(output.resolutions)) return false;
  if (!Array.isArray(output.questions) || output.questions.length > 6) return false;
  if (!Array.isArray(output.research) || !Array.isArray(output.propagationPlan) || !output.qa || !output.nextAction) return false;
  if (!nonBlank(output.conceptKernel.concisePremise)) return false;
  if (!stringArray(output.conceptKernel.creatorIntentKnown) || !stringArray(output.conceptKernel.unresolvedScope)) return false;
  if (!Array.isArray(output.conceptKernel.entities)
    || output.conceptKernel.entities.some((entity) => !isRecord(entity))
    || !uniqueNonBlankIds(output.conceptKernel.entities.map((entity) => entity.entityId))) return false;
  for (const entity of output.conceptKernel.entities) {
    if (!nonBlank(entity.name) || !nonBlank(entity.kind)) return false;
  }
  if (!Array.isArray(output.sourceAssessment.conflicts)
    || output.sourceAssessment.conflicts.some((conflict) => !isRecord(conflict))
    || !stringArray(output.sourceAssessment.unreadSources)) return false;
  if (typeof output.sourceAssessment.promptInjectionDetected !== 'boolean') return false;
  for (const conflict of output.sourceAssessment.conflicts) {
    if (!nonBlank(conflict.conflictId) || !nonBlank(conflict.claim) || !nonEmptyStrings(conflict.evidenceRefs)) return false;
    if (typeof conflict.blocking !== 'boolean' || !inEnum(conflict.requiredAuthority, ['creator', 'steward'])) return false;
  }
  if (output.resolutions.some((resolution) => !isRecord(resolution))
    || !uniqueNonBlankIds(output.resolutions.map((resolution) => resolution.resolutionId))) return false;
  for (const resolution of output.resolutions) {
    if (!['confirmed', 'derived', 'adapted', 'reserved', 'not_applicable'].includes(resolution.status)) return false;
    if (!nonBlank(resolution.subjectId) || !nonBlank(resolution.category) || !nonBlank(resolution.statement) || !nonBlank(resolution.justification)) return false;
    if (!nonEmptyStrings(resolution.forgeQuestionIds) || !nonEmptyStrings(resolution.evidenceRefs)) return false;
    if (!nullableString(resolution.adaptationBridge) || !nullableString(resolution.sceneSafeBoundary)) return false;
    if (!stringArray(resolution.dependencies)) return false;
    if (resolution.status !== 'not_applicable' && !nonEmptyStrings(resolution.dependencies)) return false;
    if (!nonEmptyStrings(resolution.compilationTargets) || !nonEmptyStrings(resolution.surfaces)) return false;
    if (resolution.surfaces.some((surface) => !inEnum(surface, ['creator_meta', 'runtime', 'player_facing']))) return false;
    if (!inEnum(resolution.reviewState, ['pending', 'reserved'])) return false;
    if ((resolution.status === 'reserved') !== (resolution.reviewState === 'reserved')) return false;
    if (!Array.isArray(resolution.knowledgeAccess) || resolution.knowledgeAccess.length === 0
      || resolution.knowledgeAccess.some((access) => !isRecord(access))) return false;
    if (resolution.knowledgeAccess.some((access) => !nonBlank(access.holder)
      || !inEnum(access.access, ['truth', 'knows', 'believes', 'rumor', 'unknown', 'restricted'])
      || !nullableString(access.carrier))) return false;
    if (resolution.status === 'confirmed' && !resolution.evidenceRefs.some((ref) => /^(creator|source):/i.test(ref))) return false;
    if (resolution.status === 'adapted' && !nonBlank(resolution.adaptationBridge)) return false;
    if ((resolution.status === 'reserved' || resolution.status === 'not_applicable') && !nonBlank(resolution.sceneSafeBoundary)) return false;
  }
  if (output.questions.some((question) => !isRecord(question))
    || !uniqueOptionalIds(output.questions.map((question) => question.questionId))) return false;
  for (const question of output.questions) {
    if (!nonBlank(question.factBeingDetermined) || !nonBlank(question.meaning)) return false;
    if (!nonEmptyStrings(question.requiredAnswerShape) || !nonEmptyStrings(question.affectedDependencies)) return false;
    if (!inEnum(question.whyCreatorMustAnswer, ['premise_change', 'creator_intent', 'canon_conflict', 'reserved_field', 'high_support_tie'])) return false;
    if (typeof question.blocking !== 'boolean') return false;
  }
  if (output.research.some((research) => !isRecord(research))
    || !uniqueOptionalIds(output.research.map((research) => research.researchId))) return false;
  for (const research of output.research) {
    if (![research.query, research.title, research.publisher, research.fetchedAt, research.claimSupported, research.limitation, research.evidenceRef].every(nonBlank)) return false;
    if (!inEnum(research.freshness, ['current', 'dated', 'unknown'])) return false;
    try {
      const url = new URL(research.url);
      if (!['http:', 'https:'].includes(url.protocol)) return false;
    } catch {
      return false;
    }
  }
  if (output.propagationPlan.some((propagation) => !isRecord(propagation))) return false;
  const resolutionIds = new Set(output.resolutions.map((resolution) => resolution.resolutionId));
  for (const propagation of output.propagationPlan) {
    if (!resolutionIds.has(propagation.resolutionId) || !nonBlank(propagation.destination) || !nonBlank(propagation.transformation)) return false;
    if (!inEnum(propagation.status, ['planned', 'blocked'])) return false;
  }
  if (!inEnum(output.qa.runStatus, ['passed', 'blocked', 'invalid', 'superseded'])) return false;
  if (!inEnum(output.qa.projectCompletion, ['source_anchored', 'questionnaire_in_progress'])) return false;
  if (typeof output.qa.releaseEligible !== 'boolean' || !stringArray(output.qa.blockers)) return false;
  const coverage = output.qa.coverage;
  if (!coverage || ![
    coverage.expectedTabs, coverage.representedTabs, coverage.fullyEvaluatedTabs,
    coverage.includedCharacters, coverage.totalCharacters,
    coverage.questionInventory?.expected, coverage.questionInventory?.routed,
  ].every(nonNegativeInteger)) return false;
  if (coverage.representedTabs > coverage.expectedTabs || coverage.fullyEvaluatedTabs > coverage.representedTabs) return false;
  if (coverage.questionInventory.routed > coverage.questionInventory.expected) return false;
  if (coverage.coverageMode !== 'sampled_prepass' || !stringArray(coverage.applicableAreas) || !stringArray(coverage.evaluatedAreas)) return false;
  if (!Array.isArray(output.qa.gates) || output.qa.gates.some((gate) => !isRecord(gate) || !nonBlank(gate.gate)
    || !nonBlank(gate.evidence) || !inEnum(gate.status, ['pass', 'fail', 'blocked', 'not_tested']))) return false;
  if (!inEnum(output.nextAction.kind, ['answer_questions', 'review_resolutions', 'continue_quampute'])) return false;
  if (!nonBlank(output.nextAction.explanation)) return false;
  return true;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonBlank);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonBlank);
}

function nullableString(value: unknown): value is string | null {
  return value === null || nonBlank(value);
}

function nonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function inEnum<const T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueNonBlankIds(ids: unknown[]) {
  return ids.length > 0 && ids.every(nonBlank) && new Set(ids).size === ids.length;
}

function uniqueOptionalIds(ids: unknown[]) {
  return ids.every(nonBlank) && new Set(ids).size === ids.length;
}
