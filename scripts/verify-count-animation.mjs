import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import * as utils from '../assets/js/utils.js';
import * as patents from '../assets/js/patents.js';
import * as inventors from '../assets/js/patent-inventors.js';
import * as data from '../assets/js/data.js';
import * as memberSummary from '../assets/js/member-summary.js';
import { getPublicPageSource } from './public-test-source.mjs';

const source = (await getPublicPageSource()).replace(/^import\s+[\s\S]*?;\s*$/gm, '');
function fixture({ reduced = false, observer = true, target = 102, lang = 'kr', page = 'home', markup, search = '' } = {}) {
  const payload = { projectId: 'count-fixture', collections: { publications: { items: [], fetchedAt: 1234 } } };
  const content = markup ?? `<strong class="count-up" data-count-key="total" data-target="${target}">${target}</strong>`;
  const { document } = parseHTML(`<html><body data-page="${page}" data-lang="${lang}"><main>${content}</main><script id="public-page-data" type="application/json">${JSON.stringify(payload)}</script></body></html>`);
  const motion = { matches: reduced };
  const frames = [];
  const observed = new Set();
  let callback;
  let time = 1000;
  class Observer {
    constructor(fn) { callback = fn; }
    observe(item) { observed.add(item); }
    unobserve(item) { observed.delete(item); }
    disconnect() { observed.clear(); }
  }
  const window = { matchMedia: () => motion, GEH_FIREBASE_CONFIG: { projectId: 'count-fixture' } };
  if (observer) window.IntersectionObserver = Observer;
  const api = vm.runInNewContext(`(() => { ${source}\nreturn { setupCountAnimations, renderPage, applyCollectionItems, state }; })()`, {
    ...utils, ...patents, ...inventors, ...data, ...memberSummary, document, window, console, URL, URLSearchParams,
    location: { search },
    refreshImageFallbacks() {}, // These summary fixtures contain no images.
    localStorage: { getItem: () => null, removeItem() {} }, hasFirebaseConfig: true, isLocalDevMode: false,
    COLLECTIONS: { members: 'members', projects: 'projects', publications: 'publications', patents: 'patents', board: 'boardPosts' },
    IntersectionObserver: Observer, performance: { now: () => time },
    requestAnimationFrame: fn => frames.push(fn),
    fetch() { throw new Error('Counter motion must not request data'); }
  });
  return {
    ...api, document, motion, frames, observed,
    counter: () => document.querySelector('.count-up'),
    intersect(item, isIntersecting = true) { callback([{ target: item, isIntersecting }]); },
    frame(after) { time += after; const queue = frames.splice(0); queue.forEach(fn => fn(time)); },
    replace(target = 102) {
      const old = document.querySelector('.count-up');
      const item = old.cloneNode(true);
      item.dataset.target = String(target);
      item.textContent = String(target);
      item.removeAttribute('data-counted');
      item.removeAttribute('data-counting');
      old.replaceWith(item);
      return item;
    }
  };
}
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS: ${name}`); }
check('Server-populated counters animate on intersection in both locales and all existing counter pages', () => {
  for (const lang of ['kr', 'en']) for (const page of ['home', 'projects', 'publications']) {
    const f = fixture({ lang, page });
    const el = f.counter();
    f.setupCountAnimations();
    assert.equal(el.textContent, '102', 'Keep final content until the animation is visible');
    assert.ok(f.observed.has(el));
    f.intersect(el, false);
    assert.equal(f.frames.length, 0);
    f.intersect(el);
    f.frame(300);
    assert.ok(Number(el.textContent) > 0 && Number(el.textContent) < 102);
    f.setupCountAnimations();
    assert.notEqual(el.textContent, '102', 'Repeated setup must not interrupt an active animation');
    f.frame(600);
    assert.equal(el.textContent, '102');
    assert.equal(el.dataset.counting, 'false');
    f.setupCountAnimations();
    assert.equal(f.observed.size, 0);
    assert.equal(f.frames.length, 0);
  }
});
const members = [
  { id: 'pi', group: 'pi' },
  { id: 'postdoc', group: 'researchProfessor' },
  { id: 'student-1', group: 'graduateStudent', course: 'phd', track: 'fullTime' },
  { id: 'student-2', group: 'graduateStudent', course: 'ms', track: 'partTime' },
  { id: 'alumnus', group: 'graduateStudent', status: 'alumni', course: 'phd' }
];
const patentItems = ['granted', 'pending', 'pending'].map((status, index) => ({
  id: `patent-${index}`, titleKr: `특허 ${index}`, titleEn: `Patent ${index}`, status,
  applicationNumber: `application-${index}`, inventorMemberIds: []
}));
const patentMarkup = '<div id="patent-stat-grid"></div><input id="patent-search"><span id="patent-results"></span><div id="patent-accordion"></div>';

check('Real Members and Patents summaries animate in both locales without replaying on rerender', () => {
  for (const lang of ['kr', 'en']) for (const page of ['members', 'patents']) {
    const f = fixture({ lang, page, markup: page === 'members' ? '<div id="page-stat-grid"></div>' : patentMarkup });
    const expected = page === 'members' ? ['2', '2', '0', '1'] : ['3', '1', '2'];
    f.applyCollectionItems(page, page === 'members' ? members : patentItems);
    f.renderPage();
    const counters = [...f.document.querySelectorAll('.count-up')];
    assert.deepEqual(counters.map(el => el.dataset.target), expected, `${lang}/${page}: actual summary hooks`);
    assert.equal(new Set(counters.map(el => el.dataset.countKey)).size, expected.length);
    assert.ok(counters.every(el => el.dataset.countKey && f.observed.has(el)));
    counters.forEach(el => f.intersect(el));
    f.frame(100);
    assert.ok(counters.every(el => Number(el.dataset.target) === 0 || Number(el.textContent) < Number(el.dataset.target)));
    f.frame(800);
    assert.deepEqual(counters.map(el => el.textContent), expected);
    f.renderPage();
    assert.deepEqual([...f.document.querySelectorAll('.count-up')].map(el => el.textContent), expected);
    assert.equal(f.observed.size, 0, 'Unchanged totals must not replay when their markup is rendered again');
    assert.equal(f.frames.length, 0);
    if (page === 'patents') {
      f.state.patentFilter = 'granted';
      f.renderPage();
      assert.equal(f.document.querySelectorAll('.patent-card').length, 1);
      assert.deepEqual([...f.document.querySelectorAll('.count-up')].map(el => el.textContent), expected);
      assert.equal(f.observed.size, 0, 'Filtering the list must not replay unchanged totals');
    }
  }
});
check('Patent deep links observe the counters created by their second render', () => {
  for (const lang of ['kr', 'en']) {
    const f = fixture({ lang, page: 'patents', markup: patentMarkup, search: '?item=patent-1' });
    f.applyCollectionItems('patents', patentItems);
    f.renderPage();
    assert.equal(f.document.querySelector('#patent-search').value, 'application-1');
    assert.equal(f.document.querySelectorAll('.patent-card').length, 1);
    const counters = [...f.document.querySelectorAll('.count-up')];
    assert.equal(counters.length, 3);
    assert.ok(counters.every(el => f.observed.has(el)), 'Observe the connected summary after the deep-link rerender');
    assert.ok([...f.observed].every(el => el.isConnected), 'Do not retain replaced summary nodes');
    counters.forEach(el => f.intersect(el));
    f.frame(100);
    assert.ok(counters.every(el => Number(el.textContent) < Number(el.dataset.target)));
    f.frame(800);
    assert.deepEqual(counters.map(el => el.textContent), ['3', '1', '2']);
  }
});
check('Recreated statistics do not replay unchanged counts, but updated values can animate', () => {
  const f = fixture();
  f.setupCountAnimations(); f.intersect(f.counter()); f.frame(900);
  const same = f.replace();
  f.setupCountAnimations();
  assert.equal(same.textContent, '102');
  assert.equal(f.observed.size, 0);
  const changed = f.replace(103);
  f.setupCountAnimations();
  assert.ok(f.observed.has(changed));
  f.intersect(changed); f.frame(900);
  assert.equal(changed.textContent, '103');
});
check('Reduced motion and unavailable observers show final counts without frames', () => {
  for (const settings of [{ reduced: true }, { observer: false }]) {
    const f = fixture(settings);
    f.setupCountAnimations();
    assert.equal(f.counter().textContent, '102');
    assert.equal(f.frames.length, 0);
    assert.equal(f.observed.size, 0);
  }
});
check('Enabling reduced motion during animation finishes at the target', () => {
  const f = fixture();
  f.setupCountAnimations(); f.intersect(f.counter()); f.frame(100);
  f.motion.matches = true; f.frame(16);
  assert.equal(f.counter().textContent, '102');
  assert.equal(f.frames.length, 0);
});
check('Zero remains a real zero and queues no animation frames', () => {
  const f = fixture({ target: 0 });
  f.setupCountAnimations(); f.intersect(f.counter());
  assert.equal(f.counter().textContent, '0');
  assert.equal(f.frames.length, 0);
});
check('Replaced elements stop their frame loop and leave the observer', () => {
  const f = fixture();
  const old = f.counter();
  f.setupCountAnimations(); f.intersect(old);
  const replacement = f.replace();
  f.setupCountAnimations(); f.frame(50);
  assert.equal(f.frames.length, 0);
  assert.equal(f.observed.has(old), false);
  assert.equal(replacement.textContent, '102');
});
console.log(`Count animation: ${checks} regression checks passed (SSR, real summaries, deep links, viewport, repeated render, accessibility, cleanup).`);
