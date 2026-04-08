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
  publicationIndexingLabel
} from './utils.js';
import { hasFirebaseConfig, fetchCollection, listenCollection, COLLECTIONS } from './firebase.js';

const body = document.body;
const page = body.dataset.page;
const lang = body.dataset.lang || 'kr';
const root = body.dataset.root || '.';
const copy = SITE_COPY[lang];

const qs = (selector) => document.querySelector(selector);
const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const focusImages = [
  'assets/images/background/hero-1.jpg',
  'assets/images/background/hero-2.jpg',
  'assets/images/background/hero-3.jpg'
].map((path) => rootAsset(path, root));

const state = {
  members: sortMembers(FALLBACK_MEMBERS),
  projects: sortProjects(FALLBACK_PROJECTS),
  publications: sortPublications(FALLBACK_PUBLICATIONS),
  board: sortBoardPosts(FALLBACK_BOARD_POSTS),
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
  return locale === 'en' ? (member.nameEn || member.name || member.nameKr || '') : (member.nameKr || member.name || member.nameEn || '');
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

  state.members = sortMembers(mergeMembers(FALLBACK_MEMBERS, members));
  state.projects = sortProjects(mergeProjects(FALLBACK_PROJECTS, projects));
  state.publications = sortPublications(mergePublications(FALLBACK_PUBLICATIONS, publications));
  state.board = sortBoardPosts(mergeBoardPosts(FALLBACK_BOARD_POSTS, board));

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
    state.members = sortMembers(mergeMembers(FALLBACK_MEMBERS, items));
    if (page === 'home' || page === 'members') renderPage();
  });
  addListener(COLLECTIONS.projects, (items) => {
    state.projects = sortProjects(mergeProjects(FALLBACK_PROJECTS, items));
    if (page === 'home' || page === 'projects') renderPage();
  });
  addListener(COLLECTIONS.publications, (items) => {
    state.publications = sortPublications(mergePublications(FALLBACK_PUBLICATIONS, items));
    if (page === 'home' || page === 'publications') renderPage();
  });
  if (COLLECTIONS.board) {
    addListener(COLLECTIONS.board, (items) => {
      state.board = sortBoardPosts(mergeBoardPosts(FALLBACK_BOARD_POSTS, items));
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
  const photo = member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}">` : `<div class="modal-avatar__placeholder">${escapeHTML(getInitials(member.name))}</div>`;
  const currentLabel = member.status === 'alumni' ? copy.currentPosition : (lang === 'en' ? 'Current role' : '현재 역할');
  const courseSectionTitle = member.group === 'pi' ? (lang === 'en' ? 'Courses' : '수업 정보') : (member.group === 'researchProfessor' ? (lang === 'en' ? 'Related projects' : '관련 과제') : '');
  const courseSectionValue = member.group === 'pi' ? (member.coursesInfo || (lang === 'en' ? 'To be updated by the administrator.' : '관리자에서 수업 정보를 추가할 수 있습니다.')) : (member.group === 'researchProfessor' ? (member.relatedProjects || (lang === 'en' ? 'To be updated by the administrator.' : '관리자에서 관련 과제 정보를 추가할 수 있습니다.')) : '');
  openModal(title, `
    <div class="detail-modal detail-modal--member">
      <div class="detail-modal__hero">
        <div class="detail-modal__media">${photo}</div>
        <div class="detail-modal__summary">
          <div class="member-chip-row">${chips.map((chip) => `<span class="member-chip member-chip--soft">${escapeHTML(chip)}</span>`).join('')}</div>
          <h3>${escapeHTML(displayName)}</h3>
          ${member.bio ? `<p class="detail-lead">${escapeHTML(member.bio)}</p>` : ''}
          ${member.email ? `<a class="member-link" href="mailto:${escapeHTML(member.email)}">${escapeHTML(member.email)}</a>` : ''}
        </div>
      </div>
      <div class="detail-grid">
        ${detailSection(copy.education, member.education)}
        ${detailSection(copy.experience, member.experience)}
        ${detailSection(copy.interest, member.researchInterest)}
        ${detailSection(currentLabel, member.currentPosition || member.bio)}
        ${courseSectionTitle ? detailSection(courseSectionTitle, courseSectionValue) : ''}
        ${detailSection(lang === 'en' ? 'Related publications' : '관련 논문', (Array.isArray(member.publicationLinks) && member.publicationLinks.length) ? member.publicationLinks.map((item) => `${item.title}${Array.isArray(item.roles) && item.roles.length ? ` (${item.roles.map((role) => ({first: lang === 'en' ? 'First author' : '제1저자', co: lang === 'en' ? 'Co-author' : '공동저자', corresponding: lang === 'en' ? 'Corresponding author' : '교신저자'})[role] || role).join(', ')})` : ''}`).join('
') : (member.authorshipNote || (lang === 'en' ? 'No linked publications yet.' : '연결된 논문이 아직 없습니다.')))}
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
        ${detailSection(leadLabel, project.principalInvestigator || (lang === 'en' ? 'Not set' : '미설정'))}
        ${detailSection(lang === 'en' ? 'Keywords' : '키워드', localizedProjectTags(project).join(', '))}
      </div>
    </div>
  `);
}

function openBoardModal(post) {
  const tag = boardCategoryLabel(post.category);
  const media = post.imageUrl ? `<div class="detail-figure detail-figure--16-9"><img src="${escapeHTML(rootAsset(post.imageUrl, root))}" alt="${escapeHTML(post.title)}"></div>` : '';
  openModal(post.title, `
    <div class="detail-modal detail-modal--board">
      <div class="member-chip-row">
        <span class="member-chip member-chip--soft">${escapeHTML(tag)}</span>
        ${post.date ? `<span class="member-chip member-chip--soft">${escapeHTML(post.date)}</span>` : ''}
      </div>
      ${media}
      <p class="detail-lead">${escapeHTML(post.description || '')}</p>
      ${post.linkUrl ? `<p><a class="button primary" href="${escapeHTML(post.linkUrl)}" target="_blank" rel="noreferrer">${lang === 'en' ? 'Open link' : '링크 열기'}</a></p>` : ''}
    </div>
  `);
}

function detailSection(title, value = '') {
  if (!value) return '';
  return `
    <article class="detail-block">
      <h4>${escapeHTML(title)}</h4>
      <p>${escapeHTML(value)}</p>
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

  const ongoingPreview = state.projects.filter((item) => item.status === 'ongoing').slice(0, 3);
  const previewGrid = qs('#ongoing-preview-grid');
  if (previewGrid) previewGrid.innerHTML = ongoingPreview.map((project) => projectCard(project, { compact: true })).join('');
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
            ${pi.photoUrl ? `<img src="${escapeHTML(rootAsset(pi.photoUrl, root))}" alt="${escapeHTML(pi.name)}">` : `<span>${escapeHTML(getInitials(pi.name))}</span>`}
          </button>
          <div class="pi-card-main">
            <div class="pi-card-head">
              <span class="eyebrow">${escapeHTML(copy.pi)}</span>
              <div class="pi-name-row"><h2>${escapeHTML(pi.name)}</h2>${memberYearLabel(pi, lang) ? `<span class="member-chip member-chip--soft">${escapeHTML(memberYearLabel(pi, lang))}</span>` : ''}</div>
              <p class="pi-title">${escapeHTML(pi.bio || (lang === 'en' ? 'Professor, Chungnam National University' : '충남대학교 교수'))}</p>
              <div class="pi-head-actions"><button type="button" class="button secondary detail-open-button" data-member-id="${escapeHTML(pi.id)}">${lang === 'en' ? 'View profile' : '상세 보기'}</button></div>
            </div>
            <div class="pi-card-grid">
              <article><h3>${escapeHTML(copy.education)}</h3><p>${escapeHTML(pi.education || '')}</p></article>
              <article><h3>${escapeHTML(copy.experience)}</h3><p>${escapeHTML(pi.experience || '')}</p></article>
              <article><h3>${escapeHTML(copy.interest)}</h3><p>${escapeHTML(pi.researchInterest || '')}</p></article>
              <article><h3>${escapeHTML(copy.contact)}</h3><p>${pi.email ? `<a class="member-link" href="mailto:${escapeHTML(pi.email)}">${escapeHTML(pi.email)}</a>` : ''}</p></article>
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
    const alumniByYear = Object.entries(groupBy(alumni, (item) => dynamicYearBucket(item.graduationYear)))
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
  if (ongoingGrid) ongoingGrid.innerHTML = ongoing.map((project) => projectCard(project)).join('');

  const completedAccordion = qs('#completed-project-accordion');
  if (completedAccordion) {
    const completedByYear = Object.entries(groupBy(completed, (item) => dynamicYearBucket(item.year || extractYearFromText(item.period))))
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

  const allSci = state.publications.filter((item) => publicationIndexingLabel(item.indexing, lang).toUpperCase() === 'SCI').length;
  const allKci = state.publications.filter((item) => publicationIndexingLabel(item.indexing, lang).toUpperCase() === 'KCI').length;

  const summary = qs('#publication-summary');
  if (summary) summary.textContent = '';

  const statGrid = qs('#publication-stat-grid');
  if (statGrid) {
    statGrid.innerHTML = [
      { value: state.publications.length, label: lang === 'en' ? 'Publications' : '논문' },
      { value: allSci, label: 'SCI' },
      { value: allKci, label: 'KCI' }
    ].map((item) => `<article class="stat-card reveal"><strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong><span>${escapeHTML(item.label)}</span></article>`).join('');
  }

  const publicationAccordion = qs('#publication-accordion');
  if (publicationAccordion) {
    const grouped = Object.entries(groupBy(filtered, (item) => dynamicYearBucket(item.year)))
      .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
    publicationAccordion.innerHTML = grouped.map(([year, items], index) => accordionMarkup(year, items.length, `<div class="publication-list">${items.map((item) => publicationCard(item)).join('')}</div>`, index === 0)).join('');
  }
}

function renderBoard() {
  const noticePosts = state.board.filter((item) => ['notice', 'news'].includes(item.category));
  const presentationPosts = state.board.filter((item) => ['poster', 'oral'].includes(item.category));
  const summary = qs('#board-summary');
  if (summary) summary.textContent = lang === 'en' ? `${state.board.length} posts` : `게시글 ${state.board.length}건`;
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
  if (tabEyebrow) tabEyebrow.textContent = isNews ? 'NEWS' : 'PRESENTATIONS';
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
  const key = project.leadRole || 'principalInvestigator';
  const map = {
    principalInvestigator: locale === 'en' ? 'Principal investigator' : '연구책임자',
    coPrincipalInvestigator: locale === 'en' ? 'Co-principal investigator' : '공동연구책임자',
    leadInstitutionInvestigator: locale === 'en' ? 'Lead institution investigator' : '주관책임자'
  };
  return map[key] || (locale === 'en' ? 'Principal investigator' : '연구책임자');
}

function isGenericOngoingPeriod(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  return !normalized || /^(진행중|진행中|inprogress|ongoing|in-progress)$/.test(normalized);
}

function getProjectPeriodDisplay(project = {}) {
  const raw = String(project.period || '').trim();
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
  return `
    <article class="member-card reveal interactive-card" data-member-id="${escapeHTML(member.id)}" tabindex="0" role="button" aria-label="${escapeHTML(memberDisplayName(member))}">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}
      </div>
      <div class="member-copy">
        ${memberMetaChips(member) ? `<div class="member-chip-row">${memberMetaChips(member)}</div>` : ''}
        <h3>${escapeHTML(memberDisplayName(member))}</h3>
        ${member.education ? `<p>${escapeHTML(member.education)}</p>` : ''}
        ${member.email ? `<a class="member-link" href="mailto:${escapeHTML(member.email)}">${escapeHTML(member.email)}</a>` : ''}
      </div>
    </article>
  `;
}

function alumniCard(member) {
  return `
    <article class="member-card member-card--alumni reveal interactive-card" data-member-id="${escapeHTML(member.id)}" tabindex="0" role="button" aria-label="${escapeHTML(memberDisplayName(member))}">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(memberDisplayName(member))}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}
      </div>
      <div class="member-copy">
        <div class="member-chip-row"><span class="member-chip">${escapeHTML(member.graduationYear || '')}</span></div>
        <h3>${escapeHTML(memberDisplayName(member))}</h3>
        ${member.bio ? `<p>${escapeHTML(member.bio)}</p>` : ''}
        ${member.currentPosition ? `<p class="muted"><strong>${escapeHTML(copy.currentPosition)}:</strong> ${escapeHTML(member.currentPosition)}</p>` : ''}
      </div>
    </article>
  `;
}

function projectCard(project, { compact = false } = {}) {
  const period = getProjectPeriodDisplay(project);
  const leadMeta = project.principalInvestigator
    ? `<strong>${escapeHTML(projectLeadRoleLabel(project, lang))}</strong> ${escapeHTML(project.principalInvestigator)}`
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
      ${!compact && localizedProjectTags(project).length ? `<div class="tag-row">${localizedProjectTags(project).map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
    </article>
  `;
}

function archiveProjectItem(project) {
  const period = getProjectPeriodDisplay(project) || project.year || '';
  const leadMeta = project.principalInvestigator
    ? `<strong>${escapeHTML(projectLeadRoleLabel(project, lang))}</strong> ${escapeHTML(project.principalInvestigator)}`
    : '';
  return `
    <article class="archive-item reveal interactive-card" data-project-id="${escapeHTML(project.id)}" tabindex="0" role="button" aria-label="${escapeHTML(localizedProjectTitle(project))}">
      <div>
        <h3>${escapeHTML(localizedProjectTitle(project))}</h3>
        ${localizedProjectDescription(project) ? `<p>${escapeHTML(localizedProjectDescription(project))}</p>` : ''}
        ${leadMeta ? `<p class="muted">${leadMeta}</p>` : ''}
      </div>
      <div class="archive-meta">
        ${period ? `<span class="meta-pill">${escapeHTML(period)}</span>` : ''}
      </div>
    </article>
  `;
}

function publicationCard(item) {
  const link = resolvePublicationLink(item);
  const indexLabel = publicationIndexingLabel(item.indexing, lang);
  const indexClass = indexLabel ? indexLabel.toLowerCase() : '';
  const journalTone = journalToneClass(item.journal);
  const acceptedYear = item.year ? `${escapeHTML(item.year)}${padMonth(item.month) ? `.${escapeHTML(padMonth(item.month))}` : ''}` : '';
  const acceptedLabel = acceptedYear;
  const yearPill = item.year ? `${escapeHTML(item.year)}${padMonth(item.month) ? `.${escapeHTML(padMonth(item.month))}` : ''}` : '';
  return `
    <article class="publication-card reveal">
      <div class="publication-head-row">
        <div class="publication-topline">
          ${yearPill ? `<span class="year-pill">${yearPill}</span>` : ''}
          ${item.journal ? `<span class="journal-pill ${journalTone}">${escapeHTML(item.journal)}</span>` : ''}
          ${indexLabel ? `<span class="index-pill ${indexClass ? `index-pill--${escapeHTML(indexClass)}` : ''}">${escapeHTML(indexLabel)}</span>` : ''}
        </div>
        ${acceptedLabel ? `<span class="publication-accepted">${acceptedLabel}</span>` : ''}
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
  return `
    <article class="board-card reveal interactive-card" data-board-id="${escapeHTML(post.id)}">
      ${post.imageUrl ? `<div class="board-card__media"><img src="${escapeHTML(rootAsset(post.imageUrl, root))}" alt="${escapeHTML(post.title)}"></div>` : ''}
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
