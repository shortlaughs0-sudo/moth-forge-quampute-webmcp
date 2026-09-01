import { creatorQuestionId, normalizeQuestionFact } from '@/lib/server/creator-questions';

export type CreatorAnswer = {
  questionId: string;
  factBeingDetermined: string;
  answer: string;
  updatedAt: string;
  history: Array<{ answer: string; factBeingDetermined: string; supersededAt: string }>;
};

const MAX_CREATOR_ANSWERS = 607;
const MAX_ANSWERS_PER_SAVE = 100;
const SAFE_QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function stableQuestionId(value: unknown, factBeingDetermined: string) {
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (SAFE_QUESTION_ID.test(candidate)) return candidate;
  }
  return creatorQuestionId(factBeingDetermined);
}

export function mergeCreatorAnswers(
  existingValue: unknown[],
  incomingValue: unknown[],
  updatedAt: string,
): CreatorAnswer[] | null {
  if (incomingValue.length > MAX_ANSWERS_PER_SAVE) return null;
  const existing = existingValue.flatMap((value): CreatorAnswer[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Partial<CreatorAnswer>;
    if (typeof row.questionId !== 'string' || typeof row.answer !== 'string') return [];
    const factBeingDetermined = typeof row.factBeingDetermined === 'string'
      ? row.factBeingDetermined.trim().slice(0, 500)
      : '';
    return [{
      questionId: stableQuestionId(row.questionId, factBeingDetermined),
      factBeingDetermined,
      answer: row.answer,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : updatedAt,
      history: Array.isArray(row.history)
        ? row.history.flatMap((value): CreatorAnswer['history'] => {
            if (!value || typeof value !== 'object') return [];
            const item = value as Record<string, unknown>;
            if (typeof item.answer !== 'string') return [];
            return [{
              answer: item.answer.slice(0, 2_000),
              factBeingDetermined: typeof item.factBeingDetermined === 'string'
                ? item.factBeingDetermined.slice(0, 500)
                : '',
              supersededAt: typeof item.supersededAt === 'string' ? item.supersededAt : updatedAt,
            }];
          }).slice(-3)
        : [],
    }];
  });
  const byId = new Map<string, CreatorAnswer>();
  const factToId = new Map<string, string>();
  const order: string[] = [];
  for (const answer of existing) {
    const prior = byId.get(answer.questionId);
    if (!prior) order.push(answer.questionId);
    byId.set(answer.questionId, prior
      ? {
          ...answer,
          history: [...prior.history, {
            answer: prior.answer,
            factBeingDetermined: prior.factBeingDetermined,
            supersededAt: answer.updatedAt,
          }, ...answer.history].slice(-3),
        }
      : answer);
    const normalizedFact = normalizeQuestionFact(answer.factBeingDetermined);
    if (normalizedFact) factToId.set(normalizedFact, answer.questionId);
  }

  for (const value of incomingValue) {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const answer = typeof row.answer === 'string' && row.answer.length <= 2_000 ? row.answer.trim() : '';
    const factBeingDetermined = typeof row.factBeingDetermined === 'string'
      && row.factBeingDetermined.length <= 500
      ? row.factBeingDetermined.trim()
      : '';
    if (!factBeingDetermined || !answer) return null;

    const normalizedFact = normalizeQuestionFact(factBeingDetermined);
    const questionId = stableQuestionId(row.questionId, factBeingDetermined);
    const priorFactId = factToId.get(normalizedFact);
    const conflictingId = byId.get(questionId);
    if (conflictingId && normalizeQuestionFact(conflictingId.factBeingDetermined) !== normalizedFact) return null;

    const priorId = conflictingId ? questionId : priorFactId;
    const prior = priorId ? byId.get(priorId) : undefined;
    if (priorId && priorId !== questionId) {
      const priorIndex = order.indexOf(priorId);
      if (priorIndex >= 0) order[priorIndex] = questionId;
      byId.delete(priorId);
    } else if (!prior) {
      order.push(questionId);
    }
    factToId.set(normalizedFact, questionId);
    if (prior?.answer === answer && prior.factBeingDetermined === factBeingDetermined) {
      byId.set(questionId, { ...prior, questionId });
      continue;
    }
    const history = prior
      ? [...prior.history, {
          answer: prior.answer,
          factBeingDetermined: prior.factBeingDetermined,
          supersededAt: updatedAt,
        }].slice(-3)
      : [];
    byId.set(questionId, { questionId, factBeingDetermined, answer, updatedAt, history });
  }

  const uniqueOrder = [...new Set(order)];
  if (uniqueOrder.length > MAX_CREATOR_ANSWERS) return null;
  return uniqueOrder.flatMap((questionId) => {
    const answer = byId.get(questionId);
    return answer ? [answer] : [];
  });
}
