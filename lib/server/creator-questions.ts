export function normalizeQuestionFact(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function creatorQuestionId(factBeingDetermined: string) {
  const normalized = normalizeQuestionFact(factBeingDetermined);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const digest = seeds.map((seed) => fnv1a(normalized, seed).toString(16).padStart(8, '0')).join('');
  return `creator-${digest}`;
}

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
