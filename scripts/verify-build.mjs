import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const coreEntries = [
  'index.html', 'members.html', 'projects.html', 'publications.html', 'news.html',
  'board.html', 'contact.html', 'admin.html', 'patents.html', 'en/patents.html',
  'en/index.html', 'en/members.html', 'en/projects.html', 'en/publications.html',
  'en/news.html', 'en/board.html', 'en/contact.html'
];

async function htmlEntries(directoryUrl, prefix = '') {
  const entries = [];
  for (const item of await readdir(directoryUrl, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) entries.push(...await htmlEntries(new URL(`${item.name}/`, directoryUrl), relative));
    if (item.isFile() && item.name.endsWith('.html')) entries.push(relative);
  }
  return entries;
}

const entries = await htmlEntries(root);
const rosterIndex = JSON.parse(await readFile(new URL('../assets/data/member-profile-index.json', import.meta.url), 'utf8'));
const sourceRoster = JSON.parse(await readFile(new URL('../assets/data/profile-source.json', import.meta.url), 'utf8')).members || [];
const missing = [];

coreEntries.forEach((entry) => {
  if (!entries.includes(entry)) missing.push(`core page missing -> ${entry}`);
});

const oldProfilePages = entries.filter((entry) => /^members\/[^/]+\.html$/.test(entry) || /^en\/members\/[^/]+\.html$/.test(entry));
if (oldProfilePages.length) missing.push(`independent profile pages still emitted -> ${oldProfilePages.join(', ')}`);

for (const entry of entries) {
  const html = await readFile(new URL(entry, root), 'utf8');
  const references = Array.from(html.matchAll(/(?:href|src)="([^"]+)"/g), (match) => match[1]);
  for (const reference of references) {
    if (/^(?:https?:|mailto:|tel:|#|data:)/i.test(reference) || reference.startsWith('/_vercel/')) continue;
    const clean = reference.split(/[?#]/)[0];
    if (!clean) continue;
    const relative = clean.startsWith('/') ? clean.slice(1) : normalize(join(dirname(entry), clean));
    try {
      await access(new URL(relative, root));
    } catch {
      missing.push(`${entry} -> ${reference}`);
    }
  }
}

for (const [entry, canonical, language] of [
  ['members.html', 'https://geh-lab.vercel.app/members.html', 'ko'],
  ['en/members.html', 'https://geh-lab.vercel.app/en/members.html', 'en']
]) {
  const html = await readFile(new URL(entry, root), 'utf8');
  if (!html.includes(`<link rel="canonical" href="${canonical}">`)) missing.push(`${entry} -> canonical mismatch`);
  if (!html.includes('class="profile-avatar"') || !html.includes('member-preview-identity')) missing.push(`${entry} -> compact member previews missing`);
  if (!html.includes('id="member-roster-data"')) missing.push(`${entry} -> embedded live roster data missing`);
  const embeddedSource = html.match(/<script id="member-roster-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  try {
    const embedded = JSON.parse(embeddedSource || '[]');
    if (embedded.length !== rosterIndex.memberCount) missing.push(`${entry} -> detail record count mismatch`);
    for (const record of embedded) {
      const original = sourceRoster.find((member) => member.id === record.id);
      if (!original) { missing.push(`${entry} -> detail record missing from source: ${record.id}`); continue; }
      for (const key of Object.keys(original).filter((field) => /^(education|experience|bachelors|masters|doctoral)/.test(field) || ['courseSchedule','projectLinks','publicationLinks'].includes(field))) {
        if (JSON.stringify(record[key]) !== JSON.stringify(original[key])) missing.push(`${entry} -> detail field lost or changed: ${record.id}.${key}`);
      }
    }
  } catch { missing.push(`${entry} -> embedded detail records are not valid JSON`); }
  if (!html.includes('class="member-email pi-card-email"')) missing.push(`${entry} -> prerendered PI email control is stale`);
  if (/member-education-lines--panel[^>]*>\s*<p/.test(html)) missing.push(`${entry} -> legacy prerendered education paragraphs remain`);
  if (/member-experience-lines--panel[^>]*>\s*<p/.test(html)) missing.push(`${entry} -> legacy prerendered experience paragraphs remain`);
  if (/<a class="member-email[^"]*"[^>]*>(?:(?!<\/a>)[\s\S])*?<span>/.test(html)) {
    missing.push(`${entry} -> prerendered email still exposes legacy text`);
  }
  if (/member-profile-link|member-modal-profile-link|publication-member-profile-link|프로필 보기|View profile|Open profile page/.test(html)) {
    missing.push(`${entry} -> independent profile action remains`);
  }
  for (const member of rosterIndex.members || []) {
    const expectedName = language === 'en' ? (member.nameEn || member.nameKr) : (member.nameKr || member.nameEn);
    if (expectedName && !html.includes(expectedName)) missing.push(`${entry} -> visible member name missing: ${expectedName}`);
  }
  const jsonSource = html.match(/<script id="member-roster-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!jsonSource) {
    missing.push(`${entry} -> roster JSON-LD missing`);
  } else {
    try {
      const graph = JSON.parse(jsonSource)['@graph'] || [];
      const lists = graph.filter((item) => item['@type'] === 'ItemList');
      const people = lists.flatMap((list) => list.itemListElement || []);
      if (lists.length !== 2) missing.push(`${entry} -> current/alumni ItemList split is invalid`);
      if (people.length !== rosterIndex.memberCount) missing.push(`${entry} -> JSON-LD people mismatch (${people.length}/${rosterIndex.memberCount})`);
      if (!people.every((entryItem) => entryItem?.item?.['@type'] === 'Person' && entryItem.item.name && entryItem.item.url === canonical)) {
        missing.push(`${entry} -> Person structured data is invalid`);
      }
    } catch {
      missing.push(`${entry} -> roster JSON-LD is not valid JSON`);
    }
  }
}

const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
const sitemapUrls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
if (sitemapUrls.length !== 14) missing.push(`sitemap URL count mismatch (${sitemapUrls.length}/14)`);
if (sitemapUrls.some((url) => /\/members\/.+\.html$/.test(url))) missing.push('sitemap still contains independent profile URLs');

for (const required of [
  'firebase-config.js', 'robots.txt', 'sitemap.xml',
  'assets/images/background/basil-phenotyping.webp',
  'assets/images/background/lettuce-imaging.webp',
  'assets/images/background/field-trials.webp',
  'assets/images/background/cabbage-field.webp',
  'assets/images/background/basil-closeup.webp',
  'assets/images/background/lettuce-closeup.webp',
  'assets/images/background/hemp-greenhouse.webp',
  'assets/images/background/agastache-closeup.webp',
  'assets/images/background/artemisia-closeup.webp',
  'assets/images/logos/geh-logo-ui.webp',
  'assets/images/logos/cnu-emblem-blue-ui.webp',
  'assets/images/members/jongseok-park.webp',
  'assets/images/members/kwangya-lee.webp'
]) {
  try {
    await access(new URL(required, root));
  } catch {
    missing.push(`required runtime asset -> ${required}`);
  }
}

for (const excluded of [
  'assets/images/flags/kr.svg',
  'assets/images/flags/us.svg',
  'assets/images/background/research-map.png',
  'assets/images/mainpic.png',
  'assets/images/mainpic.webp',
  'assets/images/logos/cnu-emblem-blue.jpg',
  'assets/images/logos/cnu-emblem-white.jpg',
  'assets/images/members/jongseok-park.png',
  'assets/images/members/kwangya-lee.png'
]) {
  try {
    await access(new URL(excluded, root));
    missing.push(`excluded legacy asset was emitted -> ${excluded}`);
  } catch {
    // Expected: unused legacy assets were removed from source and deployment.
  }
}

if (missing.length) {
  console.error(`Build verification failed:\n${missing.map((item) => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Build verification passed: ${entries.length} pages, ${rosterIndex.memberCount} people on each canonical member page, no independent profile pages.`);
}
