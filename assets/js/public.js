import { BUILD_DATE, SITE_COPY, FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS, FALLBACK_BOARD_POSTS } from './data.js';
import {
  escapeHTML,
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
  formatEnglishName
} from './utils.js';
import { hasFirebaseConfig, fetchCollection, listenCollection, COLLECTIONS } from './firebase.js';

const body = document.body;
const page = body.dataset.page;
const lang = body.dataset.lang || 'kr';
const root = body.dataset.root || '.';
const copy = SITE_COPY[lang];

const qs = (selector) => document.querySelector(selector);
const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

function firstFilled(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
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

const state = {
  members: sortMembers(FALLBACK_MEMBERS).filter(isActiveItem),
  projects: sortProjects(FALLBACK_PROJECTS).filter(isActiveItem),
  publications: sortPublications(FALLBACK_PUBLICATIONS).filter(isActiveItem),
  board: sortBoardPosts(FALLBACK_BOARD_POSTS).filter(isActiveItem),
  publicationQuery: '',
  boardTab: 'news',
  unsubs: []
};

const modalState = {
  root: null,
  title: null,
  body: null,
  closeButtons: []
};

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
  const lines = memberExperienceEntries(member).map((entry) => {
    const detail = localizedExperienceDetail(entry, locale);
    return [String(entry.period || '').trim(), detail].filter(Boolean).join(' | ');
  }).filter(Boolean);
  if (!lines.length) return '';
  return `<div class="member-experience-lines member-experience-lines--${escapeHTML(variant)}">${lines.map((line) => `<p>${escapeHTML(line)}</p>`).join('')}</div>`;
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

function memberEducationLines(member = {}, locale = lang) {
  const degreeLabels = locale === 'en'
    ? { bs: 'B.S.', ms: 'M.S.', phd: 'Ph.D.' }
    : { bs: '학사', ms: '석사', phd: '박사' };
  const specs = [
    ['bs', memberEducationValue(member, 'bachelorsSchool', locale), memberEducationValue(member, 'bachelorsMajor', locale)],
    ['ms', memberEducationValue(member, 'mastersSchool', locale), memberEducationValue(member, 'mastersMajor', locale)],
    ['phd', memberEducationValue(member, 'doctoralSchool', locale), memberEducationValue(member, 'doctoralMajor', locale)]
  ];
  const lines = specs
    .filter(([, school, major]) => String(school || '').trim() || String(major || '').trim())
    .map(([key, school, major]) => [degreeLabels[key], school, major].filter(Boolean).join(' · '));
  if (lines.length) return lines;
  return String((locale === 'en' ? (member.educationEn || member.education) : (member.educationKr || member.education)) || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function memberEducationMarkup(member = {}, locale = lang, variant = 'detail') {
  const lines = memberEducationLines(member, locale);
  if (!lines.length) return '';
  return `<div class="member-education-lines member-education-lines--${escapeHTML(variant)}">${lines.map((line) => `<p>${escapeHTML(line)}</p>`).join('')}</div>`;
}

function memberCourseScheduleEntries(member = {}) {
  return (Array.isArray(member.courseSchedule) ? member.courseSchedule : []).filter((entry) => {
    return ['day', 'time', 'courseName', 'credits', 'description'].some((key) => String(entry?.[key] || '').trim());
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
  const note = member.group === 'pi' ? String(member.coursesInfo || '').trim() : '';
  const html = [table, note ? `<p class="detail-note">${multilineText(note)}</p>` : ''].filter(Boolean).join('');
  return html ? detailHtmlSection(title, html) : '';
}

document.addEventListener('DOMContentLoaded', async () => {
  setupHeader();
  ensureModal();
  setupRevealAnimations();
  setupSearch();
  if (page === 'home') setupHeroSlider();
  await hydrate();
  renderPage();
});

async function hydrate() {
  if (!hasFirebaseConfig) return;
  const readSafely = async (collectionName) => {
    try {
      return await fetchCollection(collectionName);
    } catch (error) {
      console.warn(`${collectionName} 컬렉션을 불러오지 못했습니다.`, error);
      return [];
    }
  };

  const members = await readSafely(COLLECTIONS.members);
  const projects = await readSafely(COLLECTIONS.projects);
  const publications = await readSafely(COLLECTIONS.publications);
  const board = COLLECTIONS.board ? await readSafely(COLLECTIONS.board) : [];

  state.members = sortMembers(mergeMembers(FALLBACK_MEMBERS, members)).filter(isActiveItem);
  state.projects = sortProjects(mergeProjects(FALLBACK_PROJECTS, projects)).filter(isActiveItem);
  state.publications = sortPublications(mergePublications(FALLBACK_PUBLICATIONS, publications)).filter(isActiveItem);
  state.board = sortBoardPosts(mergeBoardPosts(FALLBACK_BOARD_POSTS, board)).filter(isActiveItem);

  state.unsubs.forEach((unsub) => { try { unsub(); } catch {} });
  state.unsubs = [];
  const addListener = (collectionName, onItems) => {
    try {
      state.unsubs.push(listenCollection(collectionName, onItems, (error) => console.warn(`${collectionName} 실시간 동기화 실패`, error)));
    } catch (error) {
      console.warn(`${collectionName} 리스너 연결 실패`, error);
    }
  };

  addListener(COLLECTIONS.members, (items) => {
    state.members = sortMembers(mergeMembers(FALLBACK_MEMBERS, items)).filter(isActiveItem);
    if (page === 'home' || page === 'members') renderPage();
  });
  addListener(COLLECTIONS.projects, (items) => {
    state.projects = sortProjects(mergeProjects(FALLBACK_PROJECTS, items)).filter(isActiveItem);
    if (page === 'home' || page === 'projects') renderPage();
  });
  addListener(COLLECTIONS.publications, (items) => {
    state.publications = sortPublications(mergePublications(FALLBACK_PUBLICATIONS, items)).filter(isActiveItem);
    if (page === 'home' || page === 'publications') renderPage();
  });
  if (COLLECTIONS.board) {
    addListener(COLLECTIONS.board, (items) => {
      state.board = sortBoardPosts(mergeBoardPosts(FALLBACK_BOARD_POSTS, items)).filter(isActiveItem);
      if (page === 'board') renderPage();
    });
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderPage();
});

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

function setupHeader() {
  const toggle = qs('[data-menu-toggle]');
  const panel = qs('[data-nav-panel]');
  const header = qs('.site-header');
  qs(`.site-nav a[data-nav-page="${page}"]`)?.classList.add('is-active');

  toggle?.addEventListener('click', () => {
    const isOpen = panel?.classList.toggle('is-open');
    toggle.classList.toggle('is-open', Boolean(isOpen));
    toggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
  });

  qsa('.site-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      panel?.classList.remove('is-open');
      toggle?.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
    });
  });

  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 16);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

function ensureModal() {
  if (modalState.root) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'site-modal';
  wrapper.hidden = true;
  wrapper.innerHTML = `
    <div class="site-modal__backdrop" data-modal-close></div>
    <div class="site-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="site-modal-title">
      <button type="button" class="site-modal__close" data-modal-close aria-label="close">×</button>
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
  modalState.closeButtons.forEach((button) => button.addEventListener('click', closeModal));
  wrapper.addEventListener('click', (event) => {
    if (event.target === wrapper) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !wrapper.hidden) closeModal();
  });
}

function openModal(title, html) {
  ensureModal();
  modalState.title.textContent = title;
  modalState.body.innerHTML = html;
  modalState.root.hidden = false;
  document.body.classList.add('modal-open');
  bindInteractiveCards();
}

function closeModal() {
  if (!modalState.root) return;
  modalState.root.hidden = true;
  modalState.body.innerHTML = '';
  document.body.classList.remove('modal-open');
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
        open();
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
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

function openMemberModal(member) {
  const chips = [];
  if (member.group !== 'alumni') chips.push(member.group === 'pi' ? copy.pi : (member.group === 'researchProfessor' ? copy.researchProfessor : member.group === 'studentResearcher' ? copy.studentResearcherSection : copy.graduateStudent));
  if (member.group === 'graduateStudent') {
    chips.push(memberCourseLabel(member.course, lang));
    if (member.track && member.track !== 'none') chips.push(memberTrackLabel(member.track, lang));
  }
  if (member.group === 'studentResearcher') chips.push(memberCourseLabel('undergrad', lang));
  if (member.status === 'alumni') chips.push(`${copy.alumniSection}${member.graduationYear ? ` · ${member.graduationYear}` : ''}`);
  const yearLabel = memberYearLabel(member, lang);
  if (yearLabel) chips.push(yearLabel);
  const displayName = memberDisplayName(member);
  const title = displayName;
  const photo = member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}">` : `<div class="modal-avatar__placeholder">${escapeHTML(getInitials(memberDisplayName(member, 'en') || memberDisplayName(member) || member.name))}</div>`;
  const currentLabel = copy.currentPosition;
  const relatedProjectSection = renderMemberProjectBlock(member);
  openModal(title, `
    <div class="detail-modal detail-modal--member">
      <div class="detail-modal__hero">
        <div class="detail-modal__media">${photo}</div>
        <div class="detail-modal__summary">
          <div class="member-chip-row">${chips.map((chip) => `<span class="member-chip member-chip--soft">${escapeHTML(chip)}</span>`).join('')}</div>
          <h3>${escapeHTML(displayName)}</h3>
          ${localizedMemberText(member, 'bio') ? `<p class="detail-lead">${escapeHTML(localizedMemberText(member, 'bio'))}</p>` : ''}
          ${member.email ? `<a class="member-link" href="mailto:${escapeHTML(member.email)}">${escapeHTML(member.email)}</a>` : ''}
        </div>
      </div>
      <div class="detail-grid">
        ${detailHtmlSection(copy.education, memberEducationMarkup(member, lang, 'detail'))}
        ${memberExperienceMarkup(member, lang, 'detail') ? detailHtmlSection(copy.experience, memberExperienceMarkup(member, lang, 'detail')) : detailSection(copy.experience, localizedMemberText(member, 'experience'))}
        ${detailSection(copy.interest, localizedMemberText(member, 'researchInterest'))}
        ${detailSection(currentLabel, localizedMemberText(member, 'currentPosition'))}
        ${memberCourseSectionMarkup(member, lang)}
        ${relatedProjectSection}
        ${renderMemberPublicationBlock(member)}
      </div>
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
  const media = youtube
    ? `<div class="detail-figure detail-figure--16-9 detail-figure--video"><iframe src="${escapeHTML(youtube)}" title="${escapeHTML(post.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : (post.imageUrl ? `<div class="detail-figure detail-figure--16-9"><img src="${escapeHTML(rootAsset(post.imageUrl, root))}" alt="${escapeHTML(post.title)}"></div>` : '');
  openModal(post.title, `
    <div class="detail-modal detail-modal--board">
      <div class="member-chip-row">
        <span class="member-chip member-chip--soft">${escapeHTML(tag)}</span>
        ${post.date ? `<span class="member-chip member-chip--soft">${escapeHTML(post.date)}</span>` : ''}
      </div>
      ${media}
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
  return detailHtmlSection(sectionTitle, `<div class="linked-card-grid linked-card-grid--projects">${cards}</div>`);
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
  const groups = Object.entries(groupBy(sorted, (item) => item.year || (lang === 'en' ? 'Unspecified' : '미정')))
    .sort((a, b) => yearSort(b[0]) - yearSort(a[0]) || String(a[0]).localeCompare(String(b[0]), 'en', { sensitivity: 'base' }))
    .map(([year, items]) => `
      <section class="member-publication-year-group">
        <div class="member-publication-year-heading">${escapeHTML(year)}</div>
        <div class="member-publication-list">
          ${items.map((item) => {
            const meta = [publicationYearMonthLabel(item), item.journal].filter(Boolean).join(' · ');
            const roles = Array.isArray(item.roles) ? item.roles : [];
            const linkLabel = item.doi ? copy.doi : copy.open;
            return `
              <article class="member-publication-item">
                <div class="member-publication-main">
                  <strong>${escapeHTML(item.title)}</strong>
                  ${meta ? `<div class="member-publication-meta">${escapeHTML(meta)}</div>` : ''}
                </div>
                ${roles.length ? `<div class="member-publication-roles">${roles.map((role) => `<span class="member-publication-role">${escapeHTML(publicationRoleLabel(role, lang))}</span>`).join('')}</div>` : ''}
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
      <div class="detail-block__body">${groups}</div>
    </article>
  `;
}

function setupRevealAnimations() {
  if (!setupRevealAnimations.observer) {
    setupRevealAnimations.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-visible', entry.isIntersecting);
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
  if (!setupCountAnimations.observer) {
    setupCountAnimations.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target;
          const target = Number(el.dataset.target || '0');
          if (entry.isIntersecting) {
            if (el.dataset.counting === 'true') return;
            el.dataset.counting = 'true';
            animateCount(el, target);
          } else {
            el.dataset.counting = 'false';
            el.textContent = '0';
          }
        });
      },
      { threshold: 0.25 }
    );
  }
  qsa('.count-up').forEach((item) => {
    item.textContent = '0';
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
  slides.forEach((slide, order) => {
    slide.style.backgroundImage = `url('${focusImages[order % focusImages.length]}')`;
    slide.classList.toggle('is-active', order === 0);
  });
  window.setInterval(() => {
    slides[index].classList.remove('is-active');
    index = (index + 1) % slides.length;
    slides[index].classList.add('is-active');
  }, 5200);
}

function renderHome() {
  const activeMembers = state.members.filter((item) => item.status !== 'alumni').length;
  const alumniCount = state.members.filter((item) => item.status === 'alumni').length;
  const ongoingCount = state.projects.filter((item) => item.status === 'ongoing').length;
  const publicationCount = state.publications.length;

  const heroStat = qs('#hero-stat-grid');
  if (heroStat) {
    heroStat.innerHTML = [
      { value: activeMembers, label: copy.stats.current },
      { value: alumniCount, label: copy.stats.alumni },
      { value: ongoingCount, label: copy.stats.ongoing },
      { value: publicationCount, label: copy.stats.publications }
    ].map((item) => `
      <article class="stat-card reveal">
        <strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong>
        <span>${escapeHTML(item.label)}</span>
      </article>
    `).join('');
  }

  const focusGrid = qs('#focus-grid');
  if (focusGrid) {
    focusGrid.innerHTML = copy.focusCards.map((item, index) => `
      <article class="focus-card reveal">
        <div class="focus-card-media"><img src="${escapeHTML(focusImages[index])}" alt="${escapeHTML(item.label)}"></div>
        <div class="focus-card-copy">
          <span>${escapeHTML(item.label)}</span>
          <strong>${escapeHTML(item.title)}</strong>
          <p>${escapeHTML(item.desc)}</p>
        </div>
      </article>
    `).join('');
  }

  const ongoingPreview = state.projects.filter((item) => item.status === 'ongoing').slice(0, 4);
  const previewGrid = qs('#ongoing-preview-grid');
  if (previewGrid) {
    previewGrid.dataset.count = String(ongoingPreview.length || 0);
    previewGrid.innerHTML = ongoingPreview.map((project) => projectCard(project, { compact: true })).join('');
    stretchProjectGrid(previewGrid);
  }
}

function renderMembers() {
  const members = state.members;
  const pi = members.find((item) => item.group === 'pi' && item.status !== 'alumni');
  const researchProfessors = members.filter((item) => item.group === 'researchProfessor' && item.status !== 'alumni');
  const graduateStudents = members.filter((item) => item.group === 'graduateStudent' && item.status !== 'alumni');
  const undergrads = members.filter((item) => item.group === 'studentResearcher' && item.status !== 'alumni');
  const alumni = members.filter((item) => item.status === 'alumni');

  const pageStats = qs('#page-stat-grid');
  if (pageStats) {
    pageStats.innerHTML = [
      { value: members.filter((item) => item.status !== 'alumni').length, label: copy.stats.current },
      { value: alumni.length, label: copy.stats.alumni },
      { value: researchProfessors.length, label: copy.researchProfessor },
      { value: graduateStudents.length, label: copy.graduateStudent }
    ].map((item) => `
      <article class="stat-card reveal">
        <strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong>
        <span>${escapeHTML(item.label)}</span>
      </article>
    `).join('');
  }

  const piCard = qs('#pi-card');
  if (piCard) {
    if (!pi) {
      piCard.innerHTML = emptyState(copy.noMembers);
    } else {
      piCard.innerHTML = `
        <div class="pi-card-layout">
          <button type="button" class="pi-photo pi-photo-button" data-member-id="${escapeHTML(pi.id)}">
            ${pi.photoUrl ? `<img src="${escapeHTML(rootAsset(pi.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(pi))}">` : `<span>${escapeHTML(getInitials(memberDisplayName(pi, 'en') || pi.name))}</span>`}
          </button>
          <div class="pi-card-main">
            <div class="pi-card-head">
              <span class="eyebrow">${escapeHTML(copy.pi)}</span>
              <div class="pi-name-row"><h2>${escapeHTML(memberDisplayName(pi))}</h2>${memberYearLabel(pi, lang) ? `<span class="member-chip member-chip--soft">${escapeHTML(memberYearLabel(pi, lang))}</span>` : ''}</div>
              <p class="pi-title">${escapeHTML(localizedMemberText(pi, 'bio') || (lang === 'en' ? 'Professor, Chungnam National University' : '충남대학교 교수'))}</p>
              <div class="pi-head-actions"><button type="button" class="button secondary detail-open-button" data-member-id="${escapeHTML(pi.id)}">${lang === 'en' ? 'View profile' : '상세 보기'}</button></div>
            </div>
            <div class="pi-card-grid">
              <article><h3>${escapeHTML(copy.education)}</h3>${memberEducationMarkup(pi, lang, 'panel')}</article>
              <article><h3>${escapeHTML(copy.experience)}</h3>${memberExperienceMarkup(pi, lang, 'panel') || `<p>${multilineText(localizedMemberText(pi, 'experience') || '')}</p>`}</article>
              <article><h3>${escapeHTML(copy.interest)}</h3><p>${multilineText(localizedMemberText(pi, 'researchInterest') || '')}</p></article>
              <article><h3>${escapeHTML(copy.contact)}</h3><p>${pi.email ? `<a class="member-link" href="mailto:${escapeHTML(pi.email)}">${escapeHTML(pi.email)}</a>` : ''}</p></article>
              ${memberCourseScheduleEntries(pi).length ? `<article class="pi-card-grid__full"><h3>${escapeHTML(lang === 'en' ? 'Course schedule' : '수업 시간표')}</h3>${memberCourseScheduleMarkup(pi, lang)}</article>` : ''}
            </div>
          </div>
        </div>
      `;
    }
  }

  const researchList = qs('#research-professor-list');
  if (researchList) {
    researchList.innerHTML = researchProfessors.length
      ? `<div class="member-grid member-grid--wide">${researchProfessors.map((item) => memberCard(item)).join('')}</div>`
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
      const content = section.items.length ? `<div class="member-grid">${section.items.map((item) => memberCard(item)).join('')}</div>` : emptyState(copy.noMembers);
      return accordionMarkup(section.title, section.items.length, content, index === 0);
    }).join('');
  }

  const researcherAccordion = qs('#student-researcher-accordion');
  if (researcherAccordion) {
    researcherAccordion.innerHTML = undergrads.length ? accordionMarkup(
      copy.studentResearcherSection,
      undergrads.length,
      `<div class="member-grid member-grid--wide">${undergrads.map((item) => memberCard(item)).join('')}</div>`,
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
      `<div class="member-grid member-grid--alumni">${items.map((item) => alumniCard(item)).join('')}</div>`,
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
    statGrid.innerHTML = [
      { value: ongoing.length, label: lang === 'en' ? 'Ongoing projects' : '진행 중 과제' },
      { value: completed.length, label: lang === 'en' ? 'Archived projects' : '종료 과제' }
    ].map((item) => `<article class="stat-card reveal"><strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong><span>${escapeHTML(item.label)}</span></article>`).join('');
  }

  const ongoingGrid = qs('#ongoing-project-grid');
  if (ongoingGrid) {
    ongoingGrid.innerHTML = ongoing.map((project) => projectCard(project)).join('');
    stretchProjectGrid(ongoingGrid);
  }

  const completedAccordion = qs('#completed-project-accordion');
  if (completedAccordion) {
    const completedByYear = Object.entries(groupBy(completed, (item) => item.year || extractYearFromText(item.period) || (lang === 'en' ? 'Unspecified' : '미정')))
      .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
    completedAccordion.innerHTML = completedByYear.map(([year, items], index) => accordionMarkup(year, items.length, `<div class="archive-list">${items.map((item) => archiveProjectItem(item)).join('')}</div>`, index === 0)).join('');
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
    const signature = stats.map((item) => `${item.label}:${item.value}`).join('|');
    if (statGrid.dataset.signature !== signature) {
      statGrid.dataset.signature = signature;
      statGrid.innerHTML = stats.map((item) => `<article class="stat-card reveal"><strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong><span>${escapeHTML(item.label)}</span></article>`).join('');
    }
  }

  const publicationAccordion = qs('#publication-accordion');
  if (publicationAccordion) {
    const grouped = Object.entries(groupBy(filtered, (item) => item.year || (lang === 'en' ? 'Unspecified' : '미정')))
      .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
    publicationAccordion.innerHTML = grouped.map(([year, items], index) => accordionMarkup(year, items.length, `<div class="publication-list">${items.map((item) => publicationCard(item)).join('')}</div>`, index === 0)).join('');
  }
}

function renderBoard() {
  const noticePosts = state.board.filter((item) => ['notice', 'news'].includes(item.category));
  const presentationPosts = state.board.filter((item) => ['poster', 'oral'].includes(item.category));
  const summary = qs('#board-summary');
  if (summary) summary.textContent = lang === 'en' ? `${state.board.length} news items` : `소식 ${state.board.length}건`;
  const newsTab = qs('[data-board-tab="news"]');
  const presentationTab = qs('[data-board-tab="presentations"]');
  const grid = qs('#board-tab-grid');
  const tabCount = qs('#board-tab-count');
  const tabTitle = qs('#board-tab-title');
  const tabEyebrow = qs('#board-tab-eyebrow');
  const isNews = state.boardTab !== 'presentations';
  newsTab?.classList.toggle('is-active', isNews);
  presentationTab?.classList.toggle('is-active', !isNews);
  const activePosts = isNews ? noticePosts : presentationPosts;
  if (tabCount) tabCount.textContent = lang === 'en' ? `${activePosts.length} items` : `${activePosts.length}건`;
  if (tabTitle) tabTitle.textContent = isNews ? (lang === 'en' ? 'Lab news · notices' : '연구실 공지 · 소식') : (lang === 'en' ? 'Conference presentations' : '학회 발표');
  if (tabEyebrow) tabEyebrow.textContent = lang === 'en' ? '' : (isNews ? '소식' : '학회 발표');
  if (grid) grid.innerHTML = activePosts.length ? activePosts.map((post) => boardCard(post)).join('') : emptyState(isNews ? (lang === 'en' ? 'No notices or news yet.' : '공지와 소식이 아직 없습니다.') : (lang === 'en' ? 'No presentation items yet.' : '학회 발표 자료가 아직 없습니다.'));
  qsa('[data-board-tab]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      state.boardTab = button.dataset.boardTab;
      renderBoard();
      setupRevealAnimations();
      bindInteractiveCards();
    });
  });
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
  if (!name) return '';
  const manual = {
    'the korean society for bio-environment control': 'journal-pill--tone-red',
    'journal of bio-environment control': 'journal-pill--tone-red',
    'horticultural science and technology': 'journal-pill--tone-purple',
    'frontiers in plant science': 'journal-pill--tone-blue',
    'plants': 'journal-pill--tone-green',
    'agronomy': 'journal-pill--tone-amber',
    'horticulturae': 'journal-pill--tone-teal',
    'horticulture, environment, and biotechnology': 'journal-pill--tone-violet',
    'ozone: science & engineering': 'journal-pill--tone-sky',
    'australian journal of crop science': 'journal-pill--tone-orange'
  };
  return manual[name] || 'journal-pill--tone-neutral';
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
  if (member.group === 'graduateStudent') {
    if (member.course) chips.push(memberCourseLabel(member.course, lang));
    if (member.track && member.track !== 'none') chips.push(memberTrackLabel(member.track, lang));
  }
  if (member.group === 'studentResearcher') chips.push(memberCourseLabel('undergrad', lang));
  const years = memberYearLabel(member, lang);
  if (years) chips.push(years);
  return chips.map((chip) => `<span class="member-chip member-chip--soft">${escapeHTML(chip)}</span>`).join('');
}

function memberCard(member) {
  const education = memberEducationMarkup(member, lang, 'compact');
  return `
    <article class="member-card reveal interactive-card" data-member-id="${escapeHTML(member.id)}" tabindex="0" role="button" aria-label="${escapeHTML(memberDisplayName(member))}">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}">` : `<span>${escapeHTML(getInitials(memberDisplayName(member, 'en') || memberDisplayName(member) || member.name))}</span>`}
      </div>
      <div class="member-copy">
        ${memberMetaChips(member) ? `<div class="member-chip-row">${memberMetaChips(member)}</div>` : ''}
        <h3>${escapeHTML(memberDisplayName(member))}</h3>
        ${education || ''}
        ${member.email ? `<a class="member-link" href="mailto:${escapeHTML(member.email)}">${escapeHTML(member.email)}</a>` : ''}
      </div>
    </article>
  `;
}


function alumniCard(member) {
  const education = memberEducationMarkup(member, lang, 'compact');
  return `
    <article class="member-card member-card--alumni reveal interactive-card" data-member-id="${escapeHTML(member.id)}" tabindex="0" role="button" aria-label="${escapeHTML(memberDisplayName(member))}">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}">` : `<span>${escapeHTML(getInitials(memberDisplayName(member, 'en') || memberDisplayName(member) || member.name))}</span>`}
      </div>
      <div class="member-copy">
        <div class="member-chip-row"><span class="member-chip">${escapeHTML(member.graduationYear || '')}</span></div>
        <h3>${escapeHTML(memberDisplayName(member))}</h3>
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
      ${item.abstract ? `<p class="muted">${escapeHTML(item.abstract)}</p>` : ''}
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

function boardCategoryLabel(category = '') {
  const map = {
    notice: lang === 'en' ? 'Notice' : '공지',
    poster: lang === 'en' ? 'Poster' : '포스터 발표',
    oral: lang === 'en' ? 'Oral' : '구두 발표',
    news: lang === 'en' ? 'News' : '소식'
  };
  return map[category] || (lang === 'en' ? 'Board' : '게시판');
}

function boardCard(post) {
  const youtube = youtubeEmbedUrl(post.youtubeUrl || '');
  const media = youtube
    ? `<div class="board-card__media board-card__media--video"><iframe src="${escapeHTML(youtube)}" title="${escapeHTML(post.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : (post.imageUrl ? `<div class="board-card__media"><img src="${escapeHTML(rootAsset(post.imageUrl, root))}" alt="${escapeHTML(post.title)}"></div>` : '');
  return `
    <article class="board-card reveal interactive-card" data-board-id="${escapeHTML(post.id)}">
      ${media}
      <div class="board-card__copy">
        <div class="member-chip-row">
          <span class="member-chip member-chip--soft">${escapeHTML(boardCategoryLabel(post.category))}</span>
          ${post.date ? `<span class="member-chip member-chip--soft">${escapeHTML(post.date)}</span>` : ''}
        </div>
        <h3>${escapeHTML(post.title)}</h3>
        ${post.description ? `<p>${escapeHTML(post.description)}</p>` : ''}
        ${post.linkUrl ? `<a class="member-link" href="${escapeHTML(post.linkUrl)}" target="_blank" rel="noreferrer">${lang === 'en' ? 'Open link' : '링크 열기'}</a>` : ''}
      </div>
    </article>
  `;
}

function accordionMarkup(title, count, content, open = false) {
  return `
    <article class="accordion${open ? ' is-open' : ''}">
      <button class="accordion-trigger" type="button" aria-expanded="${open ? 'true' : 'false'}">
        <span class="accordion-copy">
          <span>${escapeHTML(title)}</span>
          <span class="accordion-meta">${escapeHTML(count)} ${escapeHTML(copy.countItems)}</span>
        </span>
        <span class="accordion-icon" aria-hidden="true">${open ? '−' : '+'}</span>
      </button>
      <div class="accordion-panel" ${open ? '' : 'hidden'}>
        ${content}
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
      panel.hidden = !isOpen;
      button.setAttribute('aria-expanded', String(isOpen));
      const icon = button.querySelector('.accordion-icon');
      if (icon) icon.textContent = isOpen ? '−' : '+';
    });
  });
}
