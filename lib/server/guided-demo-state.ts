export const GUIDED_DEMO_EVIDENCE = Object.freeze({
  'R-DEMO-001': ['creator:lock:1'],
  'R-DEMO-002': ['creator:concept', 'creator:lock:2'],
  'R-DEMO-003': ['creator:concept', 'creator:lock:2'],
  'R-DEMO-004': ['creator:concept', 'creator:lock:2'],
  'R-DEMO-005': ['creator:lock:3'],
  'R-DEMO-006': ['creator:player-boundary'],
  'R-DEMO-007': ['creator:concept'],
} satisfies Record<string, readonly string[]>);

type GuidedDemoResult = {
  runKind?: unknown;
  processingReceipt?: unknown;
  resolutions?: unknown;
};

export function hasCanonicalGuidedDemoEvidence(value: Record<string, unknown> | null) {
  if (!value) return false;
  const rows = Array.isArray((value as GuidedDemoResult).resolutions)
    ? (value as GuidedDemoResult).resolutions as unknown[]
    : [];
  if (rows.length !== Object.keys(GUIDED_DEMO_EVIDENCE).length) return false;
  const seen = new Set<string>();
  for (const rowValue of rows) {
    if (!rowValue || typeof rowValue !== 'object') return false;
    const row = rowValue as Record<string, unknown>;
    if (typeof row.resolutionId !== 'string' || seen.has(row.resolutionId)) return false;
    const expected = GUIDED_DEMO_EVIDENCE[row.resolutionId as keyof typeof GUIDED_DEMO_EVIDENCE];
    if (!expected || !Array.isArray(row.evidenceRefs)) return false;
    if (row.evidenceRefs.length !== expected.length
      || row.evidenceRefs.some((reference, index) => reference !== expected[index])) return false;
    seen.add(row.resolutionId);
  }
  return seen.size === Object.keys(GUIDED_DEMO_EVIDENCE).length;
}

export function isCanonicalNoCostGuidedDemo(value: Record<string, unknown> | null) {
  if (!value || value.runKind !== 'guided_demo') return false;
  const receipt = value.processingReceipt;
  return Boolean(receipt && typeof receipt === 'object'
    && (receipt as Record<string, unknown>).modelCallMade === false
    && hasCanonicalGuidedDemoEvidence(value));
}

export function shouldPreserveGuidedDemoReview(input: {
  publicDemoMode: boolean;
  projectId: string;
  bodyKeys: string[];
  result: Record<string, unknown> | null;
}) {
  return input.publicDemoMode
    && input.projectId.startsWith('guided-demo-')
    && input.bodyKeys.length === 1
    && input.bodyKeys[0] === 'answers'
    && isCanonicalNoCostGuidedDemo(input.result);
}
