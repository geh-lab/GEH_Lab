import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as utils from '../assets/js/utils.js';
import * as patents from '../assets/js/patents.js';
import * as inventors from '../assets/js/patent-inventors.js';
import * as data from '../assets/js/data.js';

// Run the production card renderers with an offline roster. The DOMContentLoaded
// callback is not invoked; any attempted network request fails the test.
const source = (await fs.readFile(new URL('../assets/js/public.js', import.meta.url), 'utf8'))
  .replace(/^import\s+[\s\S]*?;\s*$/gm, '');
const memberA = { id: 'member-a', nameKr: '연구자 가', nameEn: 'Researcher A', email: 'private-a@example.test' };
const memberB = { id: 'member-b', nameKr: '연구자 나', nameEn: 'Researcher B', email: 'private-b@example.test' };
function runtime(lang = 'kr', members = [memberA, memberB]) {
  const document = {
    body: { dataset: { page: 'patents', lang, root: lang === 'en' ? '..' : '.' } },
    documentElement: { classList: { add() {} } },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => []
  };
  const api = vm.runInNewContext(`(() => { ${source}\nreturn { state, resolvedCollections, dataIssues, patentCard, publicationCard, renderPublicationMemberDetails }; })()`, {
    ...utils, ...patents, ...inventors, ...data, document, URL, URLSearchParams, console,
    window: { matchMedia: () => ({ matches: true }) },
    localStorage: { getItem: () => null }, hasFirebaseConfig: false, isLocalDevMode: true,
    COLLECTIONS: { members: 'members', projects: 'projects', publications: 'publications', patents: 'patents', board: 'boardPosts' },
    fetch() { throw new Error('Research card tests must never contact a server.'); }
  }, { filename: 'public.js' });
  api.state.members = members;
  api.state.loadingMembers = false;
  api.resolvedCollections.add('members');
  return api;
}

const patent = {
  id: 'patent-a', titleKr: '물 사용량을 줄이는 관개 장치', titleEn: 'Water-saving irrigation apparatus',
  status: 'granted', inventorsKr: '연구자 가, 외부 발명자', inventorsEn: 'Researcher A, External Inventor',
  inventorMemberIds: ['member-a'], inventorMembers: [{ memberId: 'member-a', nameKr: '연구자 가', nameEn: 'Researcher A' }],
  applicantKr: '연구기관 산학협력단', applicantEn: 'Research Institution', countryKr: '대한민국', countryEn: 'Republic of Korea',
  applicationNumber: '10-2022-0012345', applicationDate: '2022-11-30',
  registrationNumber: '10-2025-0067890', registrationDate: '2025-12-26',
  descriptionKr: '센서 측정값으로 관개량을 조절합니다.', descriptionEn: 'Adjusts irrigation using sensor measurements.',
  url: 'https://example.test/patent/123?lang=ko&source=lab'
};
const publication = {
  id: 'publication-a', title: 'Irrigation response in greenhouse crops', journal: 'Example Journal',
  year: 2026, month: 9, indexing: 'SCIE',
  authors: 'Researcher A, External Author & Researcher B', doi: '10.1000/example',
  abstract: 'The full study abstract remains available.',
  memberLinks: [{ memberId: 'member-a', roles: ['first'] }, { memberId: 'member-b', roles: ['co', 'corresponding'] }]
};
const disclosures = (html) => [...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(([value]) => value);
const disclosure = (html, label) => disclosures(html).find((value) => value.includes(label)) || '';
const occurrences = (html, value) => html.split(value).length - 1;
const ids = (html) => [...html.matchAll(/\bdata-member-id="([^"]+)"/g)].map(([, id]) => id);
function assertCompact(html) {
  assert.match(html, /record-contributors/);
  assert.doesNotMatch(html, /mailto:|private-[ab]@example\.test|publication-member-email/);
  assert.doesNotMatch(html, /<article\b|member-card|publication-members__item/);
}

let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS: ${name}`); }

check('Patent cards retain all identifiers, dates, applicant and summary in a closed details disclosure', () => {
  const r = runtime();
  const html = r.patentCard(patent);
  const details = disclosure(html, '특허 상세 정보');
  assert.ok(details, 'Full patent information must remain accessible');
  assert.doesNotMatch(details.match(/^<details[^>]*>/)[0], /\bopen(?:\s|=|>)/);
  for (const value of [patent.applicationNumber, patent.applicationDate, patent.registrationNumber,
    patent.registrationDate, patent.applicantKr, patent.descriptionKr]) assert.ok(details.includes(value), `Missing patent field: ${value}`);
  assert.ok(html.includes(patent.titleKr));
  assert.ok(html.includes(patent.countryKr));
  assert.ok(html.includes('연구자 가, 외부 발명자'));
  assert.equal(occurrences(html, '연구자 가, 외부 발명자'), 1, 'Full inventor text must not be repeated in details');
  assert.match(html, /href="https:\/\/example\.test\/patent\/123\?lang=ko&amp;source=lab"/);
});

check('Filed patents keep application information without claiming a grant', () => {
  const r = runtime();
  const html = r.patentCard({ ...patent, status: 'pending', registrationDate: '', registrationNumber: '' });
  assert.match(html, />출원</);
  assert.ok(html.includes(patent.applicationNumber));
  assert.ok(html.includes(patent.applicationDate));
  assert.doesNotMatch(html, />등록번호<|>등록일<|>등록</);
});

check('English patent and publication disclosures keep localized labels and complete source authors', () => {
  const r = runtime('en');
  const patentHtml = r.patentCard(patent);
  assert.ok(disclosure(patentHtml, 'Patent details'));
  assert.ok(disclosure(patentHtml, 'Lab inventors'));
  assert.ok(patentHtml.includes(patent.titleEn));
  assert.ok(patentHtml.includes(patent.inventorsEn));
  assert.ok(patentHtml.includes(patent.descriptionEn));
  assert.match(patentHtml, />Granted</);
  const publicationHtml = r.publicationCard(publication);
  assert.ok(disclosure(publicationHtml, 'Lab authors'));
  assert.ok(publicationHtml.includes(utils.escapeHTML(publication.authors)));
  assert.ok(publicationHtml.includes(publication.abstract));
  assert.match(publicationHtml, /First author|Corresponding author/);
  assert.match(publicationHtml, /href="https:\/\/doi\.org\/10\.1000\/example"/);
});

check('Patent contributors are compact profile links with no author-role badges or repeated emails', () => {
  const r = runtime();
  const html = disclosure(r.patentCard(patent), '연구실 발명자');
  assertCompact(html);
  assert.deepEqual(ids(html), ['member-a']);
  assert.doesNotMatch(html, /제1저자|공동저자|교신저자|First author|Co-author|Corresponding author/);
});

check('Publication contributors merge repeated member IDs and preserve only recorded supported roles', () => {
  const r = runtime();
  const html = r.renderPublicationMemberDetails({ ...publication, memberLinks: [
    { memberId: 'member-a', roles: ['first', 'first', 'invented-role'] },
    { memberId: 'member-a', roles: ['corresponding'] },
    { memberId: 'member-b', roles: [] }
  ] });
  assertCompact(html);
  assert.equal(occurrences(html, 'data-member-id="member-a"'), 1);
  assert.equal(occurrences(html, 'data-member-id="member-b"'), 1);
  assert.equal(occurrences(html, '>제1저자<'), 1);
  assert.equal(occurrences(html, '>교신저자<'), 1);
  assert.doesNotMatch(html, /invented-role|>공동저자</);
});

check('Reverse publication links retain known contributor roles when the publication has no direct links', () => {
  const r = runtime('kr', [
    { ...memberA, publicationLinks: [{ publicationId: publication.id, roles: ['co'] }] },
    { ...memberB, publicationLinks: [{ publicationId: 'unrelated-publication', roles: ['first'] }] }
  ]);
  const html = r.renderPublicationMemberDetails({ ...publication, memberLinks: [] });
  assert.deepEqual(ids(html), ['member-a']);
  assert.match(html, />공동저자</);
  assert.doesNotMatch(html, />제1저자</);
});

check('Stable inventor IDs survive renamed members and never link an unrelated same-name member', () => {
  const r = runtime('kr', [{ ...memberA, nameKr: '이름 변경 연구자' }, { ...memberB, nameKr: '연구자 가' }]);
  const html = disclosure(r.patentCard({ ...patent, inventorMemberIds: ['member-a', 'member-a'] }), '연구실 발명자');
  assert.deepEqual(ids(html), ['member-a']);
  assert.ok(html.includes('이름 변경 연구자'));
});

check('Legacy inventor names link only exact unique roster names and preserve external inventors', () => {
  const { inventorMemberIds, inventorMembers, ...legacy } = patent;
  const r = runtime();
  assert.deepEqual(ids(disclosure(r.patentCard(legacy), '연구실 발명자')), ['member-a']);
  const textOnly = { ...legacy, inventorsKr: '연구자 가의 협력자, 외부 발명자', inventorsEn: '' };
  assert.deepEqual(ids(disclosure(r.patentCard(textOnly), '연구실 발명자')), []);
  assert.ok(r.patentCard(textOnly).includes(textOnly.inventorsKr));
  const ambiguous = runtime('kr', [memberA, { ...memberB, nameKr: memberA.nameKr }]);
  assert.deepEqual(ids(disclosure(ambiguous.patentCard({ ...legacy, inventorsEn: '' }), '연구실 발명자')), []);
});

check('Explicit unlinks and missing members do not create fabricated profile destinations', () => {
  const r = runtime();
  const unlinked = r.patentCard({ ...patent, inventorMemberIds: [] });
  assert.deepEqual(ids(disclosure(unlinked, '연구실 발명자')), []);
  const missing = r.patentCard({ ...patent, inventorMemberIds: ['missing-member'], inventorMembers: [
    { memberId: 'missing-member', nameKr: '이전 발명자', nameEn: 'Former Inventor' }
  ] });
  assert.deepEqual(ids(disclosure(missing, '연구실 발명자')), []);
  assert.ok(missing.includes(patent.inventorsKr), 'Original inventor attribution must remain available');
});

check('Untrusted record text is escaped and non-web patent URLs never become clickable', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const r = runtime('kr', [{ ...memberA, nameKr: attack }]);
  const html = r.patentCard({ ...patent, titleKr: attack, inventorsKr: attack,
    applicantKr: attack, countryKr: attack, descriptionKr: attack, url: 'javascript:alert(1)' });
  assert.doesNotMatch(html, /<img\b|href="javascript:|href="data:/);
  assert.ok(html.includes(utils.escapeHTML(attack)));
  assert.match(html, /data-member-id="member-a"/);
  const publicationHtml = r.publicationCard({ ...publication, title: attack, authors: attack, abstract: attack });
  assert.doesNotMatch(publicationHtml, /<img\b/);
  assert.ok(publicationHtml.includes(utils.escapeHTML(attack)));
});

console.log(`Research card checks passed: ${checks}.`);
