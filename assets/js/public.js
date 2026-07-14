import { BUILD_DATE, SITE_COPY, FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS, FALLBACK_BOARD_POSTS } from './data.js?v=79';
import {
  escapeHTML,
  slugify,
  getInitials,
  groupBy,
  rootAsset,
  sortMembers,
  sortProjects,
  sortPublications,
  sortBoardPosts,
  lastUpdated,
  formatDate,
  resolvePublicationLink,
  memberCourseLabel,
  memberTrackLabel,
  projectStatusLabel,
  mergeMembers,
  mergeProjects,
  mergePublications,
  mergeBoardPosts,
  memberYearLabel,
  publicationIndexingLabel,
  publicationYearMonthLabel,
  normalizeProjectPeriod,
  isActiveItem,
  formatEnglishName,
  setupAdaptiveGlass,
  setSpatialOrigin
} from './utils.js?v=110';
import { hasFirebaseConfig, isLocalDevMode, fetchCollection, listenCollection, COLLECTIONS } from './firebase-public.js?v=82';

document.documentElement.classList.add('js');

const body = document.body;
const page = body.dataset.page;
const lang = body.dataset.lang || 'kr';
const root = body.dataset.root || '.';
const copy = SITE_COPY[lang];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const BOARD_VIEW_STORAGE_KEY = 'geh-board-view-v1';
const BOARD_SORT_STORAGE_KEY = 'geh-board-sort-v1';

if (page === 'home' || page === 'board' || page === 'members') void import('../css/icons.css');

const qs = (selector) => document.querySelector(selector);
const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

function savedBoardView() {
  try {
    const value = localStorage.getItem(BOARD_VIEW_STORAGE_KEY);
    return value === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function saveBoardView(value) {
  try {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, value);
  } catch {
    // Display preferences can remain session-only when storage is unavailable.
  }
}

function savedBoardSort() {
  try {
    return localStorage.getItem(BOARD_SORT_STORAGE_KEY) === 'oldest' ? 'oldest' : 'newest';
  } catch {
    return 'newest';
  }
}

function saveBoardSort(value) {
  try {
    localStorage.setItem(BOARD_SORT_STORAGE_KEY, value);
  } catch {
    // Display preferences can remain session-only when storage is unavailable.
  }
}

function showPublicNotice(message, tone = 'warning') {
  const shell = qs('.site-shell');
  const header = qs('.site-header');
  if (!shell || !header) return;
  let notice = qs('#public-status-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'public-status-notice';
    notice.className = 'notice-banner public-status-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-atomic', 'true');
    header.insertAdjacentElement('afterend', notice);
  }
  notice.className = `notice-banner public-status-notice is-${tone}`;
  notice.textContent = message;
  notice.hidden = false;
}

function firstFilled(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function memberIdentityKey(member = {}) {
  const rawName = String(member.name || '').trim();
  const englishName = String(member.nameEn || (/^[\x00-\x7F]+$/.test(rawName) ? rawName : ''))
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (englishName) return `name-en:${englishName}`;
  const email = String(member.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const names = [member.nameKr, member.nameEn, member.name]
    .map((value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ''))
    .filter(Boolean);
  return `name:${[...new Set(names)].sort().join('|')}`;
}

function memberCompletenessScore(member = {}) {
  const fieldScore = Object.values(member).reduce((score, value) => {
    if (Array.isArray(value)) return score + value.length * 2;
    if (value === false || value === 0) return score + 1;
    return score + (value !== undefined && value !== null && String(value).trim() ? 1 : 0);
  }, 0);
  const statusCoherent = member.group === 'alumni' ? member.status === 'alumni' : member.status !== 'alumni';
  const bilingualName = String(member.nameKr || '').trim() && String(member.nameEn || '').trim();
  return fieldScore + (statusCoherent ? 100 : 0) + (bilingualName ? 10 : 0);
}

function dedupeMemberRecords(items = []) {
  const selected = new Map();
  (Array.isArray(items) ? items : []).forEach((member) => {
    const key = memberIdentityKey(member);
    const current = selected.get(key);
    if (!current || memberCompletenessScore(member) > memberCompletenessScore(current)) selected.set(key, member);
  });
  return [...selected.values()];
}

const RENDER_VOLATILE_FIELDS = new Set(['createdAt', 'updatedAt', 'deletedAt', 'purgeAfterAt']);

function stableRenderValue(value, key = '') {
  if (RENDER_VOLATILE_FIELDS.has(key)) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map((item) => stableRenderValue(item));
  if (typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, field) => {
      const next = stableRenderValue(value[field], field);
      if (next !== undefined) result[field] = next;
      return result;
    }, {});
  }
  return value;
}

function collectionRenderSignature(items = []) {
  return JSON.stringify(stableRenderValue(Array.isArray(items) ? items : []));
}

function stretchProjectGrid(grid) {
  if (!grid) return;
  grid.style.alignItems = 'stretch';
}

const focusImages = [
  'assets/images/background/hero-1.jpg',
  'assets/images/background/hero-2.jpg',
  'assets/images/background/hero-3.jpg'
].map((path) => rootAsset(path, root));

// Local preview uses fallback data plus localStorage overrides. Only a configured
// remote deployment should suppress fallback content while Firestore is loading.
const useLiveData = hasFirebaseConfig && !isLocalDevMode;
const prerenderedMembers = (() => {
  const source = document.querySelector('#member-roster-data');
  if (!source) return [];
  try {
    const parsed = JSON.parse(source.textContent || '[]');
    return Array.isArray(parsed) ? dedupeMemberRecords(sortMembers(parsed).filter(isActiveItem)) : [];
  } catch (error) {
    console.warn('초기 멤버 명단을 읽지 못했습니다.', error);
    return [];
  }
})();
const state = {
  members: prerenderedMembers.length
    ? prerenderedMembers
    : (useLiveData ? [] : dedupeMemberRecords(sortMembers(FALLBACK_MEMBERS).filter(isActiveItem))),
  projects: useLiveData ? [] : sortProjects(FALLBACK_PROJECTS).filter(isActiveItem),
  publications: useLiveData ? [] : sortPublications(FALLBACK_PUBLICATIONS).filter(isActiveItem),
  board: useLiveData ? [] : sortBoardPosts(FALLBACK_BOARD_POSTS).filter(isActiveItem),
  loadingMembers: useLiveData && !prerenderedMembers.length && (page === 'home' || page === 'members'),
  loadingProjects: useLiveData && (page === 'home' || page === 'projects'),
  loadingPublications: useLiveData && (page === 'home' || page === 'publications'),
  loadingBoard: useLiveData && (page === 'board' || page === 'home'),
  publicationQuery: '',
  boardTab: 'all',
  boardView: savedBoardView(),
  boardSort: savedBoardSort(),
  unsubs: []
};

let renderedMemberSignature = page === 'members' && prerenderedMembers.length
  ? collectionRenderSignature(prerenderedMembers)
  : '';

function replaceCollectionState(key, nextItems, loadingKey) {
  const previousSignature = collectionRenderSignature(state[key]);
  const nextSignature = collectionRenderSignature(nextItems);
  const wasLoading = Boolean(state[loadingKey]);
  state[key] = nextItems;
  state[loadingKey] = false;
  return previousSignature !== nextSignature || wasLoading;
}

function collectionAffectsCurrentPage(key) {
  const visibleCollections = {
    home: new Set(['members', 'projects', 'publications', 'board']),
    members: new Set(['members']),
    projects: new Set(['projects']),
    publications: new Set(['publications']),
    board: new Set(['board'])
  };
  return visibleCollections[page]?.has(key) === true;
}

const modalState = {
  root: null,
  title: null,
  body: null,
  closeButtons: [],
  closeButton: null,
  trigger: null,
  closeTimer: null,
  instant: false
};

// Firestore의 첫 응답이나 실시간 리스너가 멤버 프로필을 보는 도중 도착하면
// 카드/사진 전체가 다시 만들어져 프로필이 한 번 더 로딩되는 것처럼 보입니다.
// 열린 프로필은 그대로 유지하고, 닫은 뒤 최신 명단을 한 번만 반영합니다.
let pendingMemberPageRender = false;

function memberProfileModalIsOpen() {
  return page === 'members'
    && Boolean(modalState.root && !modalState.root.hidden)
    && Boolean(modalState.body?.querySelector('.detail-modal--member'));
}

function renderPageWithoutInterruptingMemberProfile() {
  if (memberProfileModalIsOpen()) {
    pendingMemberPageRender = true;
    return;
  }
  renderPage();
}

const PUBLIC_CACHE_KEY = 'geh-public-cache-v81';
const LEGACY_PUBLIC_CACHE_KEYS = ['geh-public-cache-v75', 'geh-public-cache-v76', 'geh-public-cache-v77', 'geh-public-cache-v80'];

try {
  LEGACY_PUBLIC_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
} catch {
  // Storage may be unavailable in privacy-restricted browsing contexts.
}


function cacheFresh(cache = {}, minutes = 15) {
  const savedAt = Number(cache?.savedAt || 0);
  if (!savedAt) return false;
  return (Date.now() - savedAt) <= minutes * 60 * 1000;
}

function snapshotSerializableState() {
  return {
    members: Array.isArray(state.members) ? state.members : [],
    projects: Array.isArray(state.projects) ? state.projects : [],
    publications: Array.isArray(state.publications) ? state.publications : [],
    board: Array.isArray(state.board) ? state.board : [],
    savedAt: Date.now()
  };
}

function readPublicCache() {
  try {
    const raw = localStorage.getItem(PUBLIC_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    console.warn('공개 캐시를 읽지 못했습니다.', error);
    return null;
  }
}

function writePublicCache() {
  try {
    localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(snapshotSerializableState()));
  } catch (error) {
    console.warn('공개 캐시를 저장하지 못했습니다.', error);
  }
}

function applyCachedState() {
  // 현재 버전에서 실제로 동기화된 최신 데이터만 먼저 보여주고,
  // Firestore 서버 응답은 백그라운드에서 다시 확인합니다.
  const cache = readPublicCache();
  if (!cache) return false;
  let applied = false;
  const fresh = cacheFresh(cache, 15);
  if (!prerenderedMembers.length && Array.isArray(cache.members) && cache.members.length && fresh) {
    state.members = dedupeMemberRecords(useLiveData ? sortMembers(cache.members).filter(isActiveItem) : sortMembers(mergeMembers(FALLBACK_MEMBERS, cache.members)).filter(isActiveItem));
    state.loadingMembers = false;
    applied = true;
  }
  if (Array.isArray(cache.projects) && cache.projects.length && fresh) {
    state.projects = mergedProjectsForPage(cache.projects);
    state.loadingProjects = false;
    applied = true;
  }
  if (Array.isArray(cache.publications) && cache.publications.length && fresh) {
    state.publications = useLiveData ? sortPublications(cache.publications).filter(isActiveItem) : sortPublications(mergePublications(FALLBACK_PUBLICATIONS, cache.publications)).filter(isActiveItem);
    state.loadingPublications = false;
    applied = true;
  }
  if (Array.isArray(cache.board) && cache.board.length && fresh && (!useLiveBoardOnly() || boardCacheFresh(cache))) {
    state.board = mergedBoardForPage(cache.board);
    state.loadingBoard = false;
    applied = true;
  }
  return applied;
}


function useLiveProjectsOnly() {
  return useLiveData;
}

function useLiveBoardOnly() {
  return useLiveData;
}

function normalizeBoardForPage(items = []) {
  return sortBoardPosts((Array.isArray(items) ? items : []).filter(isActiveItem));
}

function mergedBoardForPage(items = []) {
  if (useLiveBoardOnly()) return normalizeBoardForPage(items);
  return sortBoardPosts(mergeBoardPosts(FALLBACK_BOARD_POSTS, items)).filter(isActiveItem);
}

function boardCacheFresh(cache = {}) {
  const savedAt = Number(cache?.savedAt || 0);
  if (!savedAt) return false;
  return (Date.now() - savedAt) <= 10 * 60 * 1000;
}

function normalizeProjectsForPage(items = []) {
  return sortProjects((Array.isArray(items) ? items : []).filter(isActiveItem));
}

function mergedProjectsForPage(items = []) {
  if (useLiveProjectsOnly()) return normalizeProjectsForPage(items);
  return sortProjects(mergeProjects(FALLBACK_PROJECTS, items)).filter(isActiveItem);
}

function projectStatSkeleton(label) {
  return `<article class="stat-card stat-card--skeleton reveal"><strong class="skeleton-line skeleton-line--number"></strong><span>${escapeHTML(label)}</span></article>`;
}

function projectSkeletonCard() {
  return `
    <article class="project-card project-card--skeleton compact-card reveal">
      <div class="card-head"><span class="status-pill status-pill--ghost"></span><span class="period-pill period-pill--ghost"></span></div>
      <div class="skeleton-line skeleton-line--title"></div>
      <div class="skeleton-line skeleton-line--text"></div>
      <div class="skeleton-line skeleton-line--text short"></div>
      <div class="skeleton-line skeleton-line--meta"></div>
      <div class="tag-row">
        <span class="keyword-tag keyword-tag--ghost"></span>
        <span class="keyword-tag keyword-tag--ghost"></span>
        <span class="keyword-tag keyword-tag--ghost"></span>
      </div>
    </article>
  `;
}


function skeletonPill(width = '5rem') {
  return '<span class="skeleton-pill" style="--skeleton-width:' + escapeHTML(width) + '"></span>';
}

function memberSkeletonCard() {
  return [
    '<article class="member-card member-card--skeleton reveal" aria-hidden="true">',
    '<div class="member-thumb skeleton-thumb"></div>',
    '<div class="member-copy">',
    '<div class="member-chip-row">',
    '<span class="member-chip member-chip--soft skeleton-pill skeleton-pill--chip"></span>',
    '<span class="member-chip member-chip--soft skeleton-pill skeleton-pill--chip skeleton-pill--short"></span>',
    '</div>',
    '<span class="skeleton-line skeleton-line--member-title"></span>',
    '<span class="skeleton-line skeleton-line--member-text"></span>',
    '<span class="skeleton-line skeleton-line--member-text short"></span>',
    '<span class="skeleton-line skeleton-line--member-link"></span>',
    '</div>',
    '</article>'
  ].join('');
}

function memberGridSkeleton(count = 3, modifier = '') {
  return '<div class="member-grid member-grid--skeleton ' + escapeHTML(modifier) + '" data-count="' + escapeHTML(count) + '">' + Array.from({ length: count }, () => memberSkeletonCard()).join('') + '</div>';
}

function piSkeletonCard() {
  return [
    '<div class="pi-card-layout pi-card-layout--skeleton" aria-hidden="true">',
    '<div class="pi-photo pi-photo--skeleton skeleton-thumb"></div>',
    '<div class="pi-card-main">',
    '<div class="pi-card-head">',
    '<span class="skeleton-line skeleton-line--eyebrow"></span>',
    '<span class="skeleton-line skeleton-line--pi-title"></span>',
    '<span class="skeleton-line skeleton-line--pi-subtitle"></span>',
    '<span class="skeleton-pill skeleton-pill--button"></span>',
    '</div>',
    '<div class="pi-card-grid pi-card-grid--skeleton">',
    Array.from({ length: 4 }).map(() => [
      '<article>',
      '<span class="skeleton-line skeleton-line--panel-heading"></span>',
      '<span class="skeleton-line skeleton-line--text"></span>',
      '<span class="skeleton-line skeleton-line--text short"></span>',
      '</article>'
    ].join('')).join(''),
    '</div>',
    '</div>',
    '</div>'
  ].join('');
}

function publicationSkeletonCard() {
  return [
    '<article class="publication-card publication-card--skeleton reveal" aria-hidden="true">',
    '<div class="publication-head-row"><div class="publication-topline">',
    '<span class="skeleton-pill skeleton-pill--year"></span>',
    '<span class="skeleton-pill skeleton-pill--journal"></span>',
    '<span class="skeleton-pill skeleton-pill--index"></span>',
    '</div></div>',
    '<span class="skeleton-line skeleton-line--publication-title"></span>',
    '<span class="skeleton-line skeleton-line--publication-title short"></span>',
    '<div class="publication-meta-row">',
    '<span class="skeleton-line skeleton-line--publication-authors"></span>',
    '<span class="skeleton-pill skeleton-pill--doi"></span>',
    '</div>',
    '<span class="skeleton-line skeleton-line--divider"></span>',
    '<span class="skeleton-line skeleton-line--publication-extra"></span>',
    '</article>'
  ].join('');
}

function publicationListSkeleton(count = 3) {
  return '<div class="publication-list publication-list--skeleton">' + Array.from({ length: count }, () => publicationSkeletonCard()).join('') + '</div>';
}

function homePublicationSkeletonCard() {
  return [
    '<article class="home-publication-card home-publication-card--skeleton reveal" aria-hidden="true">',
    '<div class="publication-topline home-publication-card__topline">',
    '<span class="skeleton-pill skeleton-pill--year"></span>',
    '<span class="skeleton-pill skeleton-pill--journal"></span>',
    '<span class="skeleton-pill skeleton-pill--index"></span>',
    '</div>',
    '<span class="skeleton-line skeleton-line--home-title"></span>',
    '<span class="skeleton-line skeleton-line--home-title short"></span>',
    '<span class="skeleton-line skeleton-line--home-text"></span>',
    '<span class="skeleton-pill skeleton-pill--doi"></span>',
    '</article>'
  ].join('');
}

function homeNewsSkeletonCard() {
  return [
    '<article class="home-news-card home-news-card--skeleton reveal" aria-hidden="true">',
    '<div class="home-news-card__copy">',
    '<div class="member-chip-row">',
    '<span class="member-chip member-chip--soft skeleton-pill skeleton-pill--chip"></span>',
    '<span class="member-chip member-chip--soft skeleton-pill skeleton-pill--chip skeleton-pill--short"></span>',
    '</div>',
    '<span class="skeleton-line skeleton-line--home-title"></span>',
    '<span class="skeleton-line skeleton-line--home-text"></span>',
    '</div>',
    '<div class="home-news-card__media skeleton-media"></div>',
    '</article>'
  ].join('');
}

function memberDisplayName(member, locale = lang) {
  if (!member) return '';
  return locale === 'en'
    ? firstFilled(formatEnglishName(member.nameEn), formatEnglishName(member.name), member.nameKr)
    : firstFilled(member.nameKr, formatEnglishName(member.name), formatEnglishName(member.nameEn));
}

function normalizeLookupKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
}

function findMemberByAnyName(value = '') {
  const target = normalizeLookupKey(value);
  if (!target) return null;
  return state.members.find((member) => [member.id, member.nameKr, member.nameEn, member.name].some((candidate) => normalizeLookupKey(candidate) === target)) || null;
}

function resolveProjectInvestigatorMember(project = {}) {
  if (project.principalInvestigatorId) {
    const byId = state.members.find((member) => member.id === project.principalInvestigatorId);
    if (byId) return byId;
  }
  return findMemberByAnyName(project.principalInvestigator || '');
}

function projectInvestigatorName(project = {}, locale = lang) {
  const member = resolveProjectInvestigatorMember(project);
  if (member) return memberDisplayName(member, locale);
  return project.principalInvestigator || '';
}

function localizedMemberText(member = {}, key, locale = lang) {
  const primary = locale === 'en' ? `${key}En` : `${key}Kr`;
  const secondary = locale === 'en' ? `${key}Kr` : `${key}En`;
  return firstFilled(member[primary], member[key], member[secondary], key === 'education' ? (locale === 'en' ? member.educationEn : member.educationKr) : '', key === 'education' ? (locale === 'en' ? member.educationKr : member.educationEn) : '');
}

function localizedExperienceDetail(entry = {}, locale = lang) {
  return locale === 'en'
    ? firstFilled(entry.detailEn, entry.detail, entry.detailKr)
    : firstFilled(entry.detailKr, entry.detail, entry.detailEn);
}

function normalizeExperienceEntries(value = '') {
  const rawLines = String(value || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const segments = rawLines.flatMap((line) => /\|/.test(line) ? [line] : line.split(/\s+[·•]\s+/).map((chunk) => chunk.trim()).filter(Boolean));
  return segments.map((segment) => {
    const pipeMatch = segment.match(/^([^|]+)\|\s*(.+)$/);
    if (pipeMatch) return { period: pipeMatch[1].trim(), detail: pipeMatch[2].trim() };
    const parenMatch = segment.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (parenMatch) return { period: parenMatch[2].trim(), detail: parenMatch[1].trim() };
    return { period: '', detail: segment.trim() };
  }).filter((entry) => entry.period || entry.detail);
}

function memberExperienceEntries(member = {}) {
  if (Array.isArray(member.experienceEntries) && member.experienceEntries.length) {
    return member.experienceEntries.filter((entry) => {
      return [entry?.period, entry?.detailKr, entry?.detailEn, entry?.detail].some((value) => String(value || '').trim());
    });
  }
  return normalizeExperienceEntries(localizedMemberText(member, 'experience', 'en') || localizedMemberText(member, 'experience', 'kr') || member.experience || '');
}

function memberExperienceMarkup(member = {}, locale = lang, variant = 'detail') {
  const entries = memberExperienceEntries(member).map((entry) => {
    const detail = localizedExperienceDetail(entry, locale);
    const detailParts = String(detail || '').split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
    return {
      period: String(entry.period || '').trim(),
      role: detailParts.shift() || '',
      organization: detailParts.join(' | ')
    };
  }).filter((entry) => entry.period || entry.role || entry.organization);
  if (!entries.length) return '';
  return `
    <div class="member-experience-lines member-experience-lines--${escapeHTML(variant)}" role="list">
      ${entries.map((entry) => `
        <div class="member-experience-item${entry.period ? '' : ' member-experience-item--plain'}" role="listitem">
          ${entry.period ? `<span class="member-experience-period">${escapeHTML(entry.period)}</span>` : ''}
          <span class="member-experience-copy">
            ${entry.role ? `<strong>${escapeHTML(entry.role)}</strong>` : ''}
            ${entry.organization ? `<small>${escapeHTML(entry.organization)}</small>` : ''}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}


function multilineText(value = '') {
  return escapeHTML(String(value || '')).replace(/\n+/g, '<br>');
}

function detailHtmlSection(title, html = '') {
  if (!html) return '';
  return `
    <article class="detail-block">
      <h4>${escapeHTML(title)}</h4>
      <div class="detail-block__body">${html}</div>
    </article>
  `;
}

function memberEducationValue(member = {}, baseKey = '', locale = lang) {
  const primarySuffix = locale === 'en' ? 'En' : 'Kr';
  const secondarySuffix = locale === 'en' ? 'Kr' : 'En';
  return firstFilled(
    member[`${baseKey}${primarySuffix}`],
    member[baseKey],
    member[`${baseKey}${secondarySuffix}`]
  );
}

function memberEducationEntries(member = {}, locale = lang) {
  const degreeLabels = locale === 'en'
    ? { bs: 'B.S.', ms: 'M.S.', phd: 'Ph.D.' }
    : { bs: '학사', ms: '석사', phd: '박사' };
  const specs = [
    ['bs', memberEducationValue(member, 'bachelorsSchool', locale), memberEducationValue(member, 'bachelorsMajor', locale)],
    ['ms', memberEducationValue(member, 'mastersSchool', locale), memberEducationValue(member, 'mastersMajor', locale)],
    ['phd', memberEducationValue(member, 'doctoralSchool', locale), memberEducationValue(member, 'doctoralMajor', locale)]
  ];
  const entries = specs
    .filter(([, school, major]) => String(school || '').trim() || String(major || '').trim())
    .map(([key, school, major]) => ({
      degree: degreeLabels[key],
      school: String(school || '').trim(),
      major: String(major || '').trim()
    }));
  if (entries.length) return entries;

  const fallback = [];
  String((locale === 'en' ? (member.educationEn || member.education) : (member.educationKr || member.education)) || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const degreeMatch = line.match(/^(학사|석사|박사|B\.?S\.?|M\.?S\.?|Ph\.?D\.?)\s*(?:[·•|]\s*)?(.*)$/i);
      if (degreeMatch) {
        const details = String(degreeMatch[2] || '').split(/\s+[·•|]\s+/).map((part) => part.trim()).filter(Boolean);
        fallback.push({ degree: degreeMatch[1], school: details.shift() || '', major: details.join(' | ') });
        return;
      }
      const details = line.split(/\s+[·•|]\s+/).map((part) => part.trim()).filter(Boolean);
      if (fallback.length && !fallback[fallback.length - 1].major && details.length === 1) {
        fallback[fallback.length - 1].major = details[0];
        return;
      }
      fallback.push({ degree: '', school: details.shift() || '', major: details.join(' | ') });
    });
  return fallback;
}

function memberEducationMarkup(member = {}, locale = lang, variant = 'detail') {
  const entries = memberEducationEntries(member, locale);
  if (!entries.length) return '';
  return `
    <div class="member-education-lines member-education-lines--${escapeHTML(variant)}" role="list">
      ${entries.map((entry) => `
        <div class="member-education-item${entry.degree ? '' : ' member-education-item--plain'}" role="listitem">
          ${entry.degree ? `<span class="member-education-degree">${escapeHTML(entry.degree)}</span>` : ''}
          <span class="member-education-copy">
            ${entry.school ? `<strong>${escapeHTML(entry.school)}</strong>` : ''}
            ${entry.major ? `<small>${escapeHTML(entry.major)}</small>` : ''}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

function memberCourseScheduleEntries(member = {}) {
  return (Array.isArray(member.courseSchedule) ? member.courseSchedule : []).filter((entry) => {
    return ['time', 'courseName', 'credits', 'description'].some((key) => String(entry?.[key] || '').trim());
  });
}

function memberCourseScheduleMarkup(member = {}, locale = lang) {
  const rows = memberCourseScheduleEntries(member);
  if (!rows.length) return '';
  const labels = locale === 'en'
    ? { day: 'Day', time: 'Time', name: 'Course', credits: 'Credits', description: 'Description' }
    : { day: '요일', time: '시간', name: '강의명', credits: '학점', description: '강의 내용' };
  const dayMap = locale === 'en'
    ? { '월': 'Mon', '화': 'Tue', '수': 'Wed', '목': 'Thu', '금': 'Fri' }
    : {};
  return `
    <div class="schedule-table-wrap">
      <table class="schedule-table">
        <thead>
          <tr>
            <th>${escapeHTML(labels.day)}</th>
            <th>${escapeHTML(labels.time)}</th>
            <th>${escapeHTML(labels.name)}</th>
            <th>${escapeHTML(labels.credits)}</th>
            <th>${escapeHTML(labels.description)}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((entry) => `
            <tr>
              <td>${escapeHTML(dayMap[entry.day] || entry.day || '')}</td>
              <td>${escapeHTML(entry.time || '')}</td>
              <td>${escapeHTML(entry.courseName || '')}</td>
              <td>${escapeHTML(entry.credits || '')}</td>
              <td>${escapeHTML(entry.description || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function memberCourseSectionMarkup(member = {}, locale = lang) {
  const title = locale === 'en' ? 'Course schedule' : '수업 시간표';
  const table = member.group === 'pi' ? memberCourseScheduleMarkup(member, locale) : '';
  return table ? detailHtmlSection(title, table) : '';
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.GEH_BOOT_TIMEOUT) window.clearTimeout(window.GEH_BOOT_TIMEOUT);
  if (document.documentElement.classList.contains('js-fallback')) {
    qsa('.reveal').forEach((item) => item.classList.add('is-visible'));
    document.documentElement.classList.remove('js-fallback');
  }
  setupAdaptiveGlass(document);
  setupHeader();
  ensureModal();
  setupRevealAnimations();
  setupSearch();
  if (page === 'home') setupHeroSlider();

  // Firestore 데이터를 불러오기 전에는 로딩 상태를 보여줍니다.
  // 로컬/오프라인 모드에서만 캐시 또는 기본 데이터를 사용합니다.
  applyCachedState();
  renderPage();
  hydrate().catch((error) => console.warn('초기 데이터 동기화 실패', error));
});

async function hydrate() {
  if (!hasFirebaseConfig) return;
  const readSafely = async (collectionName) => {
    try {
      return await fetchCollection(collectionName);
    } catch (error) {
      console.warn(`${collectionName} 컬렉션을 불러오지 못했습니다.`, error);
      showPublicNotice(lang === 'en'
        ? 'Some live content could not be loaded. Please try again shortly.'
        : '일부 실시간 콘텐츠를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger');
      return [];
    }
  };

  const pageCollections = {
    home: [COLLECTIONS.members, COLLECTIONS.projects, COLLECTIONS.publications, COLLECTIONS.board],
    members: [COLLECTIONS.members, COLLECTIONS.publications],
    projects: [COLLECTIONS.projects],
    publications: [COLLECTIONS.publications, COLLECTIONS.members],
    board: [COLLECTIONS.board]
  };
  const collectionNames = (pageCollections[page] || []).filter(Boolean);
  if (!collectionNames.length) return;

  const resultMap = new Map();
  const settled = await Promise.allSettled(collectionNames.map((collectionName) => readSafely(collectionName)));
  settled.forEach((result, index) => {
    const collectionName = collectionNames[index];
    resultMap.set(collectionName, result.status === 'fulfilled' ? result.value : []);
  });

  const members = resultMap.get(COLLECTIONS.members) || [];
  const projects = resultMap.get(COLLECTIONS.projects) || [];
  const publications = resultMap.get(COLLECTIONS.publications) || [];
  const board = COLLECTIONS.board ? (resultMap.get(COLLECTIONS.board) || []) : [];
  let shouldRender = false;

  if (resultMap.has(COLLECTIONS.members)) {
    const nextItems = dedupeMemberRecords(useLiveData ? sortMembers(members).filter(isActiveItem) : sortMembers(mergeMembers(FALLBACK_MEMBERS, members)).filter(isActiveItem));
    const changed = replaceCollectionState('members', nextItems, 'loadingMembers');
    shouldRender = shouldRender || (changed && collectionAffectsCurrentPage('members'));
  }
  if (resultMap.has(COLLECTIONS.projects)) {
    const changed = replaceCollectionState('projects', mergedProjectsForPage(projects), 'loadingProjects');
    shouldRender = shouldRender || (changed && collectionAffectsCurrentPage('projects'));
  }
  if (resultMap.has(COLLECTIONS.publications)) {
    const nextItems = useLiveData ? sortPublications(publications).filter(isActiveItem) : sortPublications(mergePublications(FALLBACK_PUBLICATIONS, publications)).filter(isActiveItem);
    const changed = replaceCollectionState('publications', nextItems, 'loadingPublications');
    shouldRender = shouldRender || (changed && collectionAffectsCurrentPage('publications'));
  }
  if (resultMap.has(COLLECTIONS.board)) {
    const changed = replaceCollectionState('board', mergedBoardForPage(board), 'loadingBoard');
    shouldRender = shouldRender || (changed && collectionAffectsCurrentPage('board'));
  }

  writePublicCache();
  if (shouldRender) renderPageWithoutInterruptingMemberProfile();

  state.unsubs.forEach((unsub) => { try { unsub(); } catch {} });
  state.unsubs = [];
  const addListener = (collectionName, onItems) => {
    try {
      state.unsubs.push(listenCollection(collectionName, onItems, (error) => {
        console.warn(`${collectionName} 실시간 동기화 실패`, error);
        showPublicNotice(lang === 'en'
          ? 'Live updates are temporarily unavailable. The latest loaded content remains visible.'
          : '실시간 업데이트 연결이 일시적으로 중단되었습니다. 마지막으로 불러온 내용을 표시합니다.', 'warning');
      }));
    } catch (error) {
      console.warn(`${collectionName} 리스너 연결 실패`, error);
    }
  };

  if (collectionNames.includes(COLLECTIONS.members)) addListener(COLLECTIONS.members, (items) => {
    const nextItems = dedupeMemberRecords(useLiveData ? sortMembers(items).filter(isActiveItem) : sortMembers(mergeMembers(FALLBACK_MEMBERS, items)).filter(isActiveItem));
    const changed = replaceCollectionState('members', nextItems, 'loadingMembers');
    writePublicCache();
    if (changed && collectionAffectsCurrentPage('members')) renderPageWithoutInterruptingMemberProfile();
  });
  if (collectionNames.includes(COLLECTIONS.projects)) addListener(COLLECTIONS.projects, (items) => {
    const changed = replaceCollectionState('projects', mergedProjectsForPage(items), 'loadingProjects');
    writePublicCache();
    if (changed && collectionAffectsCurrentPage('projects')) renderPage();
  });
  if (collectionNames.includes(COLLECTIONS.publications)) addListener(COLLECTIONS.publications, (items) => {
    const nextItems = useLiveData ? sortPublications(items).filter(isActiveItem) : sortPublications(mergePublications(FALLBACK_PUBLICATIONS, items)).filter(isActiveItem);
    const changed = replaceCollectionState('publications', nextItems, 'loadingPublications');
    writePublicCache();
    if (changed && collectionAffectsCurrentPage('publications')) renderPage();
  });
  if (collectionNames.includes(COLLECTIONS.board)) {
    addListener(COLLECTIONS.board, (items) => {
      const changed = replaceCollectionState('board', mergedBoardForPage(items), 'loadingBoard');
      writePublicCache();
      if (changed && collectionAffectsCurrentPage('board')) renderPage();
    });
  }
}

function renderPage() {

  if (page === 'home') renderHome();
  if (page === 'members') renderMembers();
  if (page === 'projects') renderProjects();
  if (page === 'publications') renderPublications();
  if (page === 'board') renderBoard();
  setUpdatedDate();
  setupRevealAnimations();
  setupAccordions();
  setupCountAnimations();
  bindInteractiveCards();
}

function setupLiquidNavLens(panel) {
  if (!panel || panel.dataset.liquidLensBound === 'true') return;
  const links = () => qsa(':scope > a', panel);
  const lens = document.createElement('span');
  lens.className = 'site-nav__lens';
  lens.setAttribute('aria-hidden', 'true');
  panel.prepend(lens);
  panel.dataset.liquidLensBound = 'true';

  let currentLink = null;
  let pressedLink = null;
  let pointerId = null;
  let selecting = false;
  let longPressTimer = 0;
  let suppressNextClick = false;

  const activeLink = () => links().find((link) => link.classList.contains('is-active') || link.hasAttribute('aria-current')) || links()[0];
  const moveLens = (link, immediate = false) => {
    if (!link?.isConnected || !panel.contains(link)) return;
    if (currentLink === link && !immediate) return;
    currentLink?.classList.remove('is-lens-target');
    currentLink = link;
    currentLink.classList.add('is-lens-target');
    const linkRect = link.getBoundingClientRect();
    if (!linkRect.width || !linkRect.height) return;
    lens.classList.toggle('is-immediate', immediate);
    lens.style.width = `${linkRect.width}px`;
    lens.style.height = `${linkRect.height}px`;
    lens.style.transform = `translate3d(${link.offsetLeft}px, ${link.offsetTop}px, 0)`;
    lens.classList.add('is-visible');
    if (immediate) requestAnimationFrame(() => lens.classList.remove('is-immediate'));
  };
  const settle = (immediate = false) => moveLens(activeLink(), immediate);
  const realign = (immediate = false) => moveLens(currentLink || activeLink(), immediate);
  const linkAtPoint = (x, y) => document.elementFromPoint(x, y)?.closest('.site-nav a');

  links().forEach((link) => {
    link.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && !pressedLink) moveLens(link);
    });
    link.addEventListener('mouseenter', () => {
      if (!pressedLink) moveLens(link);
    });
    link.addEventListener('focus', () => moveLens(link));
    link.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      pressedLink = link;
      pointerId = event.pointerId;
      selecting = false;
      moveLens(link);
      window.clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(() => {
        selecting = true;
        panel.classList.add('is-touch-selecting');
      }, 320);
    });
  });

  const trackPointer = (event) => {
    if (!pressedLink || event.pointerId !== pointerId || !selecting) return;
    event.preventDefault();
    const target = linkAtPoint(event.clientX, event.clientY);
    if (target && panel.contains(target)) moveLens(target);
  };

  const finishPointer = (event, cancelled = false) => {
    if (!pressedLink || event.pointerId !== pointerId) return;
    window.clearTimeout(longPressTimer);
    panel.classList.remove('is-touch-selecting');
    const destination = selecting && !cancelled ? currentLink : null;
    const origin = pressedLink;
    pressedLink = null;
    pointerId = null;
    selecting = false;
    if (destination && destination !== origin) {
      suppressNextClick = true;
      window.location.assign(destination.href);
      return;
    }
    window.setTimeout(() => settle(), 90);
  };

  window.addEventListener('pointermove', trackPointer, { passive: false });
  window.addEventListener('pointerup', (event) => finishPointer(event));
  window.addEventListener('pointercancel', (event) => finishPointer(event, true));
  panel.addEventListener('pointerleave', (event) => {
    if (!pressedLink && event.pointerType === 'mouse') settle();
  });
  panel.addEventListener('mousemove', (event) => {
    if (pressedLink) return;
    const target = event.target.closest?.('.site-nav a');
    if (target && target !== currentLink) moveLens(target);
  }, { passive: true });
  panel.addEventListener('contextmenu', (event) => {
    if (pressedLink || selecting) event.preventDefault();
  });
  panel.addEventListener('click', (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const resizeObserver = new ResizeObserver(() => realign(true));
  resizeObserver.observe(panel);
  window.addEventListener('resize', () => realign(true), { passive: true });
  requestAnimationFrame(() => settle(true));
}

function setupHeader() {
  const toggle = qs('[data-menu-toggle]');
  const panel = qs('[data-nav-panel]');
  const header = qs('.site-header');
  const adminButton = qs('.site-header .icon-button[href]');
  const activePage = page === 'member-profile' ? 'members' : page;
  const activeLink = qs(`.site-nav a[data-nav-page="${activePage}"]`);
  activeLink?.classList.add('is-active');
  activeLink?.setAttribute('aria-current', 'page');
  const languageLabels = {
    ko: {
      code: 'KO',
      name: lang === 'en' ? 'Korean' : '한국어',
      flag: 'assets/images/flags/kr.svg'
    },
    en: {
      code: 'EN',
      name: 'English',
      flag: 'assets/images/flags/us.svg'
    }
  };

  qsa('.lang-switch .lang-link').forEach((link) => {
    const language = link.textContent.trim().toLowerCase() === 'en' ? 'en' : 'ko';
    const option = languageLabels[language];
    const isCurrent = link.classList.contains('is-active');
    link.dataset.language = language;
    link.hreflang = language;
    link.setAttribute('aria-label', isCurrent
      ? (lang === 'en' ? `Current language: ${option.name}` : `현재 언어: ${option.name}`)
      : (lang === 'en' ? `Switch to ${option.name}` : `${option.name}로 전환`));
    if (isCurrent) link.setAttribute('aria-current', 'true');
    Array.from(link.childNodes).forEach((node) => {
      if (node.nodeType === 3) node.remove();
    });
    let flag = link.querySelector('.lang-flag');
    if (!flag) {
      flag = document.createElement('img');
      flag.className = 'lang-flag';
      flag.alt = '';
      flag.width = 24;
      flag.height = 16;
      flag.decoding = 'async';
      flag.setAttribute('aria-hidden', 'true');
      link.prepend(flag);
    }
    flag.src = rootAsset(option.flag, root);

    let code = link.querySelector('.lang-code');
    if (!code) {
      code = document.createElement('span');
      code.className = 'lang-code';
      link.append(code);
    }
    code.textContent = option.code;
  });

  if (panel && toggle) {
    panel.id ||= 'site-navigation';
    toggle.setAttribute('aria-controls', panel.id);
  }

  if (adminButton) {
    const adminLabel = lang === 'en' ? 'Admin settings' : '관리자 설정';
    adminButton.setAttribute('aria-label', adminLabel);
    adminButton.setAttribute('title', adminLabel);
  }

  panel?.querySelectorAll('.nav-admin-link').forEach((link) => link.remove());
  setupLiquidNavLens(panel);

  const setMenuOpen = (open, { returnFocus = false, focusFirst = false } = {}) => {
    if (!panel || !toggle) return;
    const desktop = window.matchMedia('(min-width: 1101px)').matches;
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!desktop && !open));
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', lang === 'en'
      ? (open ? 'Close menu' : 'Open menu')
      : (open ? '메뉴 닫기' : '메뉴 열기'));
    if (open && focusFirst) panel.querySelector('a')?.focus();
    if (!open && returnFocus) toggle.focus({ preventScroll: true });
  };

  setMenuOpen(false);
  toggle?.addEventListener('click', (event) => {
    const nextOpen = toggle.getAttribute('aria-expanded') !== 'true';
    setMenuOpen(nextOpen, { focusFirst: nextOpen && event.detail === 0 });
  });

  qsa('.site-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      setMenuOpen(false);
    });
  });

  document.addEventListener('click', (event) => {
    if (!panel?.classList.contains('is-open')) return;
    const target = event.target;
    if (header?.contains(target)) return;
    setMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !panel?.classList.contains('is-open')) return;
    event.preventDefault();
    setMenuOpen(false, { returnFocus: true });
  });

  window.matchMedia('(min-width: 1101px)').addEventListener?.('change', (event) => {
    if (event.matches) setMenuOpen(false);
  });

  if (header) {
    let sentinel = qs('.header-scroll-sentinel');
    if (!sentinel) {
      sentinel = document.createElement('span');
      sentinel.className = 'header-scroll-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      document.body.prepend(sentinel);
    }
    const observer = new IntersectionObserver(([entry]) => {
      header.classList.toggle('is-scrolled', !entry.isIntersecting);
    }, { threshold: 0 });
    observer.observe(sentinel);
  }
}

function ensureModal() {
  if (modalState.root) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'site-modal';
  wrapper.hidden = true;
  wrapper.innerHTML = `
    <div class="site-modal__backdrop" data-modal-close></div>
    <div class="site-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="site-modal-title">
      <button type="button" class="site-modal__close" data-modal-close aria-label="${lang === 'en' ? 'Close details' : '상세 정보 닫기'}">×</button>
      <div class="site-modal__scroll">
        <div class="site-modal__head">
          <h2 id="site-modal-title"></h2>
        </div>
        <div class="site-modal__content"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);
  modalState.root = wrapper;
  modalState.title = wrapper.querySelector('#site-modal-title');
  modalState.body = wrapper.querySelector('.site-modal__content');
  modalState.closeButtons = qsa('[data-modal-close]', wrapper);
  modalState.closeButton = wrapper.querySelector('.site-modal__close');
  modalState.closeButtons.forEach((button) => button.addEventListener('click', closeModal));
  document.addEventListener('keydown', (event) => {
    if (wrapper.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = qsa('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', wrapper)
      .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function openModal(title, html) {
  ensureModal();
  window.clearTimeout(modalState.closeTimer);
  const wasOpen = !modalState.root.hidden && modalState.root.classList.contains('is-open');
  if (!wasOpen) modalState.trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalState.title.textContent = title;
  modalState.body.innerHTML = html;
  modalState.root.hidden = false;
  modalState.root.setAttribute('aria-hidden', 'false');
  modalState.root.classList.toggle('is-instant', modalState.instant);
  document.body.classList.add('modal-open');
  bindInteractiveCards();
  setSpatialOrigin(modalState.root.querySelector('.site-modal__dialog'), modalState.trigger);
  requestAnimationFrame(() => {
    modalState.root?.classList.add('is-open');
    modalState.closeButton?.focus({ preventScroll: true });
  });
}

function closeModal() {
  if (!modalState.root || modalState.root.hidden) return;
  window.clearTimeout(modalState.closeTimer);
  modalState.root.classList.remove('is-open');
  modalState.root.setAttribute('aria-hidden', 'true');
  const trigger = modalState.trigger;
  const triggerMemberId = trigger?.dataset?.memberId || trigger?.closest?.('[data-member-id]')?.dataset.memberId || '';
  const finish = () => {
    if (!modalState.root || modalState.root.classList.contains('is-open')) return;
    modalState.root.hidden = true;
    modalState.body.innerHTML = '';
    document.body.classList.remove('modal-open');
    if (pendingMemberPageRender) {
      pendingMemberPageRender = false;
      renderPage();
    }
    const currentTrigger = trigger?.isConnected
      ? trigger
      : (triggerMemberId ? qsa('[data-member-id]').find((item) => item.dataset.memberId === triggerMemberId) : null);
    if (currentTrigger?.isConnected) currentTrigger.focus({ preventScroll: true });
    modalState.trigger = null;
    modalState.instant = false;
    modalState.root.classList.remove('is-instant');
  };
  modalState.closeTimer = window.setTimeout(finish, reducedMotion.matches ? 0 : 160);
}

function bindInteractiveCards() {
  const bindCard = (selector, datasetKey, resolver) => {
    qsa(selector).forEach((card) => {
      if (card.dataset.bound === 'true') return;
      card.dataset.bound = 'true';
      const open = () => {
        const item = resolver(card.dataset[datasetKey]);
        if (item) item();
      };
      card.addEventListener('click', (event) => {
        const interactive = event.target.closest('a, button');
        if (interactive && interactive !== card) return;
        modalState.instant = event.detail === 0;
        open();
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          modalState.instant = true;
          open();
        }
      });
    });
  };

  bindCard('[data-member-id]', 'memberId', (id) => () => {
    const member = state.members.find((item) => item.id === id);
    if (member) openMemberModal(member);
  });

  bindCard('[data-project-id]', 'projectId', (id) => () => {
    const project = state.projects.find((item) => item.id === id);
    if (project) openProjectModal(project);
  });

  bindCard('[data-board-id]', 'boardId', (id) => () => {
    const post = state.board.find((item) => item.id === id);
    if (post) openBoardModal(post);
  });

  qsa('[data-link]').forEach((card) => {
    if (card.dataset.linkBound === 'true') return;
    card.dataset.linkBound = 'true';
    const openLink = () => {
      const link = card.dataset.link;
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
    };
    card.addEventListener('click', (event) => {
      const interactive = event.target.closest('a, button');
      if (interactive && interactive !== card) return;
      openLink();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLink();
      }
    });
  });

  qsa('.detail-open-button, .pi-photo-button').forEach((button) => {
    if (button.dataset.modalBound === 'true') return;
    button.dataset.modalBound = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const member = state.members.find((item) => item.id === button.dataset.memberId);
      if (member) openMemberModal(member);
    });
  });
}

function alumniCourseLabel(member = {}, locale = lang) {
  if (!(member.status === 'alumni' || member.group === 'alumni')) return '';
  const course = String(member.course || member.enrolledCourse || '').trim();
  if (!['phd', 'phdCompleted', 'ms'].includes(course)) return '';
  const base = memberCourseLabel(course === 'phdCompleted' ? 'phd' : course, locale);
  if (!base) return '';
  return locale === 'en' ? `${base} alumni` : `${base} 졸업`;
}

function openMemberModal(member) {
  const chips = [];
  if (member.group !== 'alumni') chips.push(member.group === 'pi' ? copy.pi : (member.group === 'researchProfessor' ? copy.researchProfessor : member.group === 'studentResearcher' ? copy.studentResearcherSection : copy.graduateStudent));
  if (member.group === 'graduateStudent') {
    chips.push(memberCourseLabel(member.course, lang));
    if (member.course !== 'phdCompleted' && member.track && member.track !== 'none') chips.push(memberTrackLabel(member.track, lang));
  }
  if (member.group === 'studentResearcher') chips.push(memberCourseLabel('undergrad', lang));
  if (member.status === 'alumni') {
    chips.push(`${copy.alumniSection}${member.graduationYear ? ` · ${member.graduationYear}` : ''}`);
    const completedCourse = alumniCourseLabel(member, lang);
    if (completedCourse) chips.push(completedCourse);
  }
  const yearLabel = memberYearLabel(member, lang);
  if (yearLabel) chips.push(yearLabel);
  const displayName = memberDisplayName(member);
  const title = displayName;
  const photo = member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}">` : `<div class="modal-avatar__placeholder">${escapeHTML(getInitials(memberDisplayName(member, 'en') || memberDisplayName(member) || member.name))}</div>`;
  const currentLabel = copy.currentPosition;
  const relatedProjectSection = renderMemberProjectBlock(member);
  const experienceMarkup = memberExperienceMarkup(member, lang, 'detail');
  const interestSection = detailSection(copy.interest, localizedMemberText(member, 'researchInterest'));
  const coreDetailSections = [
    detailHtmlSection(copy.education, memberEducationMarkup(member, lang, 'detail')),
    experienceMarkup ? detailHtmlSection(copy.experience, experienceMarkup) : detailSection(copy.experience, localizedMemberText(member, 'experience')),
    detailSection(currentLabel, localizedMemberText(member, 'currentPosition')),
    memberCourseSectionMarkup(member, lang),
  ].filter(Boolean).join('');
  const extendedDetailSections = [
    relatedProjectSection,
    renderMemberPublicationBlock(member)
  ].filter(Boolean).join('');
  openModal(title, `
    <div class="detail-modal detail-modal--member">
      <div class="detail-modal__hero">
        <div class="detail-modal__aside">
          <div class="detail-modal__media">${photo}</div>
          ${interestSection ? `<div class="detail-modal__interest">${interestSection}</div>` : ''}
        </div>
        <div class="detail-modal__summary">
          <div class="member-chip-row">${chips.map((chip) => `<span class="member-chip member-chip--soft">${escapeHTML(chip)}</span>`).join('')}</div>
          <h3>${escapeHTML(displayName)}</h3>
          ${localizedMemberText(member, 'bio') ? `<p class="detail-lead">${escapeHTML(localizedMemberText(member, 'bio'))}</p>` : ''}
          ${memberEmailLink(member.email, 'detail-member-email')}
          ${coreDetailSections ? `<div class="detail-grid detail-grid--member-core">${coreDetailSections}</div>` : ''}
        </div>
      </div>
      ${extendedDetailSections ? `<div class="detail-grid detail-grid--member-extended">${extendedDetailSections}</div>` : ''}
    </div>
  `);
}

function openProjectModal(project) {
  const title = localizedProjectTitle(project);
  const media = project.figureUrl ? `<div class="detail-figure detail-figure--${escapeHTML((project.figureAspect || '16:9').replace(':','-'))}"><img src="${escapeHTML(rootAsset(project.figureUrl, root))}" alt="${escapeHTML(localizedProjectTitle(project))}"></div>` : '';
  const leadLabel = projectLeadRoleLabel(project, lang);
  openModal(title, `
    <div class="detail-modal detail-modal--project">
      <div class="member-chip-row">
        <span class="status-pill">${escapeHTML(projectStatusLabel(project.status, lang))}</span>
        ${getProjectPeriodDisplay(project) ? `<span class="meta-pill">${escapeHTML(getProjectPeriodDisplay(project))}</span>` : ''}
      </div>
      ${media}
      <div class="detail-grid detail-grid--project">
        ${detailSection(lang === 'en' ? 'Project description' : '과제 설명', localizedProjectDescription(project) || (lang === 'en' ? 'No description provided.' : '설명이 아직 입력되지 않았습니다.'))}
        ${detailSection(leadLabel, projectInvestigatorName(project, lang) || (lang === 'en' ? 'Not set' : '미설정'))}
        ${renderProjectParticipantBlock(project)}
        ${detailSection(lang === 'en' ? 'Keywords' : '키워드', localizedProjectTags(project).join(', '))}
      </div>
    </div>
  `);
}

function openBoardModal(post) {
  const tag = boardCategoryLabel(post.category);
  const youtube = youtubeEmbedUrl(post.youtubeUrl || '');
  const images = boardMediaUrls(post);
  const leadMedia = youtube ? `<div class="detail-figure detail-figure--16-9 detail-figure--video"><iframe src="${escapeHTML(youtube)}" title="${escapeHTML(post.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>` : (images.length ? renderBoardGallery([images[0]], post.title) : '');
  const gallery = images.length > 1 ? `<div class="detail-gallery-section"><h4>${lang === 'en' ? 'Gallery' : '갤러리'}</h4>${renderBoardGallery(images, post.title)}</div>` : '';
  openModal(post.title, `
    <div class="detail-modal detail-modal--board">
      <div class="member-chip-row">
        <span class="member-chip member-chip--soft">${escapeHTML(tag)}</span>
      </div>
      ${boardMetaMarkup(post, 'board-detail-meta')}
      ${leadMedia}
      ${gallery}
      <p class="detail-lead">${escapeHTML(post.description || '')}</p>
      <div class="member-chip-row">
        ${post.linkUrl ? `<a class="button primary" href="${escapeHTML(post.linkUrl)}" target="_blank" rel="noreferrer">${lang === 'en' ? 'Open link' : '링크 열기'}</a>` : ''}
        ${youtube ? `<a class="button secondary" href="${escapeHTML(post.youtubeUrl)}" target="_blank" rel="noreferrer">YouTube</a>` : ''}
      </div>
    </div>
  `);
}

function detailSection(title, value = '') {
  if (!value) return '';
  return `
    <article class="detail-block">
      <h4>${escapeHTML(title)}</h4>
      <p>${multilineText(value)}</p>
    </article>
  `;
}



function resolveMemberProjectItems(links = []) {
  return (Array.isArray(links) ? links : []).map((link, index) => {
    const projectId = link?.projectId || link?.id || '';
    const matched = state.projects.find((project) => project.id === projectId)
      || state.projects.find((project) => localizedProjectTitle(project, 'kr') && link?.titleKr && localizedProjectTitle(project, 'kr') === link.titleKr)
      || state.projects.find((project) => localizedProjectTitle(project, 'en') && link?.titleEn && localizedProjectTitle(project, 'en') === link.titleEn);
    return {
      ...matched,
      ...link,
      id: matched?.id || projectId || `linked-project-${index}`,
      titleKr: link?.titleKr || localizedProjectTitle(matched || {}, 'kr') || '',
      titleEn: link?.titleEn || localizedProjectTitle(matched || {}, 'en') || '',
      title: link?.title || localizedProjectTitle(matched || {}, lang) || '',
      period: matched?.period || link?.period || '',
      status: matched?.status || link?.status || 'ongoing',
      descriptionKr: matched?.descriptionKr || '',
      descriptionEn: matched?.descriptionEn || ''
    };
  }).filter((item) => item.id || item.title || item.titleKr || item.titleEn);
}

function renderMemberProjectBlock(member = {}) {
  const sectionTitle = (member.group === 'graduateStudent' || member.group === 'studentResearcher')
    ? (lang === 'en' ? 'Participating projects' : '참여연구원 과제')
    : (lang === 'en' ? 'Related projects' : '관련 과제');
  const linked = resolveMemberProjectItems(member.projectLinks || []);
  if (!linked.length) {
    const fallback = member.relatedProjects || (lang === 'en' ? 'No linked ongoing projects yet.' : '연결된 진행 중 과제가 아직 없습니다.');
    return detailSection(sectionTitle, fallback);
  }
  const cards = linked.map((project) => {
    const title = localizedProjectTitle(project, lang) || firstFilledValue(project.titleKr, project.titleEn, project.title);
    const period = getProjectPeriodDisplay(project) || normalizeProjectPeriod(project.period || '');
    const desc = localizedProjectDescription(project, lang);
    return `<article class="linked-card linked-card--project interactive-card" data-project-id="${escapeHTML(project.id)}" tabindex="0" role="button" aria-label="${escapeHTML(title)}"><strong>${escapeHTML(title)}</strong>${period ? `<span class="linked-card__meta">${escapeHTML(period)}</span>` : ''}${desc ? `<p>${escapeHTML(desc)}</p>` : ''}</article>`;
  }).join('');
  return `
    <article class="detail-block detail-block--projects">
      <h4>${escapeHTML(sectionTitle)}</h4>
      <div class="detail-block__body"><div class="linked-card-grid linked-card-grid--projects">${cards}</div></div>
    </article>
  `;
}

function projectParticipantMembers(project = {}) {
  return state.members.filter((member) => ['graduateStudent', 'studentResearcher'].includes(member.group) && Array.isArray(member.projectLinks) && member.projectLinks.some((link) => String(link?.projectId || link?.id || '') === String(project.id)));
}

function renderProjectParticipantBlock(project = {}) {
  const participants = projectParticipantMembers(project);
  if (!participants.length) return detailSection(lang === 'en' ? 'Participants' : '참여연구원', lang === 'en' ? 'No linked participants yet.' : '연결된 참여연구원이 아직 없습니다.');
  const cards = participants.map((member) => `<article class="linked-card interactive-card" data-member-id="${escapeHTML(member.id)}" tabindex="0" role="button" aria-label="${escapeHTML(memberDisplayName(member))}"><strong>${escapeHTML(memberDisplayName(member))}</strong><span class="linked-card__meta">${escapeHTML(member.group === 'studentResearcher' ? (lang === 'en' ? 'Undergraduate researcher' : '학부연구생') : (lang === 'en' ? 'Graduate student' : '대학원생'))}</span>${member.email ? `<p>${escapeHTML(member.email)}</p>` : ''}</article>`).join('');
  return detailHtmlSection(lang === 'en' ? 'Participants' : '참여연구원', `<div class="linked-card-grid">${cards}</div>`);
}


function rolePriority(roles = []) {
  const arr = Array.isArray(roles) ? roles : [];
  if (arr.includes('first')) return 0;
  if (arr.includes('co')) return 1;
  if (arr.includes('corresponding')) return 2;
  return 9;
}
function sortRoles(roles = []) {
  const order = { first: 0, co: 1, corresponding: 2 };
  return (Array.isArray(roles) ? roles : []).filter(Boolean).slice().sort((a,b)=>(order[a]??9)-(order[b]??9));
}

function resolvePublicationMemberItems(publication = {}) {
  const direct = Array.isArray(publication.memberLinks) ? publication.memberLinks : [];
  if (direct.length) {
    return direct.map((item) => {
      const member = state.members.find((entry) => String(entry.id) === String(item.memberId || item.id || ''));
      return {
        memberId: item.memberId || item.id || member?.id || '',
        memberName: memberDisplayName(member || { nameKr: item.memberName, nameEn: item.memberName, name: item.memberName }),
        email: member?.email || item.email || '',
        roles: Array.isArray(item.roles) ? item.roles : []
      };
    }).sort((a, b) => rolePriority(a.roles) - rolePriority(b.roles) || String(a.memberName || '').localeCompare(String(b.memberName || ''), 'ko'));
  }
  const derived = state.members.map((member) => {
    const link = (Array.isArray(member.publicationLinks) ? member.publicationLinks : []).find((entry) => String(entry.publicationId || entry.id || '') === String(publication.id || ''));
    if (!link) return null;
    return { memberId: member.id, memberName: memberDisplayName(member), email: member.email || '', roles: Array.isArray(link.roles) ? link.roles : [] };
  }).filter(Boolean);
  return derived.sort((a, b) => rolePriority(a.roles) - rolePriority(b.roles) || String(a.memberName || '').localeCompare(String(b.memberName || ''), 'ko'));
}


function renderPublicationMemberDetails(publication = {}) {
  const items = resolvePublicationMemberItems(publication);
  if (!items.length) return '';
  return `
    <details class="publication-abstract publication-members">
      <summary><span class="publication-abstract__label">Members</span><span class="publication-abstract__icon" aria-hidden="true">▾</span></summary>
      <div class="publication-abstract__content">
        <div class="publication-members__list">${items.map((item) => {
          const orderedRoles = sortRoles(item.roles);
          return `
          <article class="publication-members__item publication-members__item--compact">
            <div class="publication-members__main">
              <strong>${escapeHTML(item.memberName || '')}</strong>
              ${item.email ? `<span class="muted">${escapeHTML(item.email)}</span>` : ''}
            </div>
            ${orderedRoles.length ? `<div class="member-publication-roles">${orderedRoles.map((role) => `<span class="member-publication-role member-publication-role--${escapeHTML(role)}">${escapeHTML(publicationRoleLabel(role, lang))}</span>`).join('')}</div>` : ''}
          </article>`;
        }).join('')}</div>
      </div>
    </details>`;
}

function publicationRoleLabel(role, locale = lang) {
  const map = {
    first: { kr: '제1저자', en: 'First author' },
    co: { kr: '공동저자', en: 'Co-author' },
    corresponding: { kr: '교신저자', en: 'Corresponding author' }
  };
  return map[role]?.[locale] || role;
}

function resolveMemberPublicationItems(links = []) {
  return (Array.isArray(links) ? links : []).map((link, index) => {
    const matched = state.publications.find((pub) => pub.id === link.publicationId)
      || state.publications.find((pub) => pub.title && link.title && String(pub.title).trim() === String(link.title).trim());
    const title = matched?.title || link.title || '';
    const year = matched?.year || link.year || '';
    const month = matched?.month || link.month || '';
    const journal = matched?.journal || link.journal || '';
    const doi = matched?.doi || link.doi || '';
    const url = resolvePublicationLink(matched || {}) || link.url || (doi ? resolvePublicationLink({ doi }) : '');
    return {
      ...matched,
      ...link,
      title,
      year,
      month,
      journal,
      doi,
      url,
      roles: Array.isArray(link.roles) ? link.roles.filter(Boolean) : [],
      _index: index
    };
  }).filter((item) => item.title || item.publicationId);
}

function renderMemberPublicationBlock(member = {}) {
  const sectionTitle = lang === 'en' ? 'Related publications' : '관련 논문';
  const emptyText = member.authorshipNote || (lang === 'en' ? 'No linked publications yet.' : '연결된 논문이 아직 없습니다.');
  const linkedItems = resolveMemberPublicationItems(member.publicationLinks);
  if (!linkedItems.length) return detailSection(sectionTitle, emptyText);
  const sorted = [...linkedItems].sort((a, b) => {
    const byYear = yearSort(b.year) - yearSort(a.year);
    if (byYear) return byYear;
    const byMonth = Number(b.month || 0) - Number(a.month || 0);
    if (byMonth) return byMonth;
    const byTitle = String(a.title || '').localeCompare(String(b.title || ''), 'en', { sensitivity: 'base' });
    if (byTitle) return byTitle;
    return (a._index || 0) - (b._index || 0);
  });
  const roleCounts = { first: 0, co: 0, corresponding: 0 };
  sorted.forEach((item) => {
    (Array.isArray(item.roles) ? item.roles : []).forEach((role) => { if (roleCounts[role] !== undefined) roleCounts[role] += 1; });
  });
  const summaryChips = [
    roleCounts.first ? `<span class="member-publication-summary-chip member-publication-role--first">${escapeHTML(lang === 'en' ? `First author ${roleCounts.first}` : `제1저자 ${roleCounts.first}개`)}</span>` : '',
    roleCounts.co ? `<span class="member-publication-summary-chip member-publication-role--co">${escapeHTML(lang === 'en' ? `Co-author ${roleCounts.co}` : `공동저자 ${roleCounts.co}개`)}</span>` : '',
    roleCounts.corresponding ? `<span class="member-publication-summary-chip member-publication-role--corresponding">${escapeHTML(lang === 'en' ? `Corresponding author ${roleCounts.corresponding}` : `교신저자 ${roleCounts.corresponding}개`)}</span>` : ''
  ].filter(Boolean).join('');
  const groups = Object.entries(groupBy(sorted, (item) => item.year || (lang === 'en' ? 'Unspecified' : '미정')))
    .sort((a, b) => yearSort(b[0]) - yearSort(a[0]) || String(a[0]).localeCompare(String(b[0]), 'en', { sensitivity: 'base' }))
    .map(([year, items]) => `
      <section class="member-publication-year-group">
        <div class="member-publication-year-heading">${escapeHTML(year)}</div>
        <div class="member-publication-list">
          ${items.map((item) => {
            const meta = [publicationYearMonthLabel(item), item.journal].filter(Boolean).join(' · ');
            const roles = Array.isArray(item.roles) ? item.roles : [];
            const linkLabel = copy.doi;
            return `
              <article class="member-publication-item${item.url ? ' member-publication-item--linked' : ''}">
                <div class="member-publication-main">
                  <strong>${escapeHTML(item.title)}</strong>
                  ${meta ? `<div class="member-publication-meta">${escapeHTML(meta)}</div>` : ''}
                </div>
                ${roles.length ? `<div class="member-publication-roles">${roles.map((role) => `<span class="member-publication-role member-publication-role--${escapeHTML(role)}">${escapeHTML(publicationRoleLabel(role, lang))}</span>`).join('')}</div>` : ''}
                ${item.url ? `<a class="member-publication-link" href="${escapeHTML(item.url)}" target="_blank" rel="noreferrer">${escapeHTML(linkLabel)}</a>` : ''}
              </article>
            `;
          }).join('')}
        </div>
      </section>
    `).join('');
  return `
    <article class="detail-block detail-block--publications">
      <h4>${escapeHTML(sectionTitle)}</h4>
      <div class="detail-block__body">${summaryChips ? `<div class="member-publication-summary">${summaryChips}</div>` : ''}${groups}</div>
    </article>
  `;
}

function setupRevealAnimations() {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    qsa('.reveal').forEach((item) => item.classList.add('is-visible'));
    return;
  }
  if (!setupRevealAnimations.observer) {
    setupRevealAnimations.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          setupRevealAnimations.observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' }
    );
  }
  qsa('.reveal').forEach((item) => {
    if (item.dataset.revealBound) return;
    item.dataset.revealBound = 'true';
    setupRevealAnimations.observer.observe(item);
  });
}

function setupCountAnimations() {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    qsa('.count-up').forEach((item) => {
      item.textContent = String(Number(item.dataset.target || '0'));
      item.dataset.counted = 'true';
    });
    return;
  }
  if (!setupCountAnimations.observer) {
    setupCountAnimations.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target;
          const target = Number(el.dataset.target || '0');
          if (!entry.isIntersecting || el.dataset.counted === 'true') return;
          el.dataset.counting = 'true';
          el.dataset.counted = 'true';
          setupCountAnimations.observer.unobserve(el);
          animateCount(el, target);
        });
      },
      { threshold: 0.25 }
    );
  }
  qsa('.count-up').forEach((item) => {
    if (item.dataset.counted !== 'true') item.textContent = '0';
    if (item.dataset.countBound) return;
    item.dataset.countBound = 'true';
    setupCountAnimations.observer.observe(item);
  });
}

function animateCount(el, target) {
  const duration = 900;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = String(Math.round(target * eased));
    if (progress < 1 && el.dataset.counting === 'true') requestAnimationFrame(step);
    else {
      el.textContent = String(target);
      el.dataset.counting = 'false';
    }
  }
  requestAnimationFrame(step);
}

function setupHeroSlider() {
  const slides = qsa('[data-hero-slide]');
  if (!slides.length) return;
  let index = 0;
  let timer = null;
  slides.forEach((slide, order) => {
    const imageUrl = focusImages[order % focusImages.length];
    if (order === 0 && !slide.style.backgroundImage) slide.style.backgroundImage = `url('${imageUrl}')`;
    if (order > 0) slide.dataset.backgroundImage = imageUrl;
    slide.classList.toggle('is-active', order === 0);
  });

  const loadDeferredSlides = () => {
    slides.slice(1).forEach((slide) => {
      const imageUrl = slide.dataset.backgroundImage;
      if (!imageUrl || slide.style.backgroundImage) return;
      const preloader = new Image();
      preloader.decoding = 'async';
      preloader.onload = () => { slide.style.backgroundImage = `url('${imageUrl}')`; };
      preloader.src = imageUrl;
    });
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(loadDeferredSlides, { timeout: 1800 });
  else window.setTimeout(loadDeferredSlides, 700);

  const stop = () => {
    window.clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    stop();
    if (document.hidden || reducedMotion.matches) return;
    timer = window.setTimeout(advance, 6200);
  };
  const advance = () => {
    if (document.hidden || reducedMotion.matches) return stop();
    slides[index].classList.remove('is-active');
    index = (index + 1) % slides.length;
    slides[index].classList.add('is-active');
    schedule();
  };

  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener?.('change', () => {
    if (reducedMotion.matches) {
      stop();
      slides.forEach((slide, order) => slide.classList.toggle('is-active', order === 0));
      index = 0;
    } else {
      schedule();
    }
  });
  schedule();
}

function publicationIndexCount(items = [], label = '') {
  return items.filter((item) => publicationIndexingLabel(item.indexing, 'en') === label).length;
}

function publicationSummaryLines(currentYearPubs = [], currentYear = String(new Date().getFullYear())) {
  const currentSci = publicationIndexCount(currentYearPubs, 'SCI(E)');
  const currentEsci = publicationIndexCount(currentYearPubs, 'ESCI');
  const currentKci = publicationIndexCount(currentYearPubs, 'KCI');
  const totalSci = publicationIndexCount(state.publications, 'SCI(E)');
  const totalEsci = publicationIndexCount(state.publications, 'ESCI');
  const totalKci = publicationIndexCount(state.publications, 'KCI');
  if (lang === 'en') {
    return [
      `${currentYear} SCI(E) ${currentSci} · ESCI ${currentEsci} · KCI ${currentKci} added`,
      `SCI(E) ${totalSci} · ESCI ${totalEsci} · KCI ${totalKci}`
    ];
  }
  return [
    `${currentYear}년 SCI(E) ${currentSci} · ESCI ${currentEsci} · KCI ${currentKci} 추가`,
    `SCI(E) ${totalSci} · ESCI ${totalEsci} · KCI ${totalKci}`
  ];
}

function homeSummaryCard(title, value, lines = []) {
  const meta = (Array.isArray(lines) ? lines : []).filter(Boolean).map((line) => `<small>${escapeHTML(line)}</small>`).join('');
  return `<article class="stat-card stat-card--summary reveal"><strong class="count-up" data-target="${escapeHTML(value)}">0</strong><span>${escapeHTML(title)}</span>${meta ? `<div class="stat-card__meta">${meta}</div>` : ''}</article>`;
}

function homeLoadingSummaryCard(title) {
  return '<article class="stat-card stat-card--summary stat-card--skeleton stat-card--loading reveal" aria-hidden="true"><strong class="skeleton-line skeleton-line--number"></strong><span>' + escapeHTML(title) + '</span><div class="stat-card__meta"><small class="skeleton-chip"></small><small class="skeleton-chip skeleton-chip--short"></small></div></article>';
}

function homeIsInitialLoading() {
  return useLiveData
    && page === 'home'
    && (state.loadingMembers || state.loadingProjects || state.loadingPublications || state.loadingBoard)
    && !state.members.length
    && !state.projects.length
    && !state.publications.length
    && !state.board.length;
}

function loadingStateText(kind = '') {
  const label = lang === 'en' ? 'Loading data…' : `${kind ? `${kind} ` : ''}데이터를 불러오는 중입니다.`;
  return emptyState(label);
}

function homePublicationCard(item = {}) {
  const link = resolvePublicationLink(item);
  const indexLabel = publicationIndexingLabel(item.indexing, lang);
  const indexClass = indexLabel ? indexLabel.toLowerCase().replace(/[^a-z]+/g, '') : '';
  const journalTone = journalToneClass(item.journal);
  const yearPill = publicationYearMonthLabel(item);
  const actionAttrs = link ? `data-link="${escapeHTML(link)}" tabindex="0" role="button"` : '';
  return `<article class="home-publication-card reveal${link ? ' interactive-card' : ''}" ${actionAttrs}${link ? ` aria-label="${escapeHTML(item.title || '')}"` : ''}>
    <div class="publication-topline home-publication-card__topline">
      ${yearPill ? `<span class="year-pill">${escapeHTML(yearPill)}</span>` : ''}
      <div class="publication-source-group">
        ${item.journal ? `<span class="journal-pill ${journalTone}">${escapeHTML(item.journal)}</span>` : ''}
        ${indexLabel ? `<span class="index-pill ${indexClass ? `index-pill--${escapeHTML(indexClass)}` : ''}">${escapeHTML(indexLabel)}</span>` : ''}
      </div>
    </div>
    <h3>${escapeHTML(item.title || '')}</h3>
    ${item.authors ? `<p class="muted home-publication-card__authors">${escapeHTML(item.authors)}</p>` : ''}
    ${link ? `<a class="member-link" href="${escapeHTML(link)}" target="_blank" rel="noreferrer">${escapeHTML(copy.doi)}</a>` : ''}
  </article>`;
}

function homeNewsCard(item = {}) {
  const images = boardMediaUrls(item);
  const cover = images[0] || '';
  const youtube = youtubeEmbedUrl(item.youtubeUrl || '');
  const indicators = [];
  if (images.length) {
    const imageLabel = lang === 'en'
      ? `${images.length} ${images.length === 1 ? 'photo' : 'photos'}`
      : `사진 ${images.length}장`;
    indicators.push(`<span class="home-news-indicator"><i class="ph ph-images" aria-hidden="true"></i>${escapeHTML(imageLabel)}</span>`);
  }
  if (youtube) indicators.push(`<span class="home-news-indicator"><i class="ph ph-youtube-logo" aria-hidden="true"></i>YouTube</span>`);
  if (item.linkUrl) indicators.push(`<span class="home-news-indicator"><i class="ph ph-arrow-square-out" aria-hidden="true"></i>${lang === 'en' ? 'Link' : '링크'}</span>`);
  return `<article class="home-news-card reveal interactive-card" data-board-id="${escapeHTML(item.id)}" tabindex="0" role="button" aria-label="${escapeHTML(item.title || '')}">
    <div class="home-news-card__copy">
      <div class="member-chip-row home-news-card__topline"><span class="member-chip member-chip--soft">${escapeHTML(boardCategoryLabel(item.category))}</span>${indicators.join('')}</div>
      ${boardMetaMarkup(item, 'board-card__metadata--home')}
      <h3>${escapeHTML(item.title || '')}</h3>
      ${item.description ? `<p>${escapeHTML(item.description)}</p>` : ''}
    </div>
    ${cover ? `<div class="home-news-card__media"><img src="${escapeHTML(rootAsset(cover, root))}" alt="" loading="lazy" decoding="async"></div>` : `<div class="home-news-card__media home-news-card__media--placeholder" aria-hidden="true"><i class="ph ${youtube ? 'ph-youtube-logo' : 'ph-article'}"></i></div>`}
  </article>`;
}

const CURRENT_MEMBER_GROUPS = new Set(['pi', 'researchProfessor', 'graduateStudent', 'studentResearcher']);

function isAlumniRecord(member = {}) {
  return String(member.status || '').toLowerCase() === 'alumni'
    || String(member.group || '').toLowerCase() === 'alumni'
    || String(member.course || '').toLowerCase() === 'alumni';
}

function isCurrentRosterMember(member = {}) {
  const group = String(member.group || '').trim();
  return !isAlumniRecord(member) && CURRENT_MEMBER_GROUPS.has(group);
}

function currentMemberBreakdown(members = []) {
  const currentMembers = members.filter(isCurrentRosterMember);
  const piMembers = currentMembers.filter((item) => item.group === 'pi');
  const researchProfessorMembers = currentMembers.filter((item) => item.group === 'researchProfessor');
  const graduateStudents = currentMembers.filter((item) => item.group === 'graduateStudent');
  const undergradMembers = currentMembers.filter((item) => item.group === 'studentResearcher');
  return {
    currentMembers,
    piMembers,
    researchProfessorMembers,
    graduateStudents,
    undergradMembers,
    piCount: piMembers.length,
    researchProfessorCount: researchProfessorMembers.length,
    graduateStudentCount: graduateStudents.length,
    undergradCount: undergradMembers.length,
    total: piMembers.length + researchProfessorMembers.length + graduateStudents.length + undergradMembers.length
  };
}

function renderHome() {
  const memberCounts = currentMemberBreakdown(state.members);
  const researchProfessors = memberCounts.researchProfessorCount;
  const graduateStudents = memberCounts.graduateStudents;
  const undergrads = memberCounts.undergradCount;
  const piCount = memberCounts.piCount;
  const gradPhd = graduateStudents.filter((item) => ['phd','doctoral'].includes(String(item.course || '').toLowerCase())).length;
  const gradMs = graduateStudents.filter((item) => ['ms','masters'].includes(String(item.course || '').toLowerCase())).length;
  const ongoingProjects = state.projects.filter((item) => item.status === 'ongoing');
  const completedProjects = state.projects.filter((item) => item.status === 'completed');
  const currentYear = String(new Date().getFullYear());
  const currentYearPubs = state.publications.filter((item) => String(item.year || '') === currentYear);
  const boardConferenceCount = state.board.filter((i) => normalizeBoardCategory(i.category) === 'conference').length;
  const boardWorkshopCount = state.board.filter((i) => normalizeBoardCategory(i.category) === 'workshop').length;
  const boardEquipmentCount = state.board.filter((i) => normalizeBoardCategory(i.category) === 'equipment').length;
  const boardOtherCount = state.board.filter((i) => normalizeBoardCategory(i.category) === 'other').length;
  const heroStat = qs('#hero-stat-grid');
  if (heroStat) {
    if (homeIsInitialLoading()) {
      heroStat.innerHTML = [
        homeLoadingSummaryCard(lang === 'en' ? 'Members' : '구성원'),
        homeLoadingSummaryCard(lang === 'en' ? 'Projects' : '과제'),
        homeLoadingSummaryCard(lang === 'en' ? 'Publications' : '논문'),
        homeLoadingSummaryCard(lang === 'en' ? 'Board' : '게시판')
      ].join('');
    } else {
      heroStat.innerHTML = [
        homeSummaryCard(lang === 'en' ? 'Members' : '구성원', memberCounts.total, [lang === 'en' ? `PI ${piCount} · Research ${researchProfessors}` : `지도교수 ${piCount} · 연구교수 ${researchProfessors}`, lang === 'en' ? `Graduate ${graduateStudents.length} · Undergraduate ${undergrads}` : `대학원생 ${graduateStudents.length} · 학부연구생 ${undergrads}`]),
        homeSummaryCard(lang === 'en' ? 'Projects' : '과제', state.projects.length, [lang === 'en' ? `Ongoing ${ongoingProjects.length}` : `진행 중 ${ongoingProjects.length}`, lang === 'en' ? `Archived ${completedProjects.length}` : `종료 ${completedProjects.length}`]),
        homeSummaryCard(lang === 'en' ? 'Publications' : '논문', state.publications.length, publicationSummaryLines(currentYearPubs, currentYear)),
        homeSummaryCard(lang === 'en' ? 'Board' : '게시판', state.board.length, [lang === 'en' ? `Conference ${boardConferenceCount} · Workshop ${boardWorkshopCount}` : `학회 ${boardConferenceCount} · 워크숍 ${boardWorkshopCount}`, lang === 'en' ? `Lab equipment ${boardEquipmentCount} · Other ${boardOtherCount}` : `실험실 장비 목록 ${boardEquipmentCount} · 기타 ${boardOtherCount}`])
      ].join('');
    }
  }

  const pubGrid = qs('#home-publication-grid');
  if (pubGrid) {
    const pubItems = (currentYearPubs.length ? currentYearPubs : state.publications.slice(0,4)).slice(0,4);
    if (state.loadingPublications && !state.publications.length) {
      pubGrid.dataset.count = '2';
      pubGrid.innerHTML = Array.from({ length: 2 }, () => homePublicationSkeletonCard()).join('');
    } else {
      pubGrid.dataset.count = String(pubItems.length || 0);
      pubGrid.innerHTML = pubItems.length ? pubItems.map(homePublicationCard).join('') : emptyState(lang === 'en' ? 'No publications yet.' : '표시할 논문이 없습니다.');
    }
  }

  const ongoingPreview = ongoingProjects.slice(0, 4);
  const previewGrid = qs('#ongoing-preview-grid');
  if (previewGrid) {
    if (state.loadingProjects && !state.projects.length) {
      previewGrid.dataset.count = '4';
      previewGrid.innerHTML = Array.from({ length: 4 }, () => projectSkeletonCard()).join('');
    } else {
      previewGrid.dataset.count = String(ongoingPreview.length || 0);
      previewGrid.innerHTML = ongoingPreview.map((project) => projectCard(project, { compact: true })).join('');
    }
    stretchProjectGrid(previewGrid);
  }

  const newsGrid = qs('#home-news-grid');
  if (newsGrid) {
    const newsItems = state.board.slice(0, 3);
    if (state.loadingBoard && !state.board.length) {
      newsGrid.innerHTML = Array.from({ length: 3 }, () => homeNewsSkeletonCard()).join('');
    } else {
      newsGrid.innerHTML = newsItems.length ? newsItems.map(homeNewsCard).join('') : emptyState(lang === 'en' ? 'No board posts yet.' : '표시할 게시글이 없습니다.');
    }
  }

  const contactGrid = qs('#home-contact-grid');
  if (contactGrid) {
    const lines = lang === 'en'
      ? ['GEH Lab', 'Room 1332, College of Agriculture and Life Sciences 1 (E10-1)', '+82 42-821-7825']
      : ['충남대학교 원예학과 시설환경원예학 연구실', '농업생명과학대학 1호관(E10-1) 1332호', '042-821-7825'];
    const labels = lang === 'en'
      ? ['Lab', 'Address', 'Phone']
      : ['연구실', '주소', '전화'];
    contactGrid.innerHTML = `
      <article class="home-contact-card reveal">
        <div class="home-contact-item home-contact-item--lab">
          <span class="home-contact-label">${escapeHTML(labels[0])}</span>
          <strong>${escapeHTML(lines[0])}</strong>
        </div>
        <div class="home-contact-item home-contact-item--address">
          <span class="home-contact-label">${escapeHTML(labels[1])}</span>
          <p>${escapeHTML(lines[1])}</p>
        </div>
        <div class="home-contact-item home-contact-item--phone">
          <span class="home-contact-label">${escapeHTML(labels[2])}</span>
          <a href="tel:${lang === 'en' ? '+82428217825' : '0428217825'}">${escapeHTML(lines[2])}</a>
        </div>
      </article>
    `;
  }
}

function renderMembers() {
  const members = state.members;
  const memberCounts = currentMemberBreakdown(members);
  const pi = memberCounts.piMembers[0];
  const piCount = memberCounts.piCount;
  const researchProfessors = memberCounts.researchProfessorMembers;
  const graduateStudents = memberCounts.graduateStudents;
  const undergrads = memberCounts.undergradMembers;
  const alumni = members.filter((item) => item.status === 'alumni');
  const membersLoading = state.loadingMembers && useLiveData && !state.members.length;
  const initialPiCard = qs('#pi-card');
  if (initialPiCard && pi) {
    initialPiCard.classList.add('pi-card--clickable');
    initialPiCard.dataset.memberId = pi.id;
  }
  const nextRenderSignature = membersLoading ? '__loading__' : collectionRenderSignature(members);
  if (nextRenderSignature === renderedMemberSignature) return;
  renderedMemberSignature = nextRenderSignature;

  if (membersLoading) {
    const pageStats = qs('#page-stat-grid');
    if (pageStats) {
      const stats = [copy.stats.current, copy.researchProfessor, copy.graduateStudent, copy.stats.alumni];
      pageStats.innerHTML = stats.map((label) => projectStatSkeleton(label)).join('');
    }
    const piCard = qs('#pi-card');
    if (piCard) piCard.innerHTML = piSkeletonCard();
    const researchList = qs('#research-professor-list');
    if (researchList) researchList.innerHTML = memberGridSkeleton(3, 'member-grid--wide');
    const graduateAccordion = qs('#graduate-accordion');
    if (graduateAccordion) {
      graduateAccordion.innerHTML = [
        accordionMarkup(copy.phdFullTime, '…', memberGridSkeleton(3), true),
        accordionMarkup(copy.phdPartTime, '…', memberGridSkeleton(2), false),
        accordionMarkup(copy.phdCompleted, '…', memberGridSkeleton(2), false),
        accordionMarkup(copy.msFullTime, '…', memberGridSkeleton(2), false),
        accordionMarkup(copy.msPartTime, '…', memberGridSkeleton(2), false)
      ].join('');
    }
    const researcherAccordion = qs('#student-researcher-accordion');
    if (researcherAccordion) researcherAccordion.innerHTML = accordionMarkup(copy.studentResearcherSection, '…', memberGridSkeleton(2, 'member-grid--wide'), false);
    const alumniAccordion = qs('#alumni-accordion');
    if (alumniAccordion) alumniAccordion.innerHTML = accordionMarkup(copy.stats.alumni, '…', memberGridSkeleton(3, 'member-grid--alumni'), false);
    return;
  }

  const pageStats = qs('#page-stat-grid');
  if (pageStats) {
    const phdStudents = graduateStudents.filter((item) => ['phd','doctoral'].includes(String(item.course || '').toLowerCase())).length;
    const phdCompletedStudents = graduateStudents.filter((item) => String(item.course || '').toLowerCase() === 'phdcompleted').length;
    const msStudents = graduateStudents.filter((item) => ['ms','masters'].includes(String(item.course || '').toLowerCase())).length;
    const activeBreakdown = [
      `${copy.pi} ${piCount}`,
      `${copy.researchProfessor} ${researchProfessors.length}`,
      `${copy.graduateStudent} ${graduateStudents.length}`,
      `${copy.studentResearcher} ${undergrads.length}`
    ];
    const alumniBreakdown = [
      `${lang === 'en' ? 'Ph.D.' : '박사'} ${alumni.filter((item) => ['phd','doctoral','phdcompleted'].includes(String(item.course || '').toLowerCase())).length}`,
      `${lang === 'en' ? 'M.S.' : '석사'} ${alumni.filter((item) => ['ms','masters'].includes(String(item.course || '').toLowerCase())).length}`
    ];
    const gradBreakdown = [
      `${lang === 'en' ? 'Ph.D.' : '박사'} ${phdStudents}`,
      `${lang === 'en' ? 'Ph.D. completion research' : '박사수료 후 연구생'} ${phdCompletedStudents}`,
      `${lang === 'en' ? 'M.S.' : '석사'} ${msStudents}`
    ];
    pageStats.innerHTML = [
      { value: memberCounts.total, label: copy.stats.current, meta: activeBreakdown },
      { value: researchProfessors.length, label: copy.researchProfessor, meta: [] },
      { value: graduateStudents.length, label: copy.graduateStudent, meta: gradBreakdown },
      { value: alumni.length, label: copy.stats.alumni, meta: alumniBreakdown }
    ].map((item) => `
      <article class="stat-card stat-card--summary reveal">
        <strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong>
        <span>${escapeHTML(item.label)}</span>
        ${Array.isArray(item.meta) && item.meta.length ? `<div class="stat-card__meta">${item.meta.map((line) => `<small>${escapeHTML(line)}</small>`).join('')}</div>` : ''}
      </article>
    `).join('');
  }

  const piCard = qs('#pi-card');
  if (piCard) {
    if (!pi) {
      piCard.classList.remove('pi-card--clickable');
      piCard.removeAttribute('data-member-id');
      piCard.innerHTML = emptyState(copy.noMembers);
    } else {
      piCard.classList.add('pi-card--clickable');
      piCard.dataset.memberId = pi.id;
      const piInterest = localizedMemberText(pi, 'researchInterest');
      const piSchedule = memberCourseScheduleEntries(pi);
      piCard.innerHTML = `
        <div class="pi-card-layout">
          <button type="button" class="pi-photo pi-photo-button" data-member-id="${escapeHTML(pi.id)}">
            ${pi.photoUrl ? `<img src="${escapeHTML(rootAsset(pi.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(pi))}" width="480" height="575" decoding="async" fetchpriority="high">` : `<span>${escapeHTML(getInitials(memberDisplayName(pi, 'en') || pi.name))}</span>`}
          </button>
          <div class="pi-card-main">
            <div class="pi-card-head">
              <span class="eyebrow">${escapeHTML(copy.pi)}</span>
              <div class="pi-name-row"><h2>${escapeHTML(memberDisplayName(pi))}</h2>${memberYearLabel(pi, lang) ? `<span class="member-chip member-chip--soft">${escapeHTML(memberYearLabel(pi, lang))}</span>` : ''}${memberEmailLink(pi.email, 'pi-card-email')}</div>
              <p class="pi-title">${escapeHTML(localizedMemberText(pi, 'bio') || (lang === 'en' ? 'Professor, Chungnam National University' : '충남대학교 교수'))}</p>
            </div>
            <div class="pi-card-grid pi-card-grid--core">
              <article><h3>${escapeHTML(copy.education)}</h3>${memberEducationMarkup(pi, lang, 'panel')}</article>
              <article><h3>${escapeHTML(copy.experience)}</h3>${memberExperienceMarkup(pi, lang, 'panel') || `<p>${multilineText(localizedMemberText(pi, 'experience') || '')}</p>`}</article>
            </div>
            ${piInterest ? `<article class="pi-card-interest"><h3>${escapeHTML(copy.interest)}</h3><p>${multilineText(piInterest)}</p></article>` : ''}
          </div>
        </div>
        ${piSchedule.length ? `<div class="pi-card-grid pi-card-grid--schedule"><article class="pi-card-grid__full"><h3>${escapeHTML(lang === 'en' ? 'Course schedule' : '수업 시간표')}</h3>${memberCourseScheduleMarkup(pi, lang)}</article></div>` : ''}
      `;
    }
  }

  const researchList = qs('#research-professor-list');
  if (researchList) {
    researchList.innerHTML = researchProfessors.length
      ? `<div class="member-grid member-grid--wide" data-count="${researchProfessors.length}">${researchProfessors.map((item) => memberCard(item)).join('')}</div>`
      : emptyState(copy.noMembers);
  }

  const graduateAccordion = qs('#graduate-accordion');
  if (graduateAccordion) {
    const gradSections = [
      { title: copy.phdFullTime, items: graduateStudents.filter((item) => item.course === 'phd' && item.track === 'fullTime') },
      { title: copy.phdPartTime, items: graduateStudents.filter((item) => item.course === 'phd' && item.track === 'partTime') },
      { title: copy.phdCompleted, items: graduateStudents.filter((item) => item.course === 'phdCompleted') },
      { title: copy.msFullTime, items: graduateStudents.filter((item) => item.course === 'ms' && item.track === 'fullTime') },
      { title: copy.msPartTime, items: graduateStudents.filter((item) => item.course === 'ms' && item.track === 'partTime') }
    ];
    graduateAccordion.innerHTML = gradSections.map((section, index) => {
      const content = section.items.length ? `<div class="member-grid" data-count="${section.items.length}">${section.items.map((item) => memberCard(item)).join('')}</div>` : emptyState(copy.noMembers);
      return accordionMarkup(section.title, section.items.length, content, index === 0);
    }).join('');
  }

  const researcherAccordion = qs('#student-researcher-accordion');
  if (researcherAccordion) {
    researcherAccordion.innerHTML = undergrads.length ? accordionMarkup(
      copy.studentResearcherSection,
      undergrads.length,
      `<div class="member-grid member-grid--wide" data-count="${undergrads.length}">${undergrads.map((item) => memberCard(item)).join('')}</div>`,
      true
    ) : '';
  }

  const alumniAccordion = qs('#alumni-accordion');
  if (alumniAccordion) {
    const alumniByYear = Object.entries(groupBy(alumni, (item) => item.graduationYear || (lang === 'en' ? 'Unspecified' : '미정')))
      .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
    alumniAccordion.innerHTML = alumniByYear.map(([year, items], index) => accordionMarkup(
      year,
      items.length,
      `<div class="member-grid member-grid--alumni" data-count="${items.length}">${items.map((item) => alumniCard(item)).join('')}</div>`,
      index === 0
    )).join('');
  }
}

function renderProjects() {
  const ongoing = state.projects.filter((item) => item.status === 'ongoing');
  const completed = state.projects.filter((item) => item.status === 'completed');
  const summary = qs('#project-summary');
  if (summary) summary.textContent = '';

  const statGrid = qs('#project-stat-grid');
  if (statGrid) {
    const stats = [
      { value: ongoing.length, label: lang === 'en' ? 'Ongoing projects' : '진행 중 과제' },
      { value: completed.length, label: lang === 'en' ? 'Archived projects' : '종료 과제' }
    ];
    if (state.loadingProjects && useLiveProjectsOnly() && !state.projects.length) {
      statGrid.innerHTML = stats.map((item) => projectStatSkeleton(item.label)).join('');
    } else {
      statGrid.innerHTML = stats.map((item) => `<article class="stat-card reveal"><strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong><span>${escapeHTML(item.label)}</span></article>`).join('');
    }
  }

  const ongoingGrid = qs('#ongoing-project-grid');
  if (ongoingGrid) {
    if (state.loadingProjects && useLiveProjectsOnly() && !state.projects.length) {
      ongoingGrid.innerHTML = Array.from({ length: 4 }, () => projectSkeletonCard()).join('');
    } else {
      ongoingGrid.innerHTML = ongoing.map((project) => projectCard(project)).join('');
    }
    stretchProjectGrid(ongoingGrid);
  }

  const completedAccordion = qs('#completed-project-accordion');
  if (completedAccordion) {
    if (state.loadingProjects && useLiveProjectsOnly() && !state.projects.length) {
      completedAccordion.innerHTML = '';
    } else {
      const completedByYear = Object.entries(groupBy(completed, (item) => item.year || extractYearFromText(item.period) || (lang === 'en' ? 'Unspecified' : '미정')))
        .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
      completedAccordion.innerHTML = completedByYear.map(([year, items], index) => accordionMarkup(year, items.length, `<div class="archive-list">${items.map((item) => archiveProjectItem(item)).join('')}</div>`, index === 0)).join('');
    }
  }
}

function renderPublications() {
  const query = state.publicationQuery.trim().toLowerCase();
  const filtered = !query ? state.publications : state.publications.filter((item) => {
    const haystack = [item.title, item.authors, item.journal, item.doi, item.url, item.year, item.month, item.indexing].join(' ').toLowerCase();
    return haystack.includes(query);
  });

  const allSci = state.publications.filter((item) => publicationIndexingLabel(item.indexing, lang).toUpperCase() === 'SCI(E)').length;
  const allEsci = state.publications.filter((item) => publicationIndexingLabel(item.indexing, lang).toUpperCase() === 'ESCI').length;
  const allKci = state.publications.filter((item) => publicationIndexingLabel(item.indexing, lang).toUpperCase() === 'KCI').length;

  const summary = qs('#publication-summary');
  if (summary) summary.textContent = '';

  const statGrid = qs('#publication-stat-grid');
  if (statGrid) {
    const stats = [
      { value: state.publications.length, label: lang === 'en' ? 'Publications' : '논문' },
      { value: allSci, label: 'SCI(E)' },
      { value: allEsci, label: 'ESCI' },
      { value: allKci, label: 'KCI' }
    ];
    if (state.loadingPublications && useLiveData && !state.publications.length) {
      statGrid.dataset.signature = 'loading';
      statGrid.innerHTML = stats.map((item) => projectStatSkeleton(item.label)).join('');
    } else {
      const signature = stats.map((item) => item.label + ':' + item.value).join('|');
      if (statGrid.dataset.signature !== signature) {
        statGrid.dataset.signature = signature;
        statGrid.innerHTML = stats.map((item) => '<article class="stat-card reveal"><strong class="count-up" data-target="' + escapeHTML(item.value) + '">0</strong><span>' + escapeHTML(item.label) + '</span></article>').join('');
      }
    }
  }

  const publicationAccordion = qs('#publication-accordion');
  if (publicationAccordion) {
    if (state.loadingPublications && useLiveData && !state.publications.length) {
      publicationAccordion.innerHTML = publicationListSkeleton(4);
    } else {
      const grouped = Object.entries(groupBy(filtered, (item) => item.year || (lang === 'en' ? 'Unspecified' : '미정')))
        .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
      publicationAccordion.innerHTML = grouped.map(([year, items], index) => {
        const content = '<div class="publication-list">' + items.map((item) => publicationCard(item)).join('') + '</div>';
        return accordionMarkup(year, items.length, content, index === 0);
      }).join('');
    }
  }
}

function boardSkeletonMarkup() {
  return Array.from({ length: 4 }).map(() => `
    <article class="board-card board-card--skeleton">
      <div class="board-card__media"></div>
      <div class="board-card__copy">
        <div class="skeleton-line skeleton-line--meta"></div>
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line skeleton-line--text"></div>
      </div>
    </article>`).join('');
}

function renderBoard({ skipReveal = false } = {}) {
  const filters = boardFilterConfig();
  const validFilters = filters.map(([value]) => value);
  if (!validFilters.includes(state.boardTab)) state.boardTab = 'all';

  const summary = qs('#board-summary');
  if (summary) {
    summary.textContent = state.loadingBoard && !state.board.length
      ? (lang === 'en' ? 'Loading board…' : '게시판 불러오는 중…')
      : (lang === 'en' ? `${state.board.length} board posts` : `게시판 ${state.board.length}건`);
  }

  const grid = qs('#board-tab-grid');
  const tabTitle = qs('#board-tab-title');
  const tabEyebrow = qs('#board-tab-eyebrow');

  if (grid) {
    grid.dataset.view = state.boardView;
    grid.classList.toggle('board-grid--list', state.boardView === 'list');
    grid.classList.toggle('board-grid--cards', state.boardView === 'grid');
  }

  qsa('[data-board-view]').forEach((button) => {
    const view = button.dataset.boardView;
    const isActive = view === state.boardView;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      state.boardView = view === 'list' ? 'list' : 'grid';
      saveBoardView(state.boardView);
      renderBoard({ skipReveal: true });
      bindInteractiveCards();
    });
  });

  qsa('[data-board-sort]').forEach((button) => {
    const oldestFirst = state.boardSort === 'oldest';
    button.setAttribute('aria-pressed', String(oldestFirst));
    button.setAttribute('aria-label', lang === 'en'
      ? (oldestFirst ? 'Sort by newest posts first' : 'Sort by oldest posts first')
      : (oldestFirst ? '작성일 최신순으로 정렬' : '작성일 오래된순으로 정렬'));
    button.classList.toggle('is-ascending', oldestFirst);
    const label = button.querySelector('[data-board-sort-label]');
    if (label) label.textContent = lang === 'en'
      ? (oldestFirst ? 'Oldest first' : 'Newest first')
      : (oldestFirst ? '작성일 오래된순' : '작성일 최신순');
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      state.boardSort = state.boardSort === 'oldest' ? 'newest' : 'oldest';
      saveBoardSort(state.boardSort);
      renderBoard({ skipReveal: true });
      bindInteractiveCards();
    });
  });

  if (state.loadingBoard && !state.board.length) {
    if (tabTitle) tabTitle.textContent = lang === 'en' ? 'Board' : '게시판';
    if (tabEyebrow) tabEyebrow.textContent = '';
    if (grid) grid.innerHTML = boardSkeletonMarkup();
    return;
  }

  const activeFilter = state.boardTab || 'all';
  const activeLabel = filters.find(([value]) => value === activeFilter)?.[1] || (lang === 'en' ? 'All' : '전체');
  const filteredPosts = activeFilter === 'all'
    ? state.board
    : state.board.filter((item) => normalizeBoardCategory(item.category) === activeFilter);
  const activePosts = state.boardSort === 'oldest' ? [...filteredPosts].reverse() : filteredPosts;

  if (tabTitle) tabTitle.textContent = activeFilter === 'all' ? (lang === 'en' ? 'All board posts' : '전체 게시글') : activeLabel;
  if (tabEyebrow) tabEyebrow.textContent = lang === 'en' ? 'Board' : '게시판';
  if (grid) {
    grid.setAttribute('role', 'tabpanel');
    const emptyMessage = lang === 'en' ? `No ${activeLabel.toLowerCase()} posts yet.` : `${activeLabel} 게시글이 아직 없습니다.`;
    grid.innerHTML = activePosts.length ? activePosts.map((post) => boardCard(post)).join('') : emptyState(emptyMessage);
  }

  qsa('[data-board-tab]').forEach((button) => {
    const isActive = button.dataset.boardTab === activeFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('role', 'tab');
    button.id ||= `board-tab-${button.dataset.boardTab}`;
    button.setAttribute('aria-controls', 'board-tab-grid');
    button.setAttribute('aria-selected', String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && grid) grid.setAttribute('aria-labelledby', button.id);
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      state.boardTab = button.dataset.boardTab;
      renderBoard();
      setupRevealAnimations();
      bindInteractiveCards();
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = qsa('[data-board-tab]');
      const currentIndex = tabs.indexOf(button);
      let nextIndex = currentIndex;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      const nextTab = tabs[nextIndex];
      state.boardTab = nextTab.dataset.boardTab;
      renderBoard({ skipReveal: true });
      qsa('#board-tab-grid .reveal').forEach((item) => item.classList.add('is-visible'));
      bindInteractiveCards();
      nextTab.focus();
    });
  });

  if (skipReveal) qsa('#board-tab-grid .reveal').forEach((item) => item.classList.add('is-visible'));
}

function setupSearch() {
  qs('#publication-search')?.addEventListener('input', (event) => {
    state.publicationQuery = event.currentTarget.value;
    renderPublications();
    setUpdatedDate();
    setupRevealAnimations();
    setupAccordions();
    bindInteractiveCards();
  });
}

function setUpdatedDate() {
  const target = qs('#page-updated');
  if (!target) return;
  let source = BUILD_DATE;
  if (page === 'members') source = lastUpdated(state.members, BUILD_DATE);
  if (page === 'projects') source = lastUpdated(state.projects, BUILD_DATE);
  if (page === 'publications') source = lastUpdated(state.publications, BUILD_DATE);
  if (page === 'board') source = lastUpdated(state.board, BUILD_DATE);
  target.textContent = `${copy.updated} ${formatDate(source, lang === 'en' ? 'en-CA' : 'ko-KR')}`;
}

function yearSort(label) {
  const match = String(label).match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}

function extractYearFromText(value = '') {
  const years = String(value || '').match(/(?:19|20)\d{2}/g);
  return years?.length ? years[years.length - 1] : '';
}

function currentArchiveBuckets() {
  const year = new Date().getFullYear();
  return {
    current: String(year),
    previous: String(year - 1),
    second: String(year - 2),
    earlier: lang === 'en' ? `${year - 3} and Earlier` : `${year - 3}년 이전`
  };
}

function dynamicYearBucket(value = '') {
  const buckets = currentArchiveBuckets();
  const y = Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
  if (!y) return buckets.earlier;
  if (String(y) === buckets.current) return buckets.current;
  if (String(y) === buckets.previous) return buckets.previous;
  if (String(y) === buckets.second) return buckets.second;
  return buckets.earlier;
}

function localizedProjectTitle(project = {}) {
  return lang === 'en'
    ? (project.titleEn || project.title || project.titleKr || '')
    : (project.titleKr || project.title || project.titleEn || '');
}

function localizedProjectDescription(project = {}) {
  return lang === 'en'
    ? (project.descriptionEn || project.description || project.descriptionKr || '')
    : (project.descriptionKr || project.description || project.descriptionEn || '');
}

function localizedProjectTags(project = {}) {
  const arr = lang === 'en'
    ? ((project.tagsEn && project.tagsEn.length) ? project.tagsEn : project.tags)
    : ((project.tagsKr && project.tagsKr.length) ? project.tagsKr : project.tags);
  return Array.isArray(arr) ? arr : [];
}


function padMonth(value = '') {
  const n = Number(String(value || '').trim());
  return Number.isFinite(n) && n >= 1 && n <= 12 ? String(n).padStart(2, '0') : '';
}

function journalToneClass(journal = '') {
  const name = String(journal || '').trim().toLowerCase();
  if (!name) return 'journal-pill--tone-neutral';
  const manual = {
    'industrial crops and products': 'journal-pill--tone-blue',
    'scientific reports': 'journal-pill--tone-indigo',
    'the korean society for bio-environment control': 'journal-pill--tone-red',
    'journal of bio-environment control': 'journal-pill--tone-red',
    'horticultural science and technology': 'journal-pill--tone-purple',
    'frontiers in plant science': 'journal-pill--tone-sky',
    'plants': 'journal-pill--tone-green',
    'agriculture': 'journal-pill--tone-lime',
    'agronomy': 'journal-pill--tone-amber',
    'horticulturae': 'journal-pill--tone-teal',
    'horticulture, environment, and biotechnology': 'journal-pill--tone-violet',
    'ozone: science & engineering': 'journal-pill--tone-cyan',
    'australian journal of crop science': 'journal-pill--tone-orange'
  };
  if (manual[name]) return manual[name];
  const tones = ['red', 'purple', 'blue', 'green', 'amber', 'teal', 'violet', 'sky', 'orange', 'rose', 'cyan', 'lime', 'indigo'];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return `journal-pill--tone-${tones[Math.abs(hash) % tones.length]}`;
}


function projectLeadRoleLabel(project = {}, locale = lang) {
  const key = project.leadRole || 'leadInstitutionInvestigator';
  const map = {
    principalInvestigator: locale === 'en' ? 'Lead investigator' : '주관연구책임자',
    coPrincipalInvestigator: locale === 'en' ? 'Co-principal investigator' : '공동연구책임자',
    leadInstitutionInvestigator: locale === 'en' ? 'Lead investigator' : '주관연구책임자'
  };
  return map[key] || (locale === 'en' ? 'Lead investigator' : '주관연구책임자');
}

function isGenericOngoingPeriod(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  return !normalized || /^(진행중|진행中|inprogress|ongoing|in-progress)$/.test(normalized);
}

function getProjectPeriodDisplay(project = {}) {
  const raw = normalizeProjectPeriod(project.period || '');
  if (!raw) return '';
  if (isGenericOngoingPeriod(raw)) return '';
  if (project.status === 'completed' && raw === String(project.year || '').trim()) return raw;
  return raw;
}

function memberMetaChips(member) {
  const chips = [];
  if (member.status === 'alumni' || member.group === 'alumni') {
    const completedCourse = alumniCourseLabel(member, lang);
    if (completedCourse) chips.push({ text: completedCourse });
  } else if (member.group === 'graduateStudent') {
    if (member.course) chips.push({ text: memberCourseLabel(member.course, lang) });
    if (member.course !== 'phdCompleted' && member.track && member.track !== 'none') chips.push({ text: memberTrackLabel(member.track, lang) });
  }
  if (member.group === 'studentResearcher') chips.push({ text: memberCourseLabel('undergrad', lang) });
  const years = memberYearLabel(member, lang);
  if (years) chips.push({ text: years, academic: true });
  return chips.map((chip) => `<span class="member-chip member-chip--soft${chip.academic ? ' member-chip--academic' : ''}">${escapeHTML(chip.text)}</span>`).join('');
}

function memberEmailLink(email = '', extraClass = '') {
  if (!email) return '';
  const label = lang === 'en' ? 'Send email' : '이메일 보내기';
  return `<a class="member-email${extraClass ? ` ${escapeHTML(extraClass)}` : ''}" href="mailto:${escapeHTML(email)}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"><i class="ph ph-envelope-simple" aria-hidden="true"></i></a>`;
}

function memberCard(member) {
  const education = memberEducationMarkup(member, lang, 'compact');
  const chips = memberMetaChips(member);
  return `
    <article class="member-card reveal interactive-card" data-member-id="${escapeHTML(member.id)}" tabindex="0" role="button" aria-label="${escapeHTML(memberDisplayName(member))}">
      <div class="member-card__profile">
        <div class="member-thumb">
          ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}" width="96" height="96" loading="lazy" decoding="async">` : `<span>${escapeHTML(getInitials(memberDisplayName(member, 'en') || memberDisplayName(member) || member.name))}</span>`}
        </div>
        <div class="member-card__identity">
          ${chips ? `<div class="member-chip-row">${chips}</div>` : ''}
          <div class="member-card__name-row">
            <h3>${escapeHTML(memberDisplayName(member))}</h3>
            ${memberEmailLink(member.email, 'member-card__email')}
          </div>
        </div>
      </div>
      <div class="member-copy">
        ${education || ''}
      </div>
    </article>
  `;
}


function alumniCard(member) {
  const education = memberEducationMarkup(member, lang, 'compact');
  const chips = [member.graduationYear || '', alumniCourseLabel(member, lang)].filter(Boolean);
  return `
    <article class="member-card member-card--alumni reveal interactive-card" data-member-id="${escapeHTML(member.id)}" tabindex="0" role="button" aria-label="${escapeHTML(memberDisplayName(member))}">
      <div class="member-card__profile">
        <div class="member-thumb">
          ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}" width="80" height="80" loading="lazy" decoding="async">` : `<span>${escapeHTML(getInitials(memberDisplayName(member, 'en') || memberDisplayName(member) || member.name))}</span>`}
        </div>
        <div class="member-card__identity">
          ${chips.length ? `<div class="member-chip-row">${chips.map((chip) => `<span class="member-chip">${escapeHTML(chip)}</span>`).join('')}</div>` : ''}
          <h3>${escapeHTML(memberDisplayName(member))}</h3>
        </div>
      </div>
      <div class="member-copy">
        ${education || (localizedMemberText(member, 'bio') ? `<p>${escapeHTML(localizedMemberText(member, 'bio'))}</p>` : '')}
        ${localizedMemberText(member, 'currentPosition') ? `<p class="muted"><strong>${escapeHTML(copy.currentPosition)}:</strong> ${escapeHTML(localizedMemberText(member, 'currentPosition'))}</p>` : ''}
      </div>
    </article>
  `;
}

function projectCard(project, { compact = false } = {}) {
  const period = getProjectPeriodDisplay(project);
  const investigatorName = projectInvestigatorName(project, lang);
  const participants = projectParticipantMembers(project);
  const participantMeta = participants.length ? `<strong>${escapeHTML(lang === 'en' ? 'Participants' : '참여연구원')}</strong> ${escapeHTML(participants.map((member) => memberDisplayName(member)).join(', '))}` : '';
  const leadMeta = investigatorName
    ? `<strong>${escapeHTML(projectLeadRoleLabel(project, lang))}</strong> ${escapeHTML(investigatorName)}`
    : '';
  return `
    <article class="project-card${compact ? ' compact-card' : ''} reveal interactive-card" data-project-id="${escapeHTML(project.id)}" tabindex="0" role="button" aria-label="${escapeHTML(localizedProjectTitle(project))}">
      <div class="card-head">
        <span class="status-pill">${escapeHTML(projectStatusLabel(project.status, lang))}</span>
        ${period ? `<span class="meta-pill">${escapeHTML(period)}</span>` : ''}
      </div>
      <h3>${escapeHTML(localizedProjectTitle(project))}</h3>
      <p>${escapeHTML(localizedProjectDescription(project) || '')}</p>
      ${leadMeta ? `<p class="project-meta-inline">${leadMeta}</p>` : ''}
      ${!compact && participantMeta ? `<p class="project-meta-inline">${participantMeta}</p>` : ''}
      ${!compact && localizedProjectTags(project).length ? `<div class="tag-row">${localizedProjectTags(project).map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
    </article>
  `;
}

function archiveProjectItem(project) {
  const period = getProjectPeriodDisplay(project) || project.year || '';
  const investigatorName = projectInvestigatorName(project, lang);
  const participants = projectParticipantMembers(project);
  const participantMeta = participants.length ? `<strong>${escapeHTML(lang === 'en' ? 'Participants' : '참여연구원')}</strong> ${escapeHTML(participants.map((member) => memberDisplayName(member)).join(', '))}` : '';
  const leadText = investigatorName ? `<strong>${escapeHTML(projectLeadRoleLabel(project, lang))}</strong> ${escapeHTML(investigatorName)}` : '';
  const metaRow = (leadText || period) ? `<p class="project-meta-inline project-meta-inline--archive">${leadText ? `<span class="project-meta-inline__label">${leadText}</span>` : ''}${period ? `<span class="meta-pill meta-pill--inline">${escapeHTML(period)}</span>` : ''}</p>` : '';
  return `
    <article class="archive-item reveal interactive-card" data-project-id="${escapeHTML(project.id)}" tabindex="0" role="button" aria-label="${escapeHTML(localizedProjectTitle(project))}">
      <div>
        <h3>${escapeHTML(localizedProjectTitle(project))}</h3>
        ${localizedProjectDescription(project) ? `<p>${escapeHTML(localizedProjectDescription(project))}</p>` : ''}
        ${metaRow}
        ${participantMeta ? `<p class="muted">${participantMeta}</p>` : ''}
      </div>
    </article>
  `;
}

function publicationCard(item) {
  const link = resolvePublicationLink(item);
  const indexLabel = publicationIndexingLabel(item.indexing, lang);
  const indexClass = indexLabel ? indexLabel.toLowerCase().replace(/[^a-z]+/g, '') : '';
  const journalTone = journalToneClass(item.journal);
  const yearPill = publicationYearMonthLabel(item);
  const abstractLabel = 'Abstract';
  return `
    <article class="publication-card reveal">
      <div class="publication-head-row">
        <div class="publication-topline">
          ${yearPill ? `<span class="year-pill">${escapeHTML(yearPill)}</span>` : ''}
          <div class="publication-source-group">
            ${item.journal ? `<span class="journal-pill ${journalTone}">${escapeHTML(item.journal)}</span>` : ''}
            ${indexLabel ? `<span class="index-pill ${indexClass ? `index-pill--${escapeHTML(indexClass)}` : ''}">${escapeHTML(indexLabel)}</span>` : ''}
          </div>
        </div>
      </div>
      <h3>${escapeHTML(item.title)}</h3>
      <div class="publication-meta-row">
        ${item.authors ? `<p class="publication-authors">${escapeHTML(item.authors)}</p>` : '<span></span>'}
        ${link ? `<a class="publication-doi-link" href="${escapeHTML(link)}" target="_blank" rel="noreferrer">${escapeHTML(copy.doi)}</a>` : ''}
      </div>
      ${item.abstract ? `
        <details class="publication-abstract">
          <summary><span class="publication-abstract__label">${escapeHTML(abstractLabel)}</span><span class="publication-abstract__icon" aria-hidden="true">▾</span></summary>
          <div class="publication-abstract__content"><p class="muted">${escapeHTML(item.abstract)}</p></div>
        </details>
      ` : ''}
      ${renderPublicationMemberDetails(item)}
    </article>
  `;
}


function youtubeEmbedUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : '';
    }
    if (url.searchParams.get('v')) return `https://www.youtube.com/embed/${url.searchParams.get('v')}`;
    const parts = url.pathname.split('/').filter(Boolean);
    const embedIndex = parts.findIndex((item) => item === 'embed' || item === 'shorts');
    if (embedIndex >= 0 && parts[embedIndex + 1]) return `https://www.youtube.com/embed/${parts[embedIndex + 1]}`;
  } catch (error) {
    const match = raw.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
    if (match) return `https://www.youtube.com/embed/${match[1]}`;
  }
  return '';
}

function boardMediaUrls(post = {}) {
  const seen = new Set();
  const values = [
    ...(Array.isArray(post.imageUrls) ? post.imageUrls : []),
    post.imageUrl || ''
  ];
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function renderBoardGallery(urls = [], alt = '') {
  if (!urls.length) return '';
  if (urls.length === 1) {
    return `<figure class="detail-figure detail-figure--original detail-figure--contain"><img src="${escapeHTML(rootAsset(urls[0], root))}" alt="${escapeHTML(alt)}"></figure>`;
  }
  return `<div class="detail-gallery detail-gallery--grid detail-gallery--gallery">${urls.map((url, index) => `<figure class="detail-gallery__item detail-gallery__item--gallery"><img src="${escapeHTML(rootAsset(url, root))}" alt="${escapeHTML(alt)} ${index + 1}"></figure>`).join('')}</div>`;
}


function normalizeBoardCategory(category = '') {
  const key = String(category || '').trim().toLowerCase();
  if (['conference', 'poster', 'oral'].includes(key)) return 'conference';
  if (['workshop', 'seminar'].includes(key)) return 'workshop';
  if (['equipment', 'news', 'lab-equipment', 'labequipment'].includes(key)) return 'equipment';
  if (['other', 'notice', 'misc'].includes(key)) return 'other';
  return key || 'other';
}

function boardFilterConfig() {
  return lang === 'en'
    ? [['all', 'All'], ['conference', 'Conference'], ['workshop', 'Workshop'], ['equipment', 'Lab equipment list'], ['other', 'Other']]
    : [['all', '전체'], ['conference', '학회'], ['workshop', '워크숍'], ['equipment', '실험실 장비 목록'], ['other', '기타']];
}

function boardCategoryLabel(category = '') {
  const map = {
    conference: lang === 'en' ? 'Conference' : '학회',
    poster: lang === 'en' ? 'Conference' : '학회',
    oral: lang === 'en' ? 'Conference' : '학회',
    workshop: lang === 'en' ? 'Workshop' : '워크숍',
    equipment: lang === 'en' ? 'Lab equipment list' : '실험실 장비 목록',
    news: lang === 'en' ? 'Lab equipment list' : '실험실 장비 목록',
    notice: lang === 'en' ? 'Other' : '기타',
    other: lang === 'en' ? 'Other' : '기타'
  };
  return map[String(category || '').trim().toLowerCase()] || (lang === 'en' ? 'Other' : '기타');
}

function boardDateLabel(value = '') {
  if (!value) return lang === 'en' ? 'Date not set' : '작성일 미정';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return String(value);
  try {
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ko-KR', lang === 'en'
      ? { year: 'numeric', month: 'short', day: 'numeric' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(parsed));
  } catch {
    return String(value);
  }
}

function boardMetaMarkup(post = {}, extraClass = '') {
  const dateLabel = boardDateLabel(post.date);
  const datePrefix = lang === 'en' ? 'Posted' : '작성일';
  return `<div class="board-card__metadata${extraClass ? ` ${escapeHTML(extraClass)}` : ''}">
    <span title="${escapeHTML(datePrefix)}"><i class="ph ph-calendar-blank" aria-hidden="true"></i><span class="sr-only">${escapeHTML(datePrefix)} </span>${escapeHTML(dateLabel)}</span>
  </div>`;
}

function boardCard(post) {
  const youtube = youtubeEmbedUrl(post.youtubeUrl || '');
  const images = boardMediaUrls(post);
  const cover = images[0] || '';
  const media = youtube
    ? `<div class="board-card__media board-card__media--video"><iframe src="${escapeHTML(youtube)}" title="${escapeHTML(post.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : (cover ? `<div class="board-card__media board-card__media--contain"><img src="${escapeHTML(rootAsset(cover, root))}" alt="${escapeHTML(post.title)}" loading="lazy" decoding="async"></div>` : '');
  return `
    <article class="board-card${media ? '' : ' board-card--no-media'} reveal interactive-card" data-board-id="${escapeHTML(post.id)}" tabindex="0" role="button" aria-label="${escapeHTML(post.title)}">
      ${media}
      <div class="board-card__copy">
        <div class="member-chip-row">
          <span class="member-chip member-chip--soft">${escapeHTML(boardCategoryLabel(post.category))}</span>
          ${images.length > 1 ? `<span class="member-chip member-chip--soft">${escapeHTML(lang === 'en' ? `${images.length} photos` : `사진 ${images.length}장`)}</span>` : ''}
        </div>
        ${boardMetaMarkup(post)}
        <h3>${escapeHTML(post.title)}</h3>
        ${post.description ? `<p>${escapeHTML(post.description)}</p>` : ''}
        ${post.linkUrl ? `<a class="member-link" href="${escapeHTML(post.linkUrl)}" target="_blank" rel="noreferrer">${lang === 'en' ? 'Open link' : '링크 열기'}</a>` : ''}
      </div>
    </article>
  `;
}

let accordionId = 0;

function accordionMarkup(title, count, content, open = false) {
  accordionId += 1;
  const triggerId = `accordion-trigger-${accordionId}`;
  const panelId = `accordion-panel-${accordionId}`;
  return `
    <article class="accordion${open ? ' is-open' : ''}">
      <button class="accordion-trigger" id="${triggerId}" type="button" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${panelId}">
        <span class="accordion-copy">
          <span>${escapeHTML(title)}</span>
          <span class="accordion-meta">${escapeHTML(count)} ${escapeHTML(copy.countItems)}</span>
        </span>
        <span class="accordion-icon" aria-hidden="true"></span>
      </button>
      <div class="accordion-panel" id="${panelId}" role="region" aria-labelledby="${triggerId}" aria-hidden="${open ? 'false' : 'true'}"${open ? '' : ' inert'}>
        <div class="accordion-panel__inner">${content}</div>
      </div>
    </article>
  `;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHTML(text)}</div>`;
}

function setupAccordions() {
  qsa('.accordion-trigger').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const article = button.closest('.accordion');
      const panel = article?.querySelector('.accordion-panel');
      if (!article || !panel) return;
      const isOpen = !article.classList.contains('is-open');
      article.classList.toggle('is-open', isOpen);
      panel.setAttribute('aria-hidden', String(!isOpen));
      panel.toggleAttribute('inert', !isOpen);
      button.setAttribute('aria-expanded', String(isOpen));
    });
  });
}
