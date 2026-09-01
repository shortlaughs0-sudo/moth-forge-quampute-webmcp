import 'server-only';
import tab00 from './tabs/01-synthetic-lab.txt?raw';
import tab01 from './tabs/02-synthetic-lab.txt?raw';
import tab02 from './tabs/03-synthetic-lab.txt?raw';
import tab03 from './tabs/04-synthetic-lab.txt?raw';
import tab04 from './tabs/05-synthetic-lab.txt?raw';
import tab05 from './tabs/06-synthetic-lab.txt?raw';
import tab06 from './tabs/07-synthetic-lab.txt?raw';
import tab07 from './tabs/08-synthetic-lab.txt?raw';
import tab08 from './tabs/09-synthetic-lab.txt?raw';
import tab09 from './tabs/10-synthetic-lab.txt?raw';
import tab10 from './tabs/11-synthetic-lab.txt?raw';
import tab11 from './tabs/12-synthetic-lab.txt?raw';
import tab12 from './tabs/13-synthetic-lab.txt?raw';
import tab13 from './tabs/14-synthetic-lab.txt?raw';
import tab14 from './tabs/15-synthetic-lab.txt?raw';
import tab15 from './tabs/16-synthetic-lab.txt?raw';
import tab16 from './tabs/17-synthetic-lab.txt?raw';
import tab17 from './tabs/18-synthetic-lab.txt?raw';
import tab18 from './tabs/19-synthetic-lab.txt?raw';
import tab19 from './tabs/20-synthetic-lab.txt?raw';
import tab20 from './tabs/21-synthetic-lab.txt?raw';
import tab21 from './tabs/22-synthetic-lab.txt?raw';
import tab22 from './tabs/23-synthetic-lab.txt?raw';
import tab23 from './tabs/24-synthetic-lab.txt?raw';
import tab24 from './tabs/25-synthetic-lab.txt?raw';
import tab25 from './tabs/26-synthetic-lab.txt?raw';
import tab26 from './tabs/27-synthetic-lab.txt?raw';
import tab27 from './tabs/28-synthetic-lab.txt?raw';
import tab28 from './tabs/29-synthetic-lab.txt?raw';
import manifestJson from './manifest.json';
import manifestRaw from './manifest.json?raw';

export type ForgeSourceStatus = 'verified' | 'stale' | 'partial' | 'unavailable';
export type ForgeTab = (typeof manifestJson.tabs)[number] & { text: string };
export const manifest = manifestJson;
export const manifestSource = manifestRaw;
export const manifestSha256 = 'a8c359131df01acd68031ad89589ac36172b53a9d11b8a4979242b78bbe2e2fc';
export const forgeTabs: ForgeTab[] = [
  { ...manifest.tabs[0], text: tab00 },
  { ...manifest.tabs[1], text: tab01 },
  { ...manifest.tabs[2], text: tab02 },
  { ...manifest.tabs[3], text: tab03 },
  { ...manifest.tabs[4], text: tab04 },
  { ...manifest.tabs[5], text: tab05 },
  { ...manifest.tabs[6], text: tab06 },
  { ...manifest.tabs[7], text: tab07 },
  { ...manifest.tabs[8], text: tab08 },
  { ...manifest.tabs[9], text: tab09 },
  { ...manifest.tabs[10], text: tab10 },
  { ...manifest.tabs[11], text: tab11 },
  { ...manifest.tabs[12], text: tab12 },
  { ...manifest.tabs[13], text: tab13 },
  { ...manifest.tabs[14], text: tab14 },
  { ...manifest.tabs[15], text: tab15 },
  { ...manifest.tabs[16], text: tab16 },
  { ...manifest.tabs[17], text: tab17 },
  { ...manifest.tabs[18], text: tab18 },
  { ...manifest.tabs[19], text: tab19 },
  { ...manifest.tabs[20], text: tab20 },
  { ...manifest.tabs[21], text: tab21 },
  { ...manifest.tabs[22], text: tab22 },
  { ...manifest.tabs[23], text: tab23 },
  { ...manifest.tabs[24], text: tab24 },
  { ...manifest.tabs[25], text: tab25 },
  { ...manifest.tabs[26], text: tab26 },
  { ...manifest.tabs[27], text: tab27 },
  { ...manifest.tabs[28], text: tab28 },
];

export function getForgeAnchor() {
  const verifiedTabCount = forgeTabs.filter((tab) => tab.text.length === tab.characters).length;
  const status: ForgeSourceStatus = verifiedTabCount === manifest.expectedTabCount ? 'verified' : 'partial';
  return { ...manifest, verifiedTabCount, status };
}

export function selectForgeContext(input: string, buildShape: string, maxCharacters = 180000) {
  const tokens = [...new Set((input + ' ' + buildShape).toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? [])];
  const ranked = forgeTabs.map((tab) => ({
    tab,
    score: tokens.reduce((score, token) => score + (tab.text.toLowerCase().includes(token) ? 1 : 0), 0),
  })).sort((left, right) => right.score - left.score || left.tab.ordinal - right.tab.ordinal);
  const selected: ForgeTab[] = [];
  let used = 0;
  for (const { tab } of ranked) {
    if (used + tab.text.length > maxCharacters) continue;
    selected.push(tab);
    used += tab.text.length;
  }
  return selected.sort((left, right) => left.ordinal - right.ordinal);
}
