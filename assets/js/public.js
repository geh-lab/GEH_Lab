import { BUILD_DATE, SITE_COPY, FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS } from './data.js';
import {
  escapeHTML,
  getInitials,
  groupBy,
  normalizeMember,
  normalizeProject,
  normalizePublication,
  rootAsset,
  sortMembers,
  sortProjects,
  sortPublications,
  lastUpdated,
  formatDate,
  resolvePublicationLink,
  memberStatusLabel,
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

document.addEventListener('DOMContentLoaded', () => {
  setupHeader();
  setupRevealAnimations();
  setupAccordions(document);
  setupSearch();
  if (page === 'home') setupHeroSlider();
  hydrate().finally(renderPage);
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
  setUpdatedDate();
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
}

function setupHeader() {
  const toggle = qs('[data-menu-toggle]');
  const panel = qs('[data-nav-panel]');
  const header = qs('.site-header');
  const activeLink = qs(`.site-nav a[data-nav-page="${page}"]`);
  activeLink?.classList.add('is-active');

  toggle?.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('is-open');
    toggle.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  qsa('.site-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      panel?.classList.remove('is-open');
      toggle?.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
    });
  });

  window.addEventListener('scroll', () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 16);
  });
}

function setupRevealAnimations() {
  const items = qsa('.reveal');
  if (!items.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-visible', entry.isIntersecting);
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -8% 0px'
    }
  );
  items.forEach((item) => {
    if (item.dataset.revealBound) return;
    item.dataset.revealBound = 'true';
    observer.observe(item);
  });
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
  const pubCount = state.publications.length;

  const statGrid = qs('#hero-stat-grid');
  statGrid.innerHTML = [
    { value: activeMembers, label: copy.stats.current },
    { value: alumniCount, label: copy.stats.alumni },
    { value: ongoingCount, label: copy.stats.ongoing },
    { value: pubCount, label: copy.stats.publications }
  ]
    .map(
      (item) => `
        <article class="stat-card">
          <strong>${escapeHTML(item.value)}</strong>
          <span>${escapeHTML(item.label)}</span>
        </article>
      `
    )
    .join('');

  const focusGrid = qs('#focus-grid');
  focusGrid.innerHTML = copy.focusCards
    .map(
      (item, index) => `
        <article class="focus-card reveal is-visible">
          <div class="focus-card-media"><img src="${escapeHTML(focusImages[index])}" alt="${escapeHTML(item.label)}"></div>
          <div class="focus-card-copy">
            <span>${escapeHTML(item.label)}</span>
            <strong>${escapeHTML(item.title)}</strong>
            <p>${escapeHTML(item.desc)}</p>
          </div>
        </article>
      `
    )
    .join('');

  const ongoingPreview = state.projects.filter((item) => item.status === 'ongoing').slice(0, 3);
  qs('#ongoing-preview-grid').innerHTML = ongoingPreview
    .map(
      (project) => `
        <article class="project-card compact-card reveal is-visible">
          <div class="card-head">
            <span class="status-pill">${escapeHTML(projectStatusLabel(project.status, lang))}</span>
            ${project.period ? `<span class="meta-pill">${escapeHTML(project.period)}</span>` : ''}
          </div>
          <h3>${escapeHTML(project.title)}</h3>
          <p>${escapeHTML(project.description)}</p>
        </article>
      `
    )
    .join('');
  setupRevealAnimations();
}

function renderMembers() {
  const members = state.members;
  const pi = members.find((item) => item.group === 'pi');
  const researchProfessors = members.filter((item) => item.group === 'researchProfessor');
  const grad = members.filter((item) => item.group === 'graduateStudent' && item.status === 'enrolled');
  const studentResearchers = members.filter((item) => item.group === 'studentResearcher' && item.status === 'enrolled');
  const alumni = members.filter((item) => item.status === 'alumni');

  const stats = [
    { value: members.filter((item) => item.status !== 'alumni').length, label: copy.stats.current },
    { value: alumni.length, label: copy.stats.alumni },
    { value: researchProfessors.length, label: copy.researchProfessorSection },
    { value: studentResearchers.length, label: copy.studentResearcherSection }
  ];
  qs('#page-stat-grid').innerHTML = stats
    .map((item) => `<article class="stat-card"><strong>${item.value}</strong><span>${escapeHTML(item.label)}</span></article>`)
    .join('');

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
          <p><a href="mailto:${escapeHTML(pi.email)}">${escapeHTML(pi.email)}</a></p>
        </article>
      </div>
    `;
  }

  qs('#research-professor-list').innerHTML = researchProfessors.length
    ? `<div class="member-grid">${researchProfessors.map((item) => memberCard(item)).join('')}</div>`
    : emptyState(copy.noMembers);

  const gradSections = [
    { key: 'phdFullTime', title: copy.phdFullTime, items: grad.filter((item) => item.course === 'phd' && item.track === 'fullTime') },
    { key: 'phdPartTime', title: copy.phdPartTime, items: grad.filter((item) => item.course === 'phd' && item.track === 'partTime') },
    { key: 'msFullTime', title: copy.msFullTime, items: grad.filter((item) => item.course === 'ms' && item.track === 'fullTime') },
    { key: 'msPartTime', title: copy.msPartTime, items: grad.filter((item) => item.course === 'ms' && item.track === 'partTime') }
  ];

  qs('#graduate-accordion').innerHTML = gradSections
    .map((section, index) => accordionMarkup(section.title, section.items.length, section.items.length ? `<div class="member-grid">${section.items.map((item) => memberCard(item)).join('')}</div>` : emptyState(copy.noMembers), index === 0 && section.items.length))
    .join('');

  qs('#student-researcher-accordion').innerHTML = accordionMarkup(
    copy.studentResearcherSection,
    studentResearchers.length,
    studentResearchers.length ? `<div class="member-grid">${studentResearchers.map((item) => memberCard(item)).join('')}</div>` : emptyState(copy.noMembers),
    true
  );

  const alumniByYear = Object.entries(groupBy(alumni, (item) => item.graduationYear || (lang === 'en' ? 'Earlier' : '이전'))).sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
  qs('#alumni-accordion').innerHTML = alumniByYear
    .map(([year, items], index) => accordionMarkup(year, items.length, `<div class="member-grid member-grid--alumni">${items.map((item) => alumniCard(item)).join('')}</div>`, index === 0))
    .join('');

  setupAccordions(qs('#members-page'));
}

function renderProjects() {
  const ongoing = state.projects.filter((item) => item.status === 'ongoing');
  const completed = state.projects.filter((item) => item.status === 'completed');
  qs('#project-summary').textContent = lang === 'en'
    ? `${ongoing.length} ongoing · ${completed.length} archived`
    : `${ongoing.length}건 진행 중 · ${completed.length}건 종료`;

  qs('#ongoing-project-grid').innerHTML = ongoing
    .map(
      (project) => `
        <article class="project-card reveal is-visible">
          <div class="card-head">
            <span class="status-pill">${escapeHTML(projectStatusLabel(project.status, lang))}</span>
            ${project.period ? `<span class="meta-pill">${escapeHTML(project.period)}</span>` : ''}
          </div>
          <h3>${escapeHTML(project.title)}</h3>
          <p>${escapeHTML(project.description)}</p>
          ${project.tags?.length ? `<div class="tag-row">${project.tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
        </article>
      `
    )
    .join('');

  const completedByYear = Object.entries(groupBy(completed, (item) => item.year || (lang === 'en' ? 'Earlier' : '이전'))).sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
  qs('#completed-project-accordion').innerHTML = completedByYear
    .map(([year, items], index) => accordionMarkup(year, items.length, `<div class="archive-list">${items.map((item) => archiveProjectItem(item)).join('')}</div>`, index === 0))
    .join('');
  setupAccordions(qs('#projects-page'));
}

function renderPublications() {
  const query = state.publicationQuery.trim().toLowerCase();
  const filtered = !query
    ? state.publications
    : state.publications.filter((item) => {
        const haystack = [item.title, item.authors, item.journal, item.doi, item.url].join(' ').toLowerCase();
        return haystack.includes(query);
      });

  qs('#publication-summary').textContent = lang === 'en'
    ? `${filtered.length} publications`
    : `${filtered.length}편`;

  const grouped = Object.entries(groupBy(filtered, (item) => item.year || (lang === 'en' ? 'Earlier' : '이전'))).sort((a, b) => yearSort(b[0]) - yearSort(a[0]));
  qs('#publication-accordion').innerHTML = grouped
    .map(([year, items], index) => accordionMarkup(year, items.length, `<div class="publication-list">${items.map((item) => publicationCard(item)).join('')}</div>`, index === 0))
    .join('');
  setupAccordions(qs('#publications-page'));
}

function setupSearch() {
  const input = qs('#publication-search');
  input?.addEventListener('input', (event) => {
    state.publicationQuery = event.currentTarget.value;
    renderPublications();
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

function memberCard(member) {
  return `
    <article class="member-card reveal is-visible">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}
      </div>
      <div class="member-copy">
        <div class="member-chip-row">
          <span class="member-chip">${escapeHTML(memberStatusLabel(member, lang))}</span>
          ${member.course ? `<span class="member-chip member-chip--soft">${escapeHTML(memberCourseLabel(member.course, lang))}</span>` : ''}
        </div>
        <h3>${escapeHTML(member.name)}</h3>
        <p class="member-meta">${escapeHTML([memberTrackLabel(member.track, lang), memberCourseLabel(member.course, lang)].filter(Boolean).join(' · '))}</p>
        ${member.bio ? `<p>${escapeHTML(member.bio)}</p>` : ''}
        ${member.researchInterest ? `<p class="muted">${escapeHTML(member.researchInterest)}</p>` : ''}
        ${member.email ? `<a class="member-link" href="mailto:${escapeHTML(member.email)}">${escapeHTML(member.email)}</a>` : ''}
      </div>
    </article>
  `;
}

function alumniCard(member) {
  return `
    <article class="member-card member-card--alumni reveal is-visible">
      <div class="member-thumb">
        ${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}
      </div>
      <div class="member-copy">
        <div class="member-chip-row"><span class="member-chip">${escapeHTML(member.graduationYear)}</span></div>
        <h3>${escapeHTML(member.name)}</h3>
        ${member.bio ? `<p>${escapeHTML(member.bio)}</p>` : ''}
        ${member.currentPosition ? `<p class="muted"><strong>${escapeHTML(copy.currentPosition)}:</strong> ${escapeHTML(member.currentPosition)}</p>` : ''}
      </div>
    </article>
  `;
}

function archiveProjectItem(project) {
  return `
    <article class="archive-item reveal is-visible">
      <div>
        <h3>${escapeHTML(project.title)}</h3>
        ${project.description ? `<p>${escapeHTML(project.description)}</p>` : ''}
      </div>
      <div class="archive-meta">
        ${project.period ? `<span class="meta-pill">${escapeHTML(project.period)}</span>` : ''}
      </div>
    </article>
  `;
}

function publicationCard(item) {
  const link = resolvePublicationLink(item);
  return `
    <article class="publication-card reveal is-visible">
      <div class="publication-topline">
        <span class="journal-pill">${escapeHTML(item.journal || '')}</span>
        ${item.year ? `<span class="year-pill">${escapeHTML(item.year)}</span>` : ''}
      </div>
      <h3>${escapeHTML(item.title)}</h3>
      ${item.authors ? `<p class="publication-authors">${escapeHTML(item.authors)}</p>` : ''}
      <div class="publication-links">
        ${item.doi ? `<a href="${escapeHTML(link || `https://doi.org/${item.doi}`)}" target="_blank" rel="noreferrer">${escapeHTML(copy.doi)} · ${escapeHTML(item.doi)}</a>` : link ? `<a href="${escapeHTML(link)}" target="_blank" rel="noreferrer">${escapeHTML(copy.open)}</a>` : ''}
      </div>
      ${item.abstract ? `<p class="muted">${escapeHTML(item.abstract)}</p>` : ''}
    </article>
  `;
}

function accordionMarkup(title, count, content, open = false) {
  return `
    <article class="accordion${open ? ' is-open' : ''}">
      <button class="accordion-trigger" type="button" aria-expanded="${open ? 'true' : 'false'}">
        <span class="accordion-copy"><span>${escapeHTML(title)}</span><span class="accordion-meta">${escapeHTML(count)} ${escapeHTML(copy.countItems)}</span></span>
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

function setupAccordions(scope = document) {
  scope.querySelectorAll('.accordion-trigger').forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const article = button.closest('.accordion');
      const panel = article?.querySelector('.accordion-panel');
      const isOpen = article.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(isOpen));
      const icon = button.querySelector('.accordion-icon');
      if (icon) icon.textContent = isOpen ? '−' : '+';
      if (panel) panel.hidden = !isOpen;
    });
  });
}

function yearSort(label) {
  const match = String(label).match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}
