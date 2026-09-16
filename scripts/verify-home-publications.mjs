import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as utils from '../assets/js/utils.js';
import * as patents from '../assets/js/patents.js';
import * as inventors from '../assets/js/patent-inventors.js';
import * as data from '../assets/js/data.js';
import { getPublicPageSource } from './public-test-source.mjs';

// Exercise production home cards and event handlers without starting Firebase.
// Stub only the shared modal shell: its title and content are captured for checks.
const source = (await getPublicPageSource())
  .replace(/^import\s+[\s\S]*?;\s*$/gm, '');
const member = { id: 'lab-member', nameKr: '테스트 연구자', nameEn: 'Test Researcher' };
const publication = {
  id: 'home-paper', title: 'A study of greenhouse irrigation', journal: 'Example Journal',
  year: 2026, month: 9, indexing: 'SCIE', authors: 'Test Researcher & External Author',
  doi: '10.1000/home-paper', abstract: 'The complete abstract is available in the details.',
  memberLinks: [{ memberId: member.id, roles: ['first'] }]
};

function eventCard(id) {
  const handlers = new Map();
  return {
    dataset: { publicationId: String(id) },
    closest() { return null; },
    addEventListener(type, callback) {
      const listeners = handlers.get(type) || [];
      listeners.push(callback);
      handlers.set(type, listeners);
    },
    dispatch(type, properties = {}) {
      const event = { target: this, detail: 1, prevented: false,
        preventDefault() { this.prevented = true; }, ...properties };
      (handlers.get(type) || []).forEach((callback) => callback(event));
      return event;
    },
    handlerCount(type) { return (handlers.get(type) || []).length; }
  };
}

function runtime(lang = 'kr', cards = []) {
  const modals = [];
  const externalOpens = [];
  const scrollArea = { scrollTop: 250 };
  const document = {
    body: { dataset: { page: 'home', lang, root: lang === 'en' ? '..' : '.' } },
    documentElement: { classList: { add() {} } }, addEventListener() {},
    querySelector: () => null,
    querySelectorAll: (selector) => selector.includes('[data-publication-id]') ? cards
      : selector === '[data-link]' ? cards.filter((card) => card.dataset.link) : []
  };
  const api = vm.runInNewContext(`(() => { ${source}\n
    openModal = (title, html) => captureModal(title, html);
    modalState.root = { querySelector: () => scrollArea };
    return { state, homePublicationCard, openPublicationModal, bindInteractiveCards, publicationCard };
  })()`, {
    ...utils, ...patents, ...inventors, ...data, document, URL, URLSearchParams, console,
    window: { matchMedia: () => ({ matches: true }), open: (...args) => externalOpens.push(args) },
    localStorage: { getItem: () => null }, hasFirebaseConfig: false, isLocalDevMode: true,
    COLLECTIONS: { members: 'members', projects: 'projects', publications: 'publications', patents: 'patents', board: 'boardPosts' },
    refreshImageFallbacks() {}, scrollArea, captureModal: (title, html) => modals.push({ title, html }),
    fetch() { throw new Error('Home publication tests must never contact a server.'); }
  }, { filename: 'public.js' });
  api.state.members = [member];
  api.state.publications = [publication];
  return { ...api, modals, externalOpens, scrollArea };
}

let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS: ${name}`); }
function sourceLink(html, href, label) {
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([anchor]) => anchor);
  const anchor = anchors.find((value) => value.includes(`href="${utils.escapeHTML(href)}"`));
  assert.ok(anchor, `Missing source link: ${href}`);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="[^"]*noreferrer[^\"]*"/);
  assert.ok(anchor.includes(label), `Missing source label: ${label}`);
}
function localDetailCard(html) {
  assert.doesNotMatch(html, /<a\b|\b(?:href|target|data-link)=/, 'Home cards must only open same-page details');
}

check('Home publication cards open same-page details; the source link appears only inside the popup in both languages', () => {
  for (const [lang, label] of [['kr', '논문 원문'], ['en', 'Read paper']]) {
    const r = runtime(lang);
    const html = r.homePublicationCard(publication);
    assert.match(html, /data-publication-id="home-paper"/);
    assert.match(html, /role="button"/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /aria-haspopup="dialog"/);
    localDetailCard(html);
    assert.ok(html.includes(lang === 'en' ? 'View details' : '상세 보기'));
    assert.ok(!html.includes(label), 'The source action must not remain on a home card');
    r.openPublicationModal(publication);
    assert.equal(r.modals[0].title, publication.title);
    assert.equal(r.scrollArea.scrollTop, 0, 'Details must start at the top after another paper was scrolled');
    const modal = r.modals[0].html;
    for (const text of [publication.journal, utils.escapeHTML(publication.authors), publication.abstract, 'Lab authors']) {
      assert.ok(modal.includes(text), `Missing detail: ${text}`);
    }
    assert.match(modal, /data-member-id="lab-member"/);
    sourceLink(modal, 'https://doi.org/10.1000/home-paper', label);
  }
});

check('URL-only papers keep their source URL; papers without a source still open useful details', () => {
  const r = runtime();
  const urlOnly = { ...publication, doi: '', url: 'https://example.test/paper?issue=9&source=lab' };
  localDetailCard(r.homePublicationCard(urlOnly));
  r.openPublicationModal(urlOnly);
  sourceLink(r.modals.at(-1).html, urlOnly.url, '논문 원문');
  const noSource = { ...publication, doi: '', url: '' };
  const card = r.homePublicationCard(noSource);
  assert.match(card, /data-publication-id="home-paper"/);
  localDetailCard(card);
  r.openPublicationModal(noSource);
  assert.ok(r.modals.at(-1).html.includes(publication.abstract));
  assert.doesNotMatch(r.modals.at(-1).html, /<a\b[^>]*href="(?:undefined|null|#|)"/);
});

check('Publication text and source attributes are escaped in home cards and details', () => {
  const r = runtime();
  const unsafe = { ...publication, title: '<img src=x onerror="alert(1)">',
    journal: '<script>journal</script>', authors: 'A & <svg onload="alert(1)">',
    abstract: '<script>abstract</script>', doi: '', url: 'https://example.test/paper?label="test"&x=1' };
  const card = r.homePublicationCard(unsafe);
  r.openPublicationModal(unsafe);
  assert.equal(r.modals[0].title, unsafe.title, 'The shared modal shell assigns the title with textContent');
  for (const html of [card, r.modals[0].html]) {
    assert.doesNotMatch(html, /<script>|<svg\b|<img\b/);
    assert.ok(html.includes(utils.escapeHTML(unsafe.authors)));
  }
  localDetailCard(card);
  sourceLink(r.modals[0].html, unsafe.url, '논문 원문');
  assert.ok(card.includes(utils.escapeHTML(unsafe.title)));
  assert.ok(r.modals[0].html.includes(utils.escapeHTML(unsafe.abstract)));
});

check('Home card, title, authors, detail CTA, Enter and Space open one popup each, including numeric IDs and legacy markup', () => {
  for (const id of [publication.id, 42]) {
    const card = eventCard(id);
    // Old markup must not reactivate the retired window.open handler.
    card.dataset.link = 'https://doi.org/10.1000/home-paper';
    const r = runtime('en', [card]);
    r.state.publications = [{ ...publication, id }];
    r.bindInteractiveCards();
    r.bindInteractiveCards();
    assert.equal(card.handlerCount('click'), 1, 'Re-render binding must not duplicate click actions');
    assert.equal(card.handlerCount('keydown'), 1);
    let opened = 0;
    const expectOnePopup = (run) => {
      run();
      opened++;
      assert.equal(r.modals.length, opened, 'Each interaction must open exactly one popup');
      assert.equal(r.modals.at(-1).title, publication.title);
      assert.equal(r.externalOpens.length, 0, 'The home card must never call window.open');
    };
    expectOnePopup(() => card.dispatch('click'));
    for (const tagName of ['H3', 'P', 'SPAN']) {
      const child = { tagName, closest: () => null };
      expectOnePopup(() => card.dispatch('click', { target: child }));
    }
    for (const key of ['Enter', ' ']) {
      expectOnePopup(() => assert.equal(card.dispatch('keydown', { key }).prevented, true));
    }
    assert.equal(card.dispatch('keydown', { key: 'ArrowDown' }).prevented, false);
    assert.equal(r.modals.length, opened);
    r.state.publications = [];
    card.dispatch('click');
    assert.equal(r.modals.length, opened, 'A removed record must not open stale details');
    assert.equal(r.externalOpens.length, 0, 'Legacy data-link must not navigate even when the record is missing');
  }
});

check('The standalone publication page retains DOI and disclosure behavior', () => {
  const html = runtime('en').publicationCard(publication);
  assert.doesNotMatch(html, /data-publication-id=|aria-haspopup="dialog"/);
  assert.match(html, /<details\b[\s\S]*Abstract/);
  assert.match(html, /<details\b[\s\S]*Lab authors/);
  sourceLink(html, 'https://doi.org/10.1000/home-paper', 'DOI');
});

console.log(`Verified ${checks} home publication detail checks.`);
