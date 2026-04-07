import { BUILD_DATE, SITE_COPY, FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS } from './data.js';
import {
  escapeHTML,
  getInitials,
  groupBy,
  rootAsset,
  sortMembers,
  sortProjects,
  sortPublications,
  lastUpdated,
  formatDate,
  resolvePublicationLink,
  memberGroupLabel,
  memberTrackLabel,
  memberCourseLabel,
  projectStatusLabel,
  mergeMembers,
  mergeProjects,
  mergePublications
} from './utils.js';
import { hasFirebaseConfig, fetchCollection, COLLECTIONS } from './firebase.js';

const body = document.body;
const page = body.dataset.page;
const lang = body.dataset.lang || 'kr';
const root = body.dataset.root || '.';
const copy = SITE_COPY[lang];

const state = {
  members: sortMembers(FALLBACK_MEMBERS),
  projects: sortProjects(FALLBACK_PROJECTS),
  publications: sortPublications(FALLBACK_PUBLICATIONS),
  publicationQuery: ''
};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

const focusImages = [
  'assets/images/background/hero-1.jpg',
  'assets/images/background/hero-2.jpg',
  'assets/images/background/hero-3.jpg'
].map((path) => rootAsset(path, root));

const GENERIC_ONGOING_LABELS = new Set(['진행중', '진행 중', 'in progress', 'inprogress', 'ongoing']);

function compactText(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s._-]+/g, ' ');
}

function getProjectPeriodDisplay(project = {}) {
  const raw = String(project.period || '').trim();
  if (!raw) return '';
  const normalized = compactText(raw);
  if (GENERIC_ONGOING_LABELS.has(normalized)) return '';
  if (project.status === 'completed' && raw === String(project.year || '').trim()) return raw;
  return raw;
}

function yearSort(label) {
  const match = String(label).match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

document.addEventListener('DOMContentLoaded', () => {
  setupHeader();
  setupRevealAnimations();
  setupAccordions();
  setupSearch();
  if (page === 'home') setupHeroSlider();
  hydrate().finally(() => {
    renderPage();
  });
});

async function hydrate() {
  if (!hasFirebaseConfig) return;
  try {
    const [members, projects, publications] = await Promise.all([
      fetchCollection(COLLECTIONS.members),
      fetchCollection(COLLECTIONS.projects),
      fetchCollection(COLLECTIONS.publications)
    ]);
    state.members = sortMembers(mergeMembers(FALLBACK_MEMBERS, members));
    state.projects = sortProjects(mergeProjects(FALLBACK_PROJECTS, projects));
    state.publications = sortPublications(mergePublications(FALLBACK_PUBLICATIONS, publications));
  } catch (error) {
    console.warn('Firebase 데이터를 불러오지 못해 기본 데이터를 사용합니다.', error);
  }
}

function renderPage() {
  switch (page) {
    case 'home':
      renderHome();
      break;
    case 'members':
      renderMembers();
      break;
    case 'projects':
      renderProjects();
      break;
    case 'publications':
      renderPublications();
      break;
    default:
      break;
  }
  setUpdatedDate();
  setupRevealAnimations();
  setupCountAnimations();
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
    if (item.dataset.countBound) return;
    item.dataset.countBound = 'true';
    item.textContent = '0';
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
    if (progress < 1 && el.dataset.counting === 'true') {
      requestAnimationFrame(step);
    } else {
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

  qs('#hero-stat-grid').innerHTML = [
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

  qs('#focus-grid').innerHTML = copy.focusCards.map((item, index) => `
      <article class="focus-card reveal">
        <div class="focus-card-media"><img src="${escapeHTML(focusImages[index])}" alt="${escapeHTML(item.label)}"></div>
        <div class="focus-card-copy">
          <span>${escapeHTML(item.label)}</span>
          <strong>${escapeHTML(item.title)}</strong>
          <p>${escapeHTML(item.desc)}</p>
        </div>
      </article>
    `).join('');

  const ongoingPreview = state.projects.filter((item) => item.status === 'ongoing').slice(0, 3);
  qs('#ongoing-preview-grid').innerHTML = ongoingPreview.map((project) => projectCard(project, { compact: true })).join('');
}

function renderMembers() {
  const members = state.members;
  const pi = members.find((item) => item.group === 'pi' && item.status !== 'alumni');
  const researchProfessors = members.filter((item) => item.group === 'researchProfessor' && item.status !== 'alumni');
  const graduateStudents = members.filter((item) => item.group === 'graduateStudent' && item.status !== 'alumni');
  const studentResearchers = members.filter((item) => item.group === 'studentResearcher' && item.status !== 'alumni');
  const alumni = members.filter((item) => item.status === 'alumni');

  qs('#page-stat-grid').innerHTML = [
    { value: members.filter((item) => item.status !== 'alumni').length, label: copy.stats.current },
    { value: alumni.length, label: copy.stats.alumni },
    { value: researchProfessors.length, label: copy.researchProfessorSection },
    { value: graduateStudents.length, label: copy.graduateStudent }
  ].map((item) => `
      <article class="stat-card reveal">
        <strong class="count-up" data-target="${escapeHTML(item.value)}">0</strong>
        <span>${escapeHTML(item.label)}</span>
      </article>
    `).join('');

  if (pi) {
    qs('#pi-card').innerHTML = `
      <div class="pi-card-head">
        <span class="eyebrow">${escapeHTML(copy.pi)}</span>
        <h2>${escapeHTML(pi.name)}</h2>
        <p class="pi-title">${escapeHTML(pi.bio || (lang === 'en' ? 'Professor, Chungnam National University' : '충남대학교 교수'))}</p>
      </div>
      <div class="pi-card-grid">
        <article>
          <h3>${escapeHTML(copy.education)}</h3>
          <p>${escapeHTML(pi.education)}</p>
        </article>
        <article>
          <h3>${escapeHTML(copy.experience)}</h3>
          <p>${escapeHTML(pi.experience)}</p>
        </article>
        <article>
          <h3>${escapeHTML(copy.interest)}</h3>
          <p>${escapeHTML(pi.researchInterest)}</p>
        </article>
        <article>
          <h3>${escapeHTML(copy.contact)}</h3>
          <p><a class="member-link" href="mailto:${escapeHTML(pi.email)}">${escapeHTML(pi.email)}</a></p>
        </article>
      </div>
    `;
  }

  qs('#research-professor-list').innerHTML = researchProfessors.length
    ? `<div class="member-grid member-grid--wide">${researchProfessors.map((item) => memberCard(item)).join('')}</div>`
    : emptyState(copy.noMembers);

  const gradSections = [
    { title: copy.phdFullTime, items: graduateStudents.filter((item) => item.course === 'phd' && item.track === 'fullTime') },
    { title: copy.phdPartTime, items: graduateStudents.filter((item) => item.course === 'phd' && item.track === 'partTime') },
    { title: copy.msFullTime, items: graduateStudents.filter((item) => item.course === 'ms' && item.track === 'fullTime') },
    { title: copy.msPartTime, items: graduateStudents.filter((item) => item.course === 'ms' && item.track === 'partTime') }
  ];

  qs('#graduate-accordion').innerHTML = gradSections.map((section, index) => {
    const content = section.items.length ? `<div class="member-grid">${section.items.map((item) => memberCard(item)).join('')}</div>` : emptyState(copy.noMembers);
    return accordionMarkup(section.title, section.items.length, content, index === 0);
  }).join('');

  qs('#student-researcher-accordion').innerHTML = accordionMarkup(
    copy.studentResearcherSection,
    studentResearchers.length,
    studentResearchers.length ? `<div class="member-grid member-grid--wide">${studentResearchers.map((item) => memberCard(item)).join('')}</div>` : emptyState(copy.noMembers),
    true
  );

  const alumniByYear = Object.entries(groupBy(alumni, (item) => item.graduationYear || (lang === 'en' ? 'Earlier' : '이전')))
    .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
  qs('#alumni-accordion').innerHTML = alumniByYear.map(([year, items], index) => {
    return accordionMarkup(year, items.length, `<div class="member-grid member-grid--alumni">${items.map((item) => alumniCard(item)).join('')}</div>`, index === 0);
  }).join('');
}

function renderProjects() {
  const ongoing = state.projects.filter((item) => item.status === 'ongoing');
  const completed = state.projects.filter((item) => item.status === 'completed');
  qs('#project-summary').textContent = lang === 'en'
    ? `${ongoing.length} ongoing · ${completed.length} archived`
    : `${ongoing.length}건 진행 중 · ${completed.length}건 종료`;

  qs('#ongoing-project-grid').innerHTML = ongoing.map((project) => projectCard(project)).join('');

  const completedByYear = Object.entries(groupBy(completed, (item) => item.year || (lang === 'en' ? 'Earlier' : '이전')))
    .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
  qs('#completed-project-accordion').innerHTML = completedByYear.map(([year, items], index) => {
    return accordionMarkup(year, items.length, `<div class="archive-list">${items.map((item) => archiveProjectItem(item)).join('')}</div>`, index === 0);
  }).join('');
}

function renderPublications() {
  const query = state.publicationQuery.trim().toLowerCase();
  const filtered = !query ? state.publications : state.publications.filter((item) => {
    const haystack = [item.title, item.authors, item.journal, item.doi, item.url].join(' ').toLowerCase();
    return haystack.includes(query);
  });

  qs('#publication-summary').textContent = lang === 'en' ? `${filtered.length} publications` : `${filtered.length}편`;

  const grouped = Object.entries(groupBy(filtered, (item) => item.year || (lang === 'en' ? 'Earlier' : '이전')))
    .sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
  qs('#publication-accordion').innerHTML = grouped.map(([year, items], index) => {
    return accordionMarkup(year, items.length, `<div class="publication-list">${items.map((item) => publicationCard(item)).join('')}</div>`, index === 0);
  }).join('');
}

function setupSearch() {
  qs('#publication-search')?.addEventListener('input', (event) => {
    state.publicationQuery = event.currentTarget.value;
    renderPublications();
    setUpdatedDate();
    setupRevealAnimations();
  });
}

function setUpdatedDate() {
  const target = qs('#page-updated');
  if (!target) return;
  let source = BUILD_DATE;
  if (page === 'members') source = lastUpdated(state.members, BUILD_DATE);
  if (page === 'projects') source = lastUpdated(state.projects, BUILD_DATE);
  if (page === 'publications') source = lastUpdated(state.publications, BUILD_DATE);
  target.textContent = `${copy.updated} ${formatDate(source, lang === 'en' ? 'en-CA' : 'ko-KR')}`;
}

function memberMetaChips(member) {
  const chips = [];
  if (member.group === 'graduateStudent') {
    if (member.course) chips.push(memberCourseLabel(member.course, lang));
    if (member.track && member.track !== 'none') chips.push(memberTrackLabel(member.track, lang));
  }
  return chips.map((chip) => `<span class="member-chip member-chip--soft">${escapeHTML(chip)}</span>`).join('');
}

function memberCard(member) {
  return `
    <article class="member-card reveal">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}
      </div>
      <div class="member-copy">
        ${memberMetaChips(member) ? `<div class="member-chip-row">${memberMetaChips(member)}</div>` : ''}
        <h3>${escapeHTML(member.name)}</h3>
        ${member.education ? `<p>${escapeHTML(member.education)}</p>` : ''}
        ${member.researchInterest ? `<p class="muted">${escapeHTML(member.researchInterest)}</p>` : ''}
        ${member.email ? `<a class="member-link" href="mailto:${escapeHTML(member.email)}">${escapeHTML(member.email)}</a>` : ''}
      </div>
    </article>
  `;
}

function alumniCard(member) {
  return `
    <article class="member-card member-card--alumni reveal">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}
      </div>
      <div class="member-copy">
        <div class="member-chip-row"><span class="member-chip">${escapeHTML(member.graduationYear || '')}</span></div>
        <h3>${escapeHTML(member.name)}</h3>
        ${member.bio ? `<p>${escapeHTML(member.bio)}</p>` : ''}
        ${member.currentPosition ? `<p class="muted"><strong>${escapeHTML(copy.currentPosition)}:</strong> ${escapeHTML(member.currentPosition)}</p>` : ''}
      </div>
    </article>
  `;
}

function projectCard(project, { compact = false } = {}) {
  const period = getProjectPeriodDisplay(project);
  return `
    <article class="project-card${compact ? ' compact-card' : ''} reveal">
      <div class="card-head">
        <span class="status-pill">${escapeHTML(projectStatusLabel(project.status, lang))}</span>
        ${period ? `<span class="meta-pill">${escapeHTML(period)}</span>` : ''}
      </div>
      <h3>${escapeHTML(project.title)}</h3>
      <p>${escapeHTML(project.description)}</p>
      ${!compact && project.tags?.length ? `<div class="tag-row">${project.tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
    </article>
  `;
}

function archiveProjectItem(project) {
  const period = getProjectPeriodDisplay(project);
  return `
    <article class="archive-item reveal">
      <div>
        <h3>${escapeHTML(project.title)}</h3>
        ${project.description ? `<p>${escapeHTML(project.description)}</p>` : ''}
      </div>
      <div class="archive-meta">
        ${period ? `<span class="meta-pill">${escapeHTML(period)}</span>` : ''}
      </div>
    </article>
  `;
}

function publicationCard(item) {
  const link = resolvePublicationLink(item);
  return `
    <article class="publication-card reveal">
      <div class="publication-topline">
        ${item.year ? `<span class="year-pill">${escapeHTML(item.year)}</span>` : ''}
        ${item.journal ? `<span class="journal-pill">${escapeHTML(item.journal)}</span>` : ''}
      </div>
      <h3>${escapeHTML(item.title)}</h3>
      ${item.authors ? `<p class="publication-authors">${escapeHTML(item.authors)}</p>` : ''}
      ${item.doi ? `<p class="publication-doi"><a href="${escapeHTML(link || `https://doi.org/${item.doi}`)}" target="_blank" rel="noreferrer">${escapeHTML(copy.doi)} · ${escapeHTML(item.doi)}</a></p>` : link ? `<p class="publication-doi"><a href="${escapeHTML(link)}" target="_blank" rel="noreferrer">${escapeHTML(copy.open)}</a></p>` : ''}
      ${item.abstract ? `<p class="muted">${escapeHTML(item.abstract)}</p>` : ''}
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
  if (setupAccordions.bound) return;
  setupAccordions.bound = true;
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.accordion-trigger');
    if (!button) return;
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
}
