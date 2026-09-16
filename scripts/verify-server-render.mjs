import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { renderServerPublicPage } from '../server/render-public-page.mjs';
import { PUBLIC_PAGES } from '../api/public-page.js';

const root = new URL('../', import.meta.url);
const fetchedAt = Date.now();
const projectId = 'server-render-fixture';
const marker = 'Current server fixture';
const items = {
  members: [{ id: 'current-pi', name: '현재 교수', nameKr: '현재 교수', nameEn: 'Current Professor', group: 'pi', status: 'active', researchInterest: marker, updatedAt: '2026-09-16T03:00:00Z' }],
  projects: [{ id: 'current-project', title: marker, titleEn: marker, status: 'ongoing', startYear: '2026', endYear: '2030', description: marker }],
  publications: [{ id: 'current-publication', title: marker, authors: 'Current Author', abstract: 'Current abstract', year: String(new Date().getFullYear()), month: '09', journal: 'Current Journal', doi: '10.1234/current' }],
  patents: [{ id: 'current-patent', title: marker, titleKr: marker, titleEn: marker, status: 'granted', applicationNumber: 'fixture-123', applicationDate: '2025-04-01', registrationNumber: 'fixture-456', registrationDate: '2026-08-01', inventors: '현재 교수', country: '대한민국' }],
  boardPosts: [{ id: 'current-post', title: marker, description: marker, category: 'other', date: '2026-09-16' }]
};
const record = (name, entries = items[name]) => ({ items: entries, fetchedAt, projectId, stale: false });
let checks = 0;
for (const lang of ['kr', 'en']) {
  for (const [page, config] of Object.entries(PUBLIC_PAGES)) {
    const template = await readFile(new URL(`${lang === 'en' ? 'en/' : ''}${config.file}`, root), 'utf8');
    const records = Object.fromEntries(config.collections.map(name => [name, record(name)]));
    const html = renderServerPublicPage(template, records, { page, lang, projectId });
    const { document } = parseHTML(html);
    assert.ok(document.body.textContent.includes(marker), `${lang}/${page}: populated content exists before JavaScript`);
    assert.equal(document.querySelector('[class*="skeleton"]'), null, `${lang}/${page}: no skeleton nodes`);
    assert.equal(document.querySelector('.member-roster-status'), null);
    assert.equal(document.querySelector('#member-roster-data'), null, 'no stale build payload');
    assert.ok(!html.includes('GEH_BOOT_TIMEOUT'), 'no delayed boot guard');
    assert.ok(!document.documentElement.classList.contains('member-roster-pending'));
    assert.ok([...document.querySelectorAll('.reveal')].every(el => el.classList.contains('is-visible')));
    const counters = [...document.querySelectorAll('.count-up')];
    const expectedCounters = { home: 5, members: 4, projects: 2, publications: 4, patents: 3, board: 0 };
    assert.equal(counters.length, expectedCounters[page], `${lang}/${page}: every summary number supports motion`);
    assert.ok(counters.every(el => el.textContent === el.dataset.target), 'counts populated');
    assert.ok(counters.every(el => el.dataset.countKey?.startsWith(`${page}:`)), 'counter keys identify the page');
    assert.equal(new Set(counters.map(el => el.dataset.countKey)).size, counters.length, 'each statistic has its own replay guard');
    assert.equal(document.querySelector('.count-up[data-counted]'), null, 'server content must remain eligible for browser count animation');
    assert.equal(document.querySelector('[data-bound]'), null, 'client listeners can bind');
    assert.equal(document.querySelector('base').getAttribute('href'), lang === 'en' ? '/en/' : '/');
    const payload = JSON.parse(document.querySelector('#public-page-data').textContent);
    assert.equal(document.querySelector('#public-page-data').parentElement, document.body, 'large cache payload follows visible content');
    assert.equal(document.querySelector('[aria-current="page"]')?.dataset.navPage, page);
    assert.deepEqual(payload.collections, records, 'browser receives same data and original timestamps');
    if (page === 'home') {
      const publication = document.querySelector('[data-publication-id="current-publication"]');
      assert.equal(publication.getAttribute('aria-haspopup'), 'dialog');
      assert.equal(publication.querySelector('a[target="_blank"]'), null, 'home click remains a detail popup');
    }
    if (page === 'members') {
      const schema = JSON.parse(document.querySelector('#member-roster-structured-data').textContent);
      assert.equal(schema['@graph'][0].numberOfItems, 1);
      assert.ok(!html.includes('2026-09-08'), 'old build date does not survive');
    }
    const empty = Object.fromEntries(config.collections.map(name => [name, record(name, [])]));
    const emptyHtml = renderServerPublicPage(template, empty, { page, lang, projectId });
    assert.ok(!emptyHtml.includes(marker), 'empty response replaces old data');
    assert.equal(parseHTML(emptyHtml).document.querySelector('[class*="skeleton"]'), null, 'real empty state is resolved');
    checks += 1;
  }
}

const home = await readFile(new URL('index.html', root), 'utf8');
const partial = renderServerPublicPage(home, { members: record('members') }, {
  page: 'home', lang: 'kr', projectId, unavailableCollections: ['projects', 'publications', 'patents', 'boardPosts']
});
const partialDoc = parseHTML(partial).document;
assert.ok(partialDoc.querySelector('#public-status-notice'));
assert.equal(partialDoc.querySelector('[class*="skeleton"]'), null);
assert.ok(partialDoc.querySelector('#hero-stat-grid').textContent.includes('—'));
assert.ok(partialDoc.querySelector('#home-publication-grid').textContent.includes('불러오지 못했습니다'));
checks++;

for (const lang of ['kr', 'en']) {
  const template = await readFile(new URL(`${lang === 'en' ? 'en/' : ''}patents.html`, root), 'utf8');
  const failed = parseHTML(renderServerPublicPage(template, { members: record('members') }, {
    page: 'patents', lang, projectId, unavailableCollections: ['patents']
  })).document;
  assert.equal(failed.querySelectorAll('#patent-stat-grid .count-up').length, 0, 'failed counts cannot animate into zero');
  assert.deepEqual([...failed.querySelectorAll('#patent-stat-grid strong')].map(el => el.textContent), ['—', '—', '—']);
  checks++;
}

const payloadAttack = '</script><img src=x onerror=alert(1)>\u2028\u2029';
const board = await readFile(new URL('news.html', root), 'utf8');
const attack = renderServerPublicPage(board, { boardPosts: record('boardPosts', [{ id: 'bad', title: payloadAttack, category: 'other' }]) }, { page: 'board', lang: 'kr', projectId });
const attackDoc = parseHTML(attack).document;
assert.equal(attackDoc.querySelector('img[onerror]'), null);
assert.equal(JSON.parse(attackDoc.querySelector('#public-page-data').textContent).collections.boardPosts.items[0].title, payloadAttack);
assert.throws(() => renderServerPublicPage(home, {}, { page: 'members', lang: 'en', projectId }), /template/);
checks++;
console.log(`Server-rendered public pages: ${checks} checks passed (12 locale/page pairs, partial data, safe serialization).`);
