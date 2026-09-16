import { memberSummary, memberSummaryMarkup } from './member-summary.js';
import { setupPublicChrome } from './chrome.js';
import { portraitMarkup, refreshImageFallbacks } from './portraits.js';
import '../css/icons.css';
import { resolveProjectInvestigator, localizedInvestigatorName } from './project-investigator.js';
import { sortPatents, filterPatents, patentText, patentStatusLabel, normalizePatent, safePatentUrl } from './patents.js';
import { patentsForMember, resolvePatentInventors, patentInventorDisplay } from './patent-inventors.js';
import { BUILD_DATE, SITE_COPY, FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS, FALLBACK_BOARD_POSTS } from './data.js?v=80';
import {
  escapeHTML,
  slugify,
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
  dedupeMembers,
  memberYearLabel,
  publicationIndexingLabel,
  publicationYearMonthLabel,
  normalizeProjectPeriod,
  isActiveItem,
  formatEnglishName,
  setupAdaptiveGlass,
  setSpatialOrigin
} from './utils.js?v=111';
import { hasFirebaseConfig, isLocalDevMode, fetchCollectionResult, readCachedCollection, COLLECTIONS } from './firebase-public.js?v=83';
import { PUBLIC_DATA_CHANGED, getPublicCollectionRevision } from './public-data-cache.js';

document.documentElement.classList.add('js');

const body = document.body;
const page = body.dataset.page;
const lang = body.dataset.lang || 'kr';
const root = body.dataset.root || '.';
const copy = SITE_COPY[lang];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const BOARD_VIEW_STORAGE_KEY = 'geh-board-view-v1';
const BOARD_SORT_STORAGE_KEY = 'geh-board-sort-v1';



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

const heroImages = [
  ['basil-phenotyping.webp', '34% center'],
  ['lettuce-imaging.webp', '36% center'],
  ['field-trials.webp', '50% center'],
  ['cabbage-field.webp', '35% center'],
  ['basil-closeup.webp', '50% center'],
  ['lettuce-closeup.webp', '50% center'],
  ['hemp-greenhouse.webp', '49% center'],
  ['agastache-closeup.webp', '44% center'],
  ['artemisia-closeup.webp', '50% center']
].map(([file, position]) => ({ src: rootAsset(`assets/images/background/${file}`, root), position }));

// Local preview uses fallback data plus localStorage overrides. Only a configured
// remote deployment should suppress fallback content while Firestore is loading.
const useLiveData = hasFirebaseConfig && !isLocalDevMode;
const prerenderedMembers = (() => {
  const source = document.querySelector('#member-roster-data');
  if (!source) return [];
  try {
    const parsed = JSON.parse(source.textContent || '[]');
    return Array.isArray(parsed) ? dedupeMembers(sortMembers(parsed).filter(isActiveItem)) : [];
  } catch (error) {
    console.warn('초기 멤버 명단을 읽지 못했습니다.', error);
    return [];
  }
})();
// The embedded roster is a build-time snapshot, not a resolved live collection.
// Keep it for local previews; production starts from the shared cache or server.
const usePrerenderedMembers = !useLiveData && prerenderedMembers.length > 0;
const state = {
  members: usePrerenderedMembers
    ? prerenderedMembers
    : (useLiveData ? [] : dedupeMembers(sortMembers(FALLBACK_MEMBERS).filter(isActiveItem))),
  projects: useLiveData ? [] : sortProjects(FALLBACK_PROJECTS).filter(isActiveItem),
  publications: useLiveData ? [] : sortPublications(FALLBACK_PUBLICATIONS).filter(isActiveItem),
  board: useLiveData ? [] : sortBoardPosts(FALLBACK_BOARD_POSTS).filter(isActiveItem),
  loadingMembers: useLiveData && (page === 'home' || page === 'members'),
  loadingProjects: useLiveData && (page === 'home' || page === 'projects'),
  loadingPublications: useLiveData && (page === 'home' || page === 'publications'),
  loadingBoard: useLiveData && (page === 'board' || page === 'home'),
  publicationQuery: '',
  patents: [],
  loadingPatents: useLiveData && (page === 'home' || page === 'patents'),
  patentsError: false,
  patentQuery: '',
  patentFilter: 'all',
  boardTab: 'all',
  boardView: savedBoardView(),
  boardSort: savedBoardSort()
};

let renderedMemberSignature = page === 'members' && usePrerenderedMembers
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
  if (page === 'patents' && key === 'members') {
    if (state.patentQuery.trim()) return true;
    const shown = new Set(qsa('[data-patent-contributors]').map((element) => element.dataset.patentContributors));
    return filteredPublicPatents().some((item) => patentInventorSectionNeeded(item) !== shown.has(String(item.id)));
  }
  const visibleCollections = {
    home: new Set(['members', 'projects', 'publications', 'patents', 'board']),
    members: new Set(['members']),
    projects: new Set(['projects', 'members']),
    patents: new Set(['patents']),
    publications: new Set(['publications', 'members']),
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
  memberId: '',
  member: null,
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

// Discard the old page-wide snapshot: it stamped unfetched/empty collections as fresh.
try {
  ['75', '76', '77', '80', '81'].forEach((version) => localStorage.removeItem(`geh-public-cache-v${version}`));
} catch { /* Persistent storage is optional. */ }

const dataIssues = new Map();
const resolvedCollections = new Set(usePrerenderedMembers ? ['members'] : []);
const loadingKeyFor = (key) => `loading${key[0].toUpperCase()}${key.slice(1)}`;

function applyCollectionItems(key, items) {
  let nextItems;
  if (key === 'members') nextItems = dedupeMembers(sortMembers(useLiveData ? items : mergeMembers(FALLBACK_MEMBERS, items)).filter(isActiveItem));
  else if (key === 'projects') nextItems = mergedProjectsForPage(items);
  else if (key === 'publications') nextItems = sortPublications(useLiveData ? items : mergePublications(FALLBACK_PUBLICATIONS, items)).filter(isActiveItem);
  else if (key === 'board') nextItems = mergedBoardForPage(items);
  else nextItems = sortPatents(items).filter(isActiveItem);
  resolvedCollections.add(key);
  if (key === 'patents') state.patentsError = false;
  return replaceCollectionState(key, nextItems, loadingKeyFor(key));
}

function applyCachedState() {
  if (!useLiveData) return;
  Object.entries(COLLECTIONS).forEach(([key, name]) => {
    const record = readCachedCollection(name);
    if (record) applyCollectionItems(key, record.items);
  });
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
    '<div class="profile-avatar profile-avatar--pi"><div class="pi-photo pi-photo--skeleton skeleton-thumb"></div></div>',
    '<div class="pi-card-main">',
    '<div class="pi-card-head">',
    '<span class="skeleton-line skeleton-line--eyebrow"></span>',
    '<span class="skeleton-line skeleton-line--pi-title"></span>',
    '<span class="skeleton-line skeleton-line--pi-subtitle"></span>',
    '</div>',
    '</div>',
    '<div class="pi-card-focus">',
    '<span class="skeleton-line skeleton-line--panel-heading"></span>',
    '<span class="skeleton-line skeleton-line--text"></span>',
    '<span class="skeleton-line skeleton-line--text short"></span>',
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
  return resolveProjectInvestigator(project, state.members);
}

function projectInvestigatorName(project = {}, locale = lang) {
  return localizedInvestigatorName(project, state.members, locale);
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
  setupAdaptiveGlass(document);
  setupHeader();
  ensureModal();
  setupRevealAnimations();
  setupSearch();
  if (page === 'home') setupHeroSlider();

  // A fresh per-collection cache avoids another server read on navigation.
  applyCachedState();
  renderPage();
  if (window.GEH_BOOT_TIMEOUT) window.clearTimeout(window.GEH_BOOT_TIMEOUT);
  if (document.documentElement.classList.contains('js-fallback')) {
    qsa('.reveal').forEach((item) => item.classList.add('is-visible'));
    document.documentElement.classList.remove('js-fallback');
  }
  refreshPublicData();
  setupPublicDataRefresh();
});

const pageCollections = {
  home: [COLLECTIONS.members, COLLECTIONS.projects, COLLECTIONS.publications, COLLECTIONS.patents, COLLECTIONS.board],
  members: [COLLECTIONS.members, COLLECTIONS.publications],
  projects: [COLLECTIONS.projects, COLLECTIONS.members],
  patents: [COLLECTIONS.patents],
  publications: [COLLECTIONS.publications, COLLECTIONS.members],
  board: [COLLECTIONS.board]
};

function visibleCollectionNames() {
  const names = new Set(pageCollections[page] || []);
  if (modalState.memberId) names.add(COLLECTIONS.patents);
  // English inventor credits need the registered member names even while the
  // profile disclosure is closed. This reuses the shared roster cache.
  if (page === 'patents' && (lang === 'en' || modalState.memberId || qs('[data-patent-contributors][open]'))) names.add(COLLECTIONS.members);
  return [...names];
}

function showDataIssues() {
  if (!dataIssues.size) {
    qs('#public-status-notice')?.remove();
    return;
  }
  const hasMissing = [...dataIssues.keys()].some((key) => !resolvedCollections.has(key));
  showPublicNotice(lang === 'en'
    ? (hasMissing ? 'Some data could not be loaded. Please try again shortly.' : 'The latest data could not be checked. Showing the last available content.')
    : (hasMissing ? '일부 데이터를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.' : '최신 데이터를 확인하지 못해 마지막으로 불러온 내용을 표시합니다.'),
  hasMissing ? 'danger' : 'warning');
}

async function hydrate() {
  if (!hasFirebaseConfig) return;
  const names = visibleCollectionNames();
  const revisions = names.map(getPublicCollectionRevision);
  const results = await Promise.allSettled(names.map((name) => fetchCollectionResult(name)));
  let shouldRender = false;
  results.forEach((result, index) => {
    if (revisions[index] !== getPublicCollectionRevision(names[index])) {
      refreshAfterCurrentRequest = true;
      return;
    }
    const key = Object.keys(COLLECTIONS).find((key) => COLLECTIONS[key] === names[index]);
    const previousIssue = dataIssues.get(key);
    if (result.status === 'fulfilled') {
      const changed = applyCollectionItems(key, result.value.items);
      if (result.value.stale) dataIssues.set(key, result.value.error || true);
      else dataIssues.delete(key);
      shouldRender = (changed && collectionAffectsCurrentPage(key)) || shouldRender;
    } else {
      dataIssues.set(key, result.reason);
      // Never turn a failed request into an empty successful collection/cache.
      state[loadingKeyFor(key)] = false;
      if (key === 'patents') state.patentsError = !resolvedCollections.has(key);
      shouldRender = true;
    }
    if (previousIssue !== dataIssues.get(key)) shouldRender = true;
  });
  showDataIssues();
  refreshOpenMemberPatentBlock();
  refreshPatentInventorBlocks();
  if (shouldRender) renderPageWithoutInterruptingMemberProfile();
}

let publicRefreshPromise = null;
let refreshAfterCurrentRequest = false;
function refreshPublicData() {
  if (publicRefreshPromise) return publicRefreshPromise;
  if (document.hidden) return Promise.resolve();
  refreshAfterCurrentRequest = false;
  publicRefreshPromise = hydrate().catch((error) => console.warn('데이터 조회 실패', error)).finally(() => {
    publicRefreshPromise = null;
    if (refreshAfterCurrentRequest && !document.hidden) {
      refreshAfterCurrentRequest = false;
      refreshPublicData();
    }
  });
  return publicRefreshPromise;
}

function setupPublicDataRefresh() {
  // No Firestore snapshot listeners on public pages. Only visible pages recheck
  // expiry; fresh entries and a short failure cooldown do not contact the server.
  let timer = null;
  const stop = () => { window.clearTimeout(timer); timer = null; };
  const schedule = () => {
    stop();
    if (document.hidden) return;
    const expirations = visibleCollectionNames().map((name) => readCachedCollection(name))
      .filter(Boolean).map((entry) => entry.fetchedAt + 600000 - Date.now());
    const delay = Math.max(50, Math.min(60000, ...expirations));
    timer = window.setTimeout(() => {
      refreshPublicData().finally(schedule);
    }, delay);
  };
  const resume = () => {
    if (document.hidden) { stop(); return; }
    refreshPublicData();
    schedule();
  };
  window.addEventListener(PUBLIC_DATA_CHANGED, (event) => {
    const changed = event.detail?.collections || [];
    if (!visibleCollectionNames().some((name) => changed.includes(name))) return;
    if (document.hidden) return;
    if (publicRefreshPromise) refreshAfterCurrentRequest = true;
    else refreshPublicData();
  });
  // The localhost editor writes a separate fixture store, never the live database.
  window.addEventListener('storage', (event) => {
    if (isLocalDevMode && (event.key === null || event.key?.startsWith('geh-local-collection:'))) resume();
  });
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('pagehide', stop);
  window.addEventListener('focus', resume);
  schedule();
}

let requestedSearchItemOpened = false;
function renderPage() {

  if (page === 'home') renderHome();
  if (page === 'members') renderMembers();
  if (page === 'projects') renderProjects();
  if (page === 'publications') renderPublications();
  if (page === 'patents') renderPatents();
  if (page === 'board') renderBoard();
  setUpdatedDate();
  setupRevealAnimations();
  setupAccordions();
  setupCountAnimations();
  bindInteractiveCards();
  openRequestedSearchItem();
  // Release the pre-paint guard only after stale HTML and its date are replaced.
  if (page === 'members') document.documentElement.classList.remove('member-roster-pending');
}

function openRequestedSearchItem() {
  if (requestedSearchItemOpened) return;
  const id = new URLSearchParams(location.search).get('item');
  if (!id) return;
  const key = page === 'board' ? 'board' : page;
  const item = state[key]?.find(entry => String(entry.id) === id);
  if (!item) return;
  requestedSearchItemOpened = true;
  if (page === 'members') openMemberModal(item);
  else if (page === 'projects') openProjectModal(item);
  else if (page === 'board') openBoardModal(item);
  else if (page === 'publications') {
    state.publicationQuery = item.title || '';
    qs('#publication-search').value = state.publicationQuery;
    renderPublications(); setupAccordions(); setupRevealAnimations(); bindInteractiveCards();
  } else if (page === 'patents') {
    state.patentQuery = item.applicationNumber || patentText(item, 'title', lang);
    qs('#patent-search').value = state.patentQuery;
    renderPatents(); setupAccordions(); setupRevealAnimations();
  }
}

function setupHeader() {
  setupPublicChrome({ lang, page, loadSearch: loadGlobalSearch });
  if (page === 'contact') setupMapControlLabels();
}

function setupMapControlLabels() {
  const map = qs('.root_daum_roughmap');
  if (!map) return;
  const controls = [
    ['.btn_zoom_in', lang === 'en' ? 'Zoom in' : '지도 확대'],
    ['.btn_zoom_out', lang === 'en' ? 'Zoom out' : '지도 축소'],
    ['.btn_zoom_reset', lang === 'en' ? 'Reset map' : '지도 초기화']
  ];
  const label = () => controls.every(([selector, text]) => {
    const button = map.querySelector(selector);
    if (!button) return false;
    button.type = 'button';
    button.setAttribute('aria-label', text);
    button.title = text;
    return true;
  });
  if (label()) return;
  const observer = new MutationObserver(() => { if (label()) observer.disconnect(); });
  observer.observe(map, { childList: true, subtree: true });
}

async function loadGlobalSearch(attempt = 0) {
  const keys = ['members', 'projects', 'publications', 'patents', 'board'];
  const revisions = keys.map((key) => getPublicCollectionRevision(COLLECTIONS[key]));
  // Shares the page's requests and per-collection cache, including valid empty results.
  const results = await Promise.allSettled(keys.map(async (key) => {
    let timer;
    try {
      return await Promise.race([
        fetchCollectionResult(COLLECTIONS[key]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Search timeout')), 10000); })
      ]);
    } finally { clearTimeout(timer); }
  }));
  const invalidated = keys.map((key, index) => revisions[index] !== getPublicCollectionRevision(COLLECTIONS[key]));
  if (invalidated.some(Boolean) && attempt === 0 && !document.hidden) return loadGlobalSearch(1);
  const collections = {};
  results.forEach((result, index) => {
    const key = keys[index];
    const items = invalidated[index] ? [] : result.status === 'fulfilled' ? result.value.items : state[key];
    collections[key] = (useLiveData ? items : (items?.length ? items : state[key]) || []).filter(isActiveItem);
  });
  const labels = lang === 'en' ? ['Members','Projects','Publications','Patents','Board'] : ['멤버','과제','논문','특허','게시판'];
  const pages = ['members','projects','publications','patents','news'];
  const titleFor = {
    members: item => memberDisplayName(item),
    projects: item => localizedProjectTitle(item),
    publications: item => item.title,
    patents: item => patentText(item, 'title', lang),
    board: item => (lang === 'en' ? item.titleEn : item.titleKr) || item.titleKr || item.titleEn || item.title
  };
  return { partial: invalidated.some(Boolean) || results.some(result => result.status === 'rejected' || result.value.stale), items: keys.flatMap((key, index) => collections[key].map(item => ({
    title: titleFor[key](item) || labels[index], group: labels[index],
    search: [item.nameKr, item.nameEn, item.titleKr, item.titleEn, item.authors, item.year, item.applicationNumber, item.registrationNumber].filter(Boolean).join(' '),
    href: `${pages[index]}.html?item=${encodeURIComponent(item.id)}`
  }))) };
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
    const focusable = qsa('a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', wrapper)
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
  modalState.memberId = '';
  modalState.member = null;
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
  modalState.memberId = '';
  modalState.member = null;
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
      : (triggerMemberId ? qsa('button[data-member-id], [role="button"][data-member-id]').find((item) => item.dataset.memberId === triggerMemberId) : null);
    if (currentTrigger?.isConnected) currentTrigger.focus({ preventScroll: true });
    modalState.trigger = null;
    modalState.instant = false;
    modalState.root.classList.remove('is-instant');
  };
  modalState.closeTimer = window.setTimeout(finish, reducedMotion.matches ? 0 : 160);
}

function bindInteractiveCards() {
  refreshImageFallbacks(root);
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
        if (event.target !== card) return;
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

  qsa('[data-patent-contributors]').forEach((details) => {
    if (details.dataset.contributorsBound === 'true') return;
    details.dataset.contributorsBound = 'true';
    let wasOpen = details.open;
    details.addEventListener('toggle', () => {
      if (wasOpen === details.open) return;
      wasOpen = details.open;
      if (!details.open || !details.isConnected) return;
      if (publicRefreshPromise) refreshAfterCurrentRequest = true;
      else refreshPublicData();
    });
  });

  bindCard('[data-project-id]', 'projectId', (id) => () => {
    const project = state.projects.find((item) => item.id === id);
    if (project) openProjectModal(project);
  });

  bindCard('[data-board-id]', 'boardId', (id) => () => {
    const post = state.board.find((item) => item.id === id);
    if (post) openBoardModal(post);
  });

  bindCard('.home-publication-card[data-publication-id]', 'publicationId', (id) => () => {
    const publication = state.publications.find((item) => String(item.id) === id);
    if (publication) openPublicationModal(publication);
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
  if (!['phd', 'ms'].includes(course)) return '';
  const base = memberCourseLabel(course, locale);
  if (!base) return '';
  return locale === 'en' ? `${base} alumni` : `${base} 졸업`;
}

function openMemberModal(member) {
  const chips = [];
  if (member.group !== 'alumni') chips.push(member.group === 'pi' ? copy.pi : (member.group === 'researchProfessor' ? copy.researchProfessor : member.group === 'studentResearcher' ? copy.studentResearcherSection : copy.graduateStudent));
  if (member.group === 'graduateStudent') {
    chips.push(memberCourseLabel(member.course, lang));
    if (member.track && member.track !== 'none') chips.push(memberTrackLabel(member.track, lang));
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
  const photo = portraitMarkup({ source: member.photoUrl, name: displayName, initialsName: memberDisplayName(member, 'en') || displayName, root, size: 160, eager: true });
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
    `<article class="detail-block detail-block--patents" data-member-patents="${escapeHTML(member.id)}">${renderMemberPatentBlock(member)}</article>`,
    renderMemberPublicationBlock(member)
  ].filter(Boolean).join('');
  openModal(title, `
    <div class="detail-modal detail-modal--member">
      <div class="member-detail-header">
        <div class="detail-modal__media" role="img" aria-label="${escapeHTML(displayName)}">${photo}</div>
        <div class="detail-modal__summary">
          <div class="member-chip-row">${chips.map((chip) => `<span class="member-chip member-chip--soft">${escapeHTML(chip)}</span>`).join('')}</div>
          <h3>${escapeHTML(displayName)}</h3>
          ${localizedMemberText(member, 'bio') ? `<p class="detail-lead">${escapeHTML(localizedMemberText(member, 'bio'))}</p>` : ''}
          ${memberEmailLink(member.email, 'detail-member-email')}
        </div>
      </div>
      ${interestSection ? `<div class="member-detail-interest">${interestSection}</div>` : ''}
      ${coreDetailSections ? `<div class="detail-grid detail-grid--member-core">${coreDetailSections}</div>` : ''}
      ${extendedDetailSections ? `<div class="detail-grid detail-grid--member-extended">${extendedDetailSections}</div>` : ''}
    </div>
  `);
  modalState.memberId = String(member.id || '');
  modalState.member = member;
  ensureMemberPatents();
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

function openPublicationModal(publication) {
  const link = resolvePublicationLink(publication);
  openModal(publication.title || '', `
    <div class="detail-modal detail-modal--publication">
      <div class="publication-detail-summary">
        ${homePublicationTopline(publication)}
        ${publication.authors ? `<p class="publication-authors">${escapeHTML(publication.authors)}</p>` : ''}
        ${link ? `<a class="button primary" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${lang === 'en' ? 'Read paper' : '논문 원문'}</a>` : ''}
      </div>
      ${detailSection('Abstract', publication.abstract || (lang === 'en' ? 'No abstract provided.' : '등록된 초록이 없습니다.'))}
      ${renderPublicationMemberDetails(publication)}
    </div>
  `);
  modalState.root.querySelector('.site-modal__scroll').scrollTop = 0;
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
  const links = direct.length ? direct : state.members.flatMap((member) =>
    (Array.isArray(member.publicationLinks) ? member.publicationLinks : [])
      .filter((link) => String(link.publicationId || link.id || '') === String(publication.id || ''))
      .map((link) => ({ ...link, memberId: member.id })));
  const items = new Map();
  for (const link of links) {
    const memberId = String(link.memberId || link.id || '');
    const member = state.members.find((entry) => String(entry.id) === memberId);
    const memberName = memberDisplayName(member || { nameKr: link.memberName, nameEn: link.memberName, name: link.memberName });
    if (!memberName) continue;
    const key = memberId || memberName;
    const item = items.get(key) || { memberId, memberName, roles: [] };
    item.roles = sortRoles([...new Set([...item.roles, ...(Array.isArray(link.roles) ? link.roles : [])])])
      .filter((role) => ['first', 'co', 'corresponding'].includes(role));
    items.set(key, item);
  }
  return [...items.values()].sort((a, b) => rolePriority(a.roles) - rolePriority(b.roles)
    || a.memberName.localeCompare(b.memberName, lang === 'en' ? 'en' : 'ko'));
}

function renderRecordContributors(items = [], { kind = 'authors' } = {}) {
  if (!items.length) return '';
  return `<ul class="record-contributors__list">${items.map((item) => {
    const linked = state.members.some((member) => String(member.id) === String(item.memberId));
    const name = escapeHTML(item.memberName);
    const roles = kind === 'authors' ? sortRoles(item.roles).filter((role) => ['first', 'co', 'corresponding'].includes(role)) : [];
    return `<li class="record-contributors__item">
      ${linked ? `<button type="button" class="record-contributors__profile" data-member-id="${escapeHTML(item.memberId)}" aria-label="${name} ${lang === 'en' ? 'profile' : '프로필 보기'}"><span>${name}</span></button>` : `<span class="record-contributors__name">${name}</span>`}
      ${roles.length ? `<span class="record-contributors__roles">${roles.map((role) => `<span class="record-contributors__role record-contributors__role--${role}">${escapeHTML(publicationRoleLabel(role, lang))}</span>`).join('')}</span>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

function renderPublicationMemberDetails(publication = {}) {
  const items = resolvePublicationMemberItems(publication);
  if (!items.length) return '';
  return `<details class="publication-abstract record-contributors">
    <summary><span class="publication-abstract__label" lang="en">Lab authors</span><span class="publication-abstract__icon" aria-hidden="true">▾</span></summary>
    <div class="publication-abstract__content">${renderRecordContributors(items, { kind: 'authors' })}</div>
  </details>`;
}

function renderPatentInventorContent(item = {}) {
  if (hasFirebaseConfig && !resolvedCollections.has('members')) {
    return `<p class="muted" role="status">${dataIssues.has('members')
      ? (lang === 'en' ? 'Lab inventor profiles could not be loaded. Please try again shortly.' : '연구실 발명자 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.')
      : (lang === 'en' ? 'Loading lab inventor profiles…' : '연구실 발명자 정보를 불러오는 중입니다.')}</p>`;
  }
  const resolved = resolvePatentInventors(item, state.members);
  const items = resolved.memberIds.map((memberId) => {
    const member = state.members.find((entry) => String(entry.id) === memberId)
      || resolved.memberSnapshots.find((entry) => entry.memberId === memberId);
    return { memberId, memberName: member ? memberDisplayName(member) : '' };
  }).filter((entry) => entry.memberName);
  const notice = dataIssues.has('members') ? `<p class="muted" role="status">${lang === 'en' ? 'Showing the last available lab inventor profiles.' : '마지막으로 불러온 연구실 발명자 정보를 표시합니다.'}</p>` : '';
  return notice + (items.length ? renderRecordContributors(items, { kind: 'inventors' })
    : `<p class="muted">${lang === 'en' ? 'No linked lab inventors.' : '연결된 연구실 발명자가 없습니다.'}</p>`);
}

function patentInventorSectionNeeded(item = {}) {
  const resolved = resolvePatentInventors(item, state.members);
  // Explicitly external-only records need no profile section. Legacy names may
  // link once the visitor opens this section and the roster arrives from cache.
  if (!resolved.legacy && !resolved.memberIds.length) return false;
  if (resolved.legacy && (resolvedCollections.has('members') || !hasFirebaseConfig) && !resolved.memberIds.length) return false;
  return true;
}

function renderPatentInventorDetails(item = {}) {
  if (!patentInventorSectionNeeded(item)) return '';
  return `<details class="publication-abstract record-contributors" data-patent-contributors="${escapeHTML(item.id)}">
    <summary><span class="publication-abstract__label">${lang === 'en' ? 'Lab inventors' : '연구실 발명자'}</span><span class="publication-abstract__icon" aria-hidden="true">▾</span></summary>
    <div class="publication-abstract__content" data-patent-contributors-content>${renderPatentInventorContent(item)}</div>
  </details>`;
}

function refreshPatentInventorBlocks() {
  if (page !== 'patents') return;
  qsa('[data-patent-inventor-names]').forEach((element) => {
    const item = state.patents.find((entry) => String(entry.id) === element.dataset.patentInventorNames);
    if (item) element.textContent = patentInventorDisplay(item, state.members, lang);
  });
  qsa('[data-patent-contributors]').forEach((details) => {
    const item = state.patents.find((entry) => String(entry.id) === details.dataset.patentContributors);
    const content = details.querySelector('[data-patent-contributors-content]');
    if (!item || !content) return;
    const html = renderPatentInventorContent(item);
    if (content.innerHTML !== html) content.innerHTML = html;
  });
  bindInteractiveCards();
}

function filteredPublicPatents() {
  const candidates = filterPatents(state.patents, '', state.patentFilter);
  const query = state.patentQuery.trim().toLowerCase();
  if (!query) return candidates;
  return candidates.filter((item) => filterPatents([item], query).length
    || patentInventorDisplay(item, state.members, lang).toLowerCase().includes(query));
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

let memberPatentsPromise = null;

function ensureMemberPatents() {
  if (!modalState.memberId || document.hidden || !hasFirebaseConfig) return Promise.resolve();
  if (memberPatentsPromise) return memberPatentsPromise;
  const cached = readCachedCollection(COLLECTIONS.patents);
  if (cached) {
    applyCollectionItems('patents', cached.items);
    dataIssues.delete('patents');
    refreshOpenMemberPatentBlock();
    return Promise.resolve();
  }
  const revision = getPublicCollectionRevision(COLLECTIONS.patents);
  let invalidated = false;
  state.loadingPatents = !resolvedCollections.has('patents');
  refreshOpenMemberPatentBlock();
  memberPatentsPromise = fetchCollectionResult(COLLECTIONS.patents).then((result) => {
    if (revision !== getPublicCollectionRevision(COLLECTIONS.patents)) { invalidated = true; return; }
    applyCollectionItems('patents', result.items);
    if (result.stale) dataIssues.set('patents', result.error || true);
    else dataIssues.delete('patents');
  }).catch((error) => {
    if (revision !== getPublicCollectionRevision(COLLECTIONS.patents)) { invalidated = true; return; }
    state.loadingPatents = false;
    state.patentsError = !resolvedCollections.has('patents');
    dataIssues.set('patents', error);
  }).finally(() => {
    memberPatentsPromise = null;
    refreshOpenMemberPatentBlock();
    if (invalidated && modalState.memberId && !document.hidden) ensureMemberPatents();
  });
  return memberPatentsPromise;
}

function refreshOpenMemberPatentBlock() {
  if (!modalState.memberId || !modalState.root || modalState.root.hidden) return;
  const slot = modalState.body?.querySelector('[data-member-patents]');
  if (!slot || slot.dataset.memberPatents !== modalState.memberId) return;
  const member = state.members.find((item) => String(item.id) === modalState.memberId) || modalState.member;
  if (!member) return;
  const markup = renderMemberPatentBlock(member);
  // Preserve the portrait, scroll position and other profile sections when data arrives.
  if (slot.innerHTML !== markup) slot.innerHTML = markup;
}

function renderMemberPatentBlock(member = {}) {
  const en = lang === 'en';
  const heading = `<h4>${en ? 'Related patents' : '관련 특허'}</h4>`;
  const issue = dataIssues.get('patents');
  if (!resolvedCollections.has('patents') && hasFirebaseConfig) {
    const message = issue || state.patentsError
      ? (en ? 'Patent counts are unavailable. Please try again shortly.' : '특허 정보를 불러오지 못해 건수를 확인할 수 없습니다. 잠시 후 다시 확인해주세요.')
      : (en ? 'Loading patent information…' : '특허 정보를 불러오는 중입니다.');
    return `${heading}<div class="detail-block__body"><p class="muted" role="status">${message}</p></div>`;
  }
  const items = patentsForMember(state.patents, member, state.members);
  const granted = items.filter((item) => item.status === 'granted').length;
  const filed = items.filter((item) => item.status === 'pending').length;
  const summary = `<div class="member-publication-summary member-patent-summary">
    <span class="member-publication-summary-chip member-patent-summary--granted">${en ? `Granted ${granted}` : `등록 ${granted}건`}</span>
    <span class="member-publication-summary-chip member-patent-summary--filed">${en ? `Filed ${filed}` : `출원 ${filed}건`}</span>
  </div>`;
  const notice = issue ? `<p class="muted" role="status">${en ? 'Showing the last available patent information.' : '마지막으로 불러온 특허 정보를 표시합니다.'}</p>` : '';
  const list = items.length ? `<div class="member-publication-list">${items.map((item) => {
    const date = item.status === 'granted' ? item.registrationDate : item.applicationDate;
    const number = item.status === 'granted' ? item.registrationNumber : item.applicationNumber;
    const meta = [patentStatusLabel(item.status, lang), date, number].filter(Boolean).join(' · ');
    const href = item.url || `patents.html?item=${encodeURIComponent(item.id)}`;
    return `<article class="member-publication-item member-publication-item--linked member-patent-item">
      <div class="member-publication-main"><strong>${escapeHTML(patentText(item, 'title', lang))}</strong><div class="member-publication-meta">${escapeHTML(meta)}</div></div>
      <a class="member-publication-link" href="${escapeHTML(href)}"${item.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>${en ? 'View patent' : '특허 보기'}</a>
    </article>`;
  }).join('')}</div>` : `<p class="muted">${en ? 'No linked patents yet.' : '연결된 특허가 아직 없습니다.'}</p>`;
  return `${heading}<div class="detail-block__body">${summary}${notice}${list}</div>`;
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
      { threshold: 0, rootMargin: '0px 0px 40px 0px' }
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
    const progress = Math.max(0, Math.min((now - start) / duration, 1));
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
    const image = heroImages[order % heroImages.length];
    const imageUrl = image.src;
    slide.style.backgroundPosition = image.position;
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
    const nextIndex = (index + 1) % slides.length;
    // Keep the current photo visible while the next background is still loading.
    if (!slides[nextIndex].style.backgroundImage) return schedule();
    slides[index].classList.remove('is-active');
    index = nextIndex;
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
  const count = value == null ? '<strong>—</strong>' : `<strong class="count-up" data-target="${escapeHTML(value)}">0</strong>`;
  return `<article class="stat-card stat-card--summary reveal">${count}<span>${escapeHTML(title)}</span>${meta ? `<div class="stat-card__meta">${meta}</div>` : ''}</article>`;
}

function homeLoadingSummaryCard(title) {
  return '<article class="stat-card stat-card--summary stat-card--skeleton stat-card--loading reveal" aria-hidden="true"><strong class="skeleton-line skeleton-line--number"></strong><span>' + escapeHTML(title) + '</span><div class="stat-card__meta"><small class="skeleton-chip"></small><small class="skeleton-chip skeleton-chip--short"></small></div></article>';
}

function homeCollectionSummaryCard(key, title, value, lines) {
  if (useLiveData && !resolvedCollections.has(key)) {
    if (state[loadingKeyFor(key)]) return homeLoadingSummaryCard(title);
    return homeSummaryCard(title, null, [lang === 'en' ? 'Count unavailable' : '집계 정보를 불러오지 못했습니다.']);
  }
  return homeSummaryCard(title, value, lines);
}

function homePatentSummaryCard() {
  const title = lang === 'en' ? 'Patents' : '특허';
  if (state.loadingPatents) return homeLoadingSummaryCard(title);
  if (state.patentsError) return homeSummaryCard(title, null, [lang === 'en' ? 'Count unavailable' : '집계 정보를 불러오지 못했습니다.']);
  const granted = state.patents.filter((item) => item.status === 'granted').length;
  const pending = state.patents.filter((item) => item.status === 'pending').length;
  return homeSummaryCard(title, state.patents.length, [
    `${patentStatusLabel('granted', lang)} ${granted}`,
    `${patentStatusLabel('pending', lang)} ${pending}`
  ]);
}

function homeIsInitialLoading() {
  return useLiveData
    && page === 'home'
    && (state.loadingMembers || state.loadingProjects || state.loadingPublications || state.loadingPatents || state.loadingBoard)
    && !state.members.length
    && !state.projects.length
    && !state.publications.length
    && !state.patents.length
    && !state.board.length;
}

function loadingStateText(kind = '') {
  const label = lang === 'en' ? 'Loading data…' : `${kind ? `${kind} ` : ''}데이터를 불러오는 중입니다.`;
  return emptyState(label);
}

function homePublicationTopline(item = {}) {
  const indexLabel = publicationIndexingLabel(item.indexing, lang);
  const indexClass = indexLabel ? indexLabel.toLowerCase().replace(/[^a-z]+/g, '') : '';
  const journalTone = journalToneClass(item.journal);
  const yearPill = publicationYearMonthLabel(item);
  return `<div class="publication-topline home-publication-card__topline">
      ${yearPill ? `<span class="year-pill">${escapeHTML(yearPill)}</span>` : ''}
      <div class="publication-source-group">
        ${item.journal ? `<span class="journal-pill ${journalTone}">${escapeHTML(item.journal)}</span>` : ''}
        ${indexLabel ? `<span class="index-pill ${indexClass ? `index-pill--${escapeHTML(indexClass)}` : ''}">${escapeHTML(indexLabel)}</span>` : ''}
      </div>
    </div>`;
}

function homePublicationCard(item = {}) {
  const detailLabel = lang === 'en' ? 'View details' : '상세 보기';
  return `<article class="home-publication-card reveal interactive-card" data-publication-id="${escapeHTML(item.id)}" tabindex="0" role="button" aria-haspopup="dialog" aria-label="${escapeHTML(`${item.title || ''} · ${detailLabel}`)}">
    ${homePublicationTopline(item)}
    <h3>${escapeHTML(item.title || '')}</h3>
    ${item.authors ? `<p class="muted home-publication-card__authors">${escapeHTML(item.authors)}</p>` : ''}
    <div class="home-publication-card__actions">
      <span class="member-link" aria-hidden="true">${detailLabel}</span>
    </div>
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
  if (item.linkUrl) indicators.push(`<span class="home-news-indicator">${lang === 'en' ? 'Link' : '링크'}</span>`);
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
        homeLoadingSummaryCard(lang === 'en' ? 'Patents' : '특허'),
        homeLoadingSummaryCard(lang === 'en' ? 'Board' : '게시판')
      ].join('');
    } else {
      heroStat.innerHTML = [
        homeCollectionSummaryCard('members', lang === 'en' ? 'Members' : '구성원', memberCounts.total, [lang === 'en' ? `PI ${piCount} · Research ${researchProfessors}` : `지도교수 ${piCount} · 연구교수 ${researchProfessors}`, lang === 'en' ? `Graduate ${graduateStudents.length} · Undergraduate ${undergrads}` : `대학원생 ${graduateStudents.length} · 학부연구생 ${undergrads}`]),
        homeCollectionSummaryCard('projects', lang === 'en' ? 'Projects' : '과제', ongoingProjects.length, [lang === 'en' ? `Ongoing ${ongoingProjects.length}` : `진행 중 ${ongoingProjects.length}`, lang === 'en' ? `Archived ${completedProjects.length}` : `종료 ${completedProjects.length}`]),
        homeCollectionSummaryCard('publications', lang === 'en' ? 'Publications' : '논문', state.publications.length, publicationSummaryLines(currentYearPubs, currentYear)),
        homePatentSummaryCard(),
        homeCollectionSummaryCard('board', lang === 'en' ? 'Board' : '게시판', state.board.length, [lang === 'en' ? `Articles ${boardOtherCount} · Conference ${boardConferenceCount}` : `기사 ${boardOtherCount} · 학회 ${boardConferenceCount}`, lang === 'en' ? `Workshop ${boardWorkshopCount} · Lab equipment ${boardEquipmentCount}` : `워크숍 ${boardWorkshopCount} · 실험실 장비 목록 ${boardEquipmentCount}`])
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
  const membersUnavailable = useLiveData && !membersLoading && !resolvedCollections.has('members');
  const initialPiCard = qs('#pi-card');
  if (initialPiCard && pi) {
    initialPiCard.classList.add('pi-card--clickable');
    initialPiCard.dataset.memberId = pi.id;
  }
  const nextRenderSignature = membersLoading ? '__loading__' : membersUnavailable ? '__unavailable__' : collectionRenderSignature(members);
  if (nextRenderSignature === renderedMemberSignature) return;
  renderedMemberSignature = nextRenderSignature;

  if (membersLoading || membersUnavailable) {
    const unavailable = emptyState(lang === 'en' ? 'Member information could not be loaded. Please try again shortly.' : '멤버 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.');
    const pageStats = qs('#page-stat-grid');
    if (pageStats) {
      const stats = memberSummary([], lang).stats;
      pageStats.innerHTML = stats.map(({ label }) => membersLoading
        ? projectStatSkeleton(label)
        : `<article class="stat-card stat-card--summary reveal"><span>${escapeHTML(label)}</span><strong>—</strong></article>`).join('');
    }
    const piCard = qs('#pi-card');
    if (piCard) {
      piCard.classList.remove('pi-card--clickable');
      piCard.removeAttribute('data-member-id');
      piCard.innerHTML = membersLoading ? piSkeletonCard() : unavailable;
    }
    const researchList = qs('#research-professor-list');
    if (researchList) researchList.innerHTML = membersLoading ? memberGridSkeleton(3, 'member-grid--wide') : unavailable;
    const graduateAccordion = qs('#graduate-accordion');
    if (graduateAccordion) {
      graduateAccordion.innerHTML = membersLoading ? [
        accordionMarkup(copy.phdFullTime, '…', memberGridSkeleton(3), true),
        accordionMarkup(copy.phdPartTime, '…', memberGridSkeleton(2), false),
        accordionMarkup(copy.msFullTime, '…', memberGridSkeleton(2), false),
        accordionMarkup(copy.msPartTime, '…', memberGridSkeleton(2), false)
      ].join('') : unavailable;
    }
    const researcherAccordion = qs('#student-researcher-accordion');
    if (researcherAccordion) researcherAccordion.innerHTML = membersLoading ? accordionMarkup(copy.studentResearcherSection, '…', memberGridSkeleton(2, 'member-grid--wide'), false) : unavailable;
    const alumniAccordion = qs('#alumni-accordion');
    if (alumniAccordion) alumniAccordion.innerHTML = membersLoading ? accordionMarkup(copy.stats.alumni, '…', memberGridSkeleton(3, 'member-grid--alumni'), false) : unavailable;
    return;
  }

  const pageStats = qs('#page-stat-grid');
  if (pageStats) {
    pageStats.innerHTML = memberSummaryMarkup(state.members, lang);
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
      piCard.innerHTML = `
        <div class="pi-card-layout">
          <div class="profile-avatar profile-avatar--pi"><button type="button" class="pi-photo" data-member-id="${escapeHTML(pi.id)}" aria-label="${escapeHTML(memberDisplayName(pi))} ${lang === 'en' ? 'details' : '상세 보기'}">
            ${portraitMarkup({ source: pi.photoUrl, name: memberDisplayName(pi), initialsName: memberDisplayName(pi, 'en'), root, size: 168, eager: true })}
          </button></div>
          <div class="pi-card-main">
            <div class="pi-card-head">
              <span class="eyebrow">${escapeHTML(copy.pi)}</span>
              <div class="pi-name-row"><h2>${escapeHTML(memberDisplayName(pi))}</h2>${memberYearLabel(pi, lang) ? `<span class="member-chip member-chip--soft">${escapeHTML(memberYearLabel(pi, lang))}</span>` : ''}${memberEmailLink(pi.email, 'pi-card-email')}</div>
              <p class="pi-title">${escapeHTML(localizedMemberText(pi, 'bio') || (lang === 'en' ? 'Professor, Chungnam National University' : '충남대학교 교수'))}</p>
            </div>
          </div>
          ${piInterest ? `<div class="pi-card-focus"><h3>${escapeHTML(copy.interest)}</h3><p class="pi-research-summary">${escapeHTML(piInterest)}</p></div>` : ''}
        </div>
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


function patentCard(record) {
  const item = normalizePatent(record);
  const en = lang === 'en';
  const granted = item.status === 'granted';
  const date = granted ? item.registrationDate : item.applicationDate;
  const meta = [
    [en ? 'Applicant / Assignee' : '출원인 / 권리자', patentText(item, 'applicant', lang)],
    [en ? 'Application no.' : '출원번호', item.applicationNumber],
    [en ? 'Filed on' : '출원일', item.applicationDate],
    ...(granted ? [[en ? 'Registration no.' : '등록번호', item.registrationNumber], [en ? 'Granted on' : '등록일', item.registrationDate]] : [])
  ].filter(([, value]) => value);
  const description = patentText(item, 'description', lang);
  const url = safePatentUrl(item.url);
  return `<article class="publication-card patent-card reveal">
    <div class="publication-head-row"><div class="publication-topline">
      ${date ? `<span class="year-pill">${escapeHTML(date.slice(0, 7).replace('-', '.'))}</span>` : ''}
      <span class="status-pill ${granted ? 'patent-status--granted' : ''}">${escapeHTML(patentStatusLabel(item.status, lang))}</span>
      ${patentText(item, 'country', lang) ? `<span class="year-pill">${escapeHTML(patentText(item, 'country', lang))}</span>` : ''}
    </div></div>
    <h3>${escapeHTML(patentText(item, 'title', lang))}</h3>
    <div class="publication-meta-row">
      <p class="publication-authors"><span class="patent-inventor-label">${en ? 'Inventors' : '발명자'}</span> <span data-patent-inventor-names="${escapeHTML(item.id)}">${escapeHTML(patentInventorDisplay(item, state.members, lang))}</span></p>
      ${url ? `<a class="publication-doi-link patent-source-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${en ? 'View patent' : '특허 원문'}</a>` : ''}
    </div>
    ${meta.length || description ? `<details class="publication-abstract patent-record-details" data-patent-details="${escapeHTML(item.id)}">
      <summary><span class="publication-abstract__label">${en ? 'Patent details' : '특허 상세 정보'}</span><span class="publication-abstract__icon" aria-hidden="true">▾</span></summary>
      <div class="publication-abstract__content">
        <dl class="patent-details">${meta.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
        ${description ? `<div class="patent-record-summary"><h4>${en ? 'Summary' : '요약'}</h4><p class="muted">${escapeHTML(description)}</p></div>` : ''}
      </div>
    </details>` : ''}
    ${renderPatentInventorDetails(item)}
  </article>`;
}

function renderPatents() {
  const en = lang === 'en';
  const container = qs('#patent-accordion');
  const statGrid = qs('#patent-stat-grid');
  if (!container || !statGrid) return;
  const stats = [
    { value: state.patents.length, label: en ? 'Total patents' : '전체 특허' },
    { value: state.patents.filter((item) => item.status === 'granted').length, label: en ? 'Granted' : '등록 특허' },
    { value: state.patents.filter((item) => item.status === 'pending').length, label: en ? 'Filed' : '출원 특허' }
  ];
  statGrid.innerHTML = stats.map((item) => `<article class="stat-card reveal"><strong>${state.loadingPatents || state.patentsError ? '—' : item.value}</strong><span>${escapeHTML(item.label)}</span></article>`).join('');
  if (state.loadingPatents) { container.innerHTML = publicationListSkeleton(2); return; }
  if (state.patentsError) {
    container.innerHTML = emptyState(en ? 'Patents could not be loaded. Please reload this page to try again.' : '특허 정보를 불러오지 못했습니다. 페이지를 새로고침해 다시 시도해주세요.');
    return;
  }
  const filtered = filteredPublicPatents();
  qs('#patent-results').textContent = en ? `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}` : `${filtered.length}건`;
  if (!filtered.length) {
    container.innerHTML = emptyState(state.patents.length
      ? (en ? 'No patents match your search or filter.' : '검색 조건에 맞는 특허가 없습니다.')
      : (en ? 'No patents have been added yet.' : '아직 등록된 특허가 없습니다.'));
    return;
  }
  const groups = Object.entries(groupBy(filtered, (item) => item.year || (en ? 'Unspecified' : '미정')))
    .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
  const yearStates = new Map(qsa('[data-accordion-key]', container)
    .map((article) => [article.dataset.accordionKey, article.classList.contains('is-open')]));
  const opened = new Set(qsa('[data-patent-contributors][open], [data-patent-details][open]', container)
    .map((details) => `${details.hasAttribute('data-patent-contributors') ? 'inventors' : 'details'}:${details.dataset.patentContributors || details.dataset.patentDetails}`));
  container.innerHTML = groups.map(([year, items], index) => accordionMarkup(year, items.length,
    `<div class="publication-list">${items.map(patentCard).join('')}</div>`,
    Boolean(state.patentQuery) || (yearStates.get(`patent-${year}`) ?? index === 0), `patent-${year}`)).join('');
  qsa('[data-patent-contributors], [data-patent-details]', container).forEach((details) => {
    const key = `${details.hasAttribute('data-patent-contributors') ? 'inventors' : 'details'}:${details.dataset.patentContributors || details.dataset.patentDetails}`;
    details.open = opened.has(key);
  });
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
  qs('#patent-search')?.addEventListener('input', (event) => {
    state.patentQuery = event.currentTarget.value;
    renderPage();
  });
  qsa('[data-patent-status]').forEach(button => button.addEventListener('click', () => {
    state.patentFilter = button.dataset.patentStatus;
    qsa('[data-patent-status]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    renderPage();
  }));
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
  if (page === 'members') {
    if (useLiveData && (!resolvedCollections.has('members') || !state.members.length)) { target.textContent = ''; return; }
    source = lastUpdated(state.members, BUILD_DATE);
  }
  if (page === 'projects') source = lastUpdated(state.projects, BUILD_DATE);
  if (page === 'publications') source = lastUpdated(state.publications, BUILD_DATE);
  if (page === 'patents') {
    if (!state.patents.length || state.patentsError) { target.textContent = ''; return; }
    source = lastUpdated(state.patents, BUILD_DATE);
  }
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
    if (member.track && member.track !== 'none') chips.push({ text: memberTrackLabel(member.track, lang) });
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

function memberPreview(member, alumni = false) {
  const name = memberDisplayName(member);
  const interest = !alumni && member.group === 'researchProfessor' ? localizedMemberText(member, 'researchInterest') : '';
  const chips = alumni
    ? [member.graduationYear, alumniCourseLabel(member, lang)].filter(Boolean).map(text => `<span class="member-chip">${escapeHTML(text)}</span>`).join('')
    : memberMetaChips(member);
  const photo = portraitMarkup({ source: member.photoUrl, name, initialsName: memberDisplayName(member, 'en') || name, root });
  return `<article class="member-card${alumni ? ' member-card--alumni' : ''} reveal" data-member-id="${escapeHTML(member.id)}">
    <div class="profile-avatar"><button type="button" class="member-thumb" data-member-id="${escapeHTML(member.id)}" aria-label="${escapeHTML(name)} ${lang === 'en' ? 'details' : '상세 보기'}">${photo}</button></div>
    <div class="member-preview-identity"><h3>${escapeHTML(name)}</h3>${chips ? `<div class="member-chip-row">${chips}</div>` : ''}${alumni && localizedMemberText(member, 'currentPosition') ? `<p class="muted">${escapeHTML(localizedMemberText(member, 'currentPosition'))}</p>` : ''}</div>
    ${interest ? `<div class="member-card-interest"><h4>${escapeHTML(copy.interest)}</h4><p>${escapeHTML(interest)}</p></div>` : ''}
  </article>`;
}

function memberCard(member) { return memberPreview(member); }
function alumniCard(member) { return memberPreview(member, true); }

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
  if (['other', 'notice', 'misc', 'article', 'articles'].includes(key)) return 'other';
  return key || 'other';
}

function boardFilterConfig() {
  return lang === 'en'
    ? [['all', 'All'], ['other', 'Articles'], ['conference', 'Conference'], ['workshop', 'Workshop'], ['equipment', 'Lab equipment list']]
    : [['all', '전체'], ['other', '기사'], ['conference', '학회'], ['workshop', '워크숍'], ['equipment', '실험실 장비 목록']];
}

function boardCategoryLabel(category = '') {
  const map = {
    conference: lang === 'en' ? 'Conference' : '학회',
    poster: lang === 'en' ? 'Conference' : '학회',
    oral: lang === 'en' ? 'Conference' : '학회',
    workshop: lang === 'en' ? 'Workshop' : '워크숍',
    equipment: lang === 'en' ? 'Lab equipment list' : '실험실 장비 목록',
    news: lang === 'en' ? 'Lab equipment list' : '실험실 장비 목록',
    notice: lang === 'en' ? 'Articles' : '기사',
    other: lang === 'en' ? 'Articles' : '기사'
  };
  return map[normalizeBoardCategory(category)] || (lang === 'en' ? 'Articles' : '기사');
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

function accordionMarkup(title, count, content, open = false, key = '') {
  accordionId += 1;
  const triggerId = `accordion-trigger-${accordionId}`;
  const panelId = `accordion-panel-${accordionId}`;
  return `
    <article class="accordion${open ? ' is-open' : ''}"${key ? ` data-accordion-key="${escapeHTML(key)}"` : ''}>
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
