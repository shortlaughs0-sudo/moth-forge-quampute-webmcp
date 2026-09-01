import 'server-only';
import { forgeTabs, manifest, manifestSha256, manifestSource } from '@/forge-bundle';
import { hashText } from './http';

export type ForgeAnchorDto = {
  documentId: string;
  revisionId: string;
  manifestHash: string;
  expectedTabCount: number;
  verifiedTabCount: number;
  totalCharacters: number;
  questionCount: number;
  verifiedAt: string;
  status: 'verified' | 'partial';
  traversal: string[];
  tabTitles: string[];
};

export type ForgeQuestion = { id: string; tabId: string; tabTitle: string; question: string };

function parseTabQuestions(tab: (typeof forgeTabs)[number]): ForgeQuestion[] {
  const questions = tab.text.split('\n').flatMap((line) => {
    const match = line.match(/^QUESTION\s+([A-Z0-9-]+)\s+—\s+(.+)$/u);
    return match?.[1] && match[2]?.trim()
      ? [{ id: match[1], tabId: tab.tabId, tabTitle: tab.title, question: match[2].trim() }]
      : [];
  });
  if (questions.length !== tab.questionCount) {
    throw new Error(`Synthetic question inventory mismatch for ${tab.tabId}: expected ${tab.questionCount}, found ${questions.length}.`);
  }
  return questions;
}

export const forgeQuestions: ForgeQuestion[] = forgeTabs.flatMap(parseTabQuestions);
export const forgeQuestionIds = new Set(forgeQuestions.map((question) => question.id));
const uniqueQuestionPrompts = new Set(forgeQuestions.map((question) => question.question.toLowerCase().replace(/\s+/gu, ' ').trim()));
let verification: Promise<ForgeAnchorDto> | null = null;

export function verifyForgeAnchor() {
  verification ??= verify();
  return verification;
}

async function verify(): Promise<ForgeAnchorDto> {
  let verifiedTabCount = 0;
  let totalCharacters = 0;
  const tabIds = new Set<string>();
  for (const tab of forgeTabs) {
    const hash = await hashText(tab.text);
    const bytes = new TextEncoder().encode(tab.text).byteLength;
    totalCharacters += tab.text.length;
    tabIds.add(tab.tabId);
    if (hash === tab.sha256 && tab.text.length === tab.characters && bytes === tab.bytes) verifiedTabCount += 1;
  }
  const manifestHash = await hashText(manifestSource);
  const structureVerified = forgeTabs.length === manifest.expectedTabCount
    && manifest.tabs.length === manifest.expectedTabCount
    && tabIds.size === manifest.expectedTabCount
    && totalCharacters === manifest.totalCharacters
    && manifestHash === manifestSha256
    && forgeQuestions.length === manifest.totalQuestions
    && forgeQuestionIds.size === manifest.totalQuestions
    && uniqueQuestionPrompts.size === manifest.totalQuestions
    && manifest.traversal.length === manifest.expectedTabCount
    && manifest.traversal.every((tabId, index) => tabId === forgeTabs[index]?.tabId);
  return {
    documentId: manifest.documentId,
    revisionId: manifest.revisionId,
    manifestHash: manifestSha256,
    expectedTabCount: manifest.expectedTabCount,
    verifiedTabCount,
    totalCharacters,
    questionCount: forgeQuestions.length,
    verifiedAt: manifest.verifiedAt,
    status: verifiedTabCount === manifest.expectedTabCount && structureVerified ? 'verified' : 'partial',
    traversal: [...manifest.traversal],
    tabTitles: manifest.tabs.map((tab) => tab.title),
  };
}

const forgeQuestionCatalog = [
  `--- SYNTHETIC QUESTION ROUTING INDEX | ${forgeQuestions.length} distinct prompts ---`,
  'This public index contains invented demonstration material and no private source corpus.',
  ...forgeQuestions.map((question) => `${question.id} | ${question.tabTitle} | ${question.question}`),
].join('\n');

type Fragment = { tabId: string; title: string; sha256: string; start: number; end: number; text: string; score: number };

export function compileForgeContext(concept: string, buildShape: string, maxCharacters = 180_000) {
  const tokens = significantTokens(`${buildShape} ${concept}`);
  const fragments: Fragment[] = [];
  for (const tab of forgeTabs) {
    for (const fragment of chunkTab(tab.text, 5_500)) {
      const haystack = `${tab.title}\n${fragment.text}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + countOccurrences(haystack, token), 0);
      fragments.push({ ...fragment, tabId: tab.tabId, title: tab.title, sha256: tab.sha256, score });
    }
  }
  fragments.sort((left, right) => right.score - left.score || left.start - right.start);
  const selected: Fragment[] = [];
  const represented = new Set<string>();
  const allFragmentsByTab = new Map<string, number>();
  const selectedFragmentsByTab = new Map<string, number>();
  for (const fragment of fragments) allFragmentsByTab.set(fragment.tabId, (allFragmentsByTab.get(fragment.tabId) ?? 0) + 1);
  let used = 0;
  for (const tab of forgeTabs) {
    const best = fragments.find((fragment) => fragment.tabId === tab.tabId);
    if (!best || used + best.text.length > maxCharacters) continue;
    selected.push(best);
    represented.add(best.tabId);
    selectedFragmentsByTab.set(best.tabId, 1);
    used += best.text.length;
  }
  for (const fragment of fragments) {
    if (selected.some((item) => item.tabId === fragment.tabId && item.start === fragment.start)) continue;
    if (used + fragment.text.length > maxCharacters) continue;
    selected.push(fragment);
    represented.add(fragment.tabId);
    selectedFragmentsByTab.set(fragment.tabId, (selectedFragmentsByTab.get(fragment.tabId) ?? 0) + 1);
    used += fragment.text.length;
  }
  selected.sort((left, right) => {
    const leftOrdinal = forgeTabs.find((tab) => tab.tabId === left.tabId)?.ordinal ?? 999;
    const rightOrdinal = forgeTabs.find((tab) => tab.tabId === right.tabId)?.ordinal ?? 999;
    return leftOrdinal - rightOrdinal || left.start - right.start;
  });
  const excerptText = selected.map((fragment) => [
    `--- SYNTHETIC TAB: ${fragment.title} | ${fragment.tabId} | chars ${fragment.start}-${fragment.end} | evidence forge:${fragment.tabId}:${fragment.start}-${fragment.end} | tab sha256 ${fragment.sha256} ---`,
    fragment.text,
  ].join('\n')).join('\n\n');
  const text = `${forgeQuestionCatalog}\n\n${excerptText}`;
  const fullyEvaluatedTabs = [...selectedFragmentsByTab.entries()].filter(([tabId, count]) => count === allFragmentsByTab.get(tabId)).length;
  return {
    text,
    receipt: {
      selectedCharacters: used,
      contextCharacters: text.length,
      totalForgeCharacters: manifest.totalCharacters,
      representedTabs: represented.size,
      fullyEvaluatedTabs,
      coverageMode: 'sampled_prepass' as const,
      questionInventory: { expected: manifest.totalQuestions, routed: forgeQuestions.length, catalogCharacters: forgeQuestionCatalog.length },
      fragments: selected.map(({ tabId, title, sha256, start, end }) => ({
        tabId,
        title,
        sha256,
        start,
        end,
        evidenceRef: `forge:${tabId}:${start}-${end}`,
      })),
    },
  };
}

function significantTokens(value: string) {
  const stop = new Set(['about', 'after', 'again', 'also', 'because', 'could', 'from', 'have', 'into', 'just', 'make', 'more', 'that', 'their', 'them', 'there', 'these', 'they', 'this', 'what', 'when', 'where', 'which', 'with', 'would']);
  return [...new Set(value.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? [])].filter((token) => !stop.has(token)).slice(0, 48);
}

function countOccurrences(value: string, token: string) {
  let count = 0;
  let index = value.indexOf(token);
  while (index !== -1 && count < 12) {
    count += 1;
    index = value.indexOf(token, index + token.length);
  }
  return count;
}

function chunkTab(text: string, target: number) {
  const fragments: Array<{ start: number; end: number; text: string }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + target);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n\n', end);
      if (boundary > start + Math.floor(target * 0.55)) end = boundary;
    }
    fragments.push({ start, end, text: text.slice(start, end).trim() });
    start = end;
    while (text.slice(start, start + 2) === '\n\n') start += 2;
  }
  return fragments.filter((fragment) => fragment.text.length > 0);
}
