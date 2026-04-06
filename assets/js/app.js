import { siteContent, fallbackMembers, fallbackProjects, fallbackPublications } from './fallback-data.js';
import {
  escapeHTML,
  getInitials,
  groupBy,
  normalizeMember,
  normalizeProject,
  normalizePublication,
  resolveLink,
  sortMembers,
  sortProjects,
  sortPublications
} from './utils.js';

const state = {
  members: sortMembers(fallbackMembers),
  projects: sortProjects(fallbackProjects),
  publications: sortPublications(fallbackPublications),
  memberFilter: 'all',
  publicationQuery: ''
};

document.addEventListener('DOMContentLoaded', () => {
  applyStaticContent();
  setupNavigation();
  setupHeroSlider();
  setupRevealAnimations();
  setupMemberFilters();
  setupPublicationSearch();
  renderAll();
  hydrateFromFirebase().catch((error) => {
    console.error('[Public site] Firebase hydration failed. Falling back to bundled data.', error);
  });
});

async function hydrateFromFirebase() {
  let firebaseModule;
  try {
    firebaseModule = await import('./firebase.js');
  } catch (error) {
    console.warn('[Public site] Firebase module could not be loaded. Using bundled fallback data only.', error);
    return;
  }

  const { COLLECTIONS, fetchCollection, hasFirebaseConfig } = firebaseModule;
  if (!hasFirebaseConfig) return;

  const [membersResult, projectsResult, publicationsResult] = await Promise.allSettled([
    fetchCollection(COLLECTIONS.members),
    fetchCollection(COLLECTIONS.projects),
    fetchCollection(COLLECTIONS.publications)
  ]);

  if (membersResult.status === 'fulfilled' && membersResult.value.length) {
    state.members = sortMembers(membersResult.value.map(normalizeMember));
  }

  if (projectsResult.status === 'fulfilled' && projectsResult.value.length) {
    state.projects = sortProjects(projectsResult.value.map(normalizeProject));
  }

  if (publicationsResult.status === 'fulfilled' && publicationsResult.value.length) {
    state.publications = sortPublications(publicationsResult.value.map(normalizePublication));
  }

  renderAll();
}

function pageName() {
  return document.body.dataset.page || 'home';
}

function pageTitleMap(page) {
  const map = {
    home: `${siteContent.shortName} · ${siteContent.labName}`,
    members: `Members · ${siteContent.shortName}`,
    projects: `Projects · ${siteContent.shortName}`,
    publications: `Publications · ${siteContent.shortName}`
  };
  return map[page] || `${siteContent.shortName} · ${siteContent.labName}`;
}

function applyStaticContent() {
  const currentPage = pageName();
  document.title = pageTitleMap(currentPage);

  const heroEyebrow = document.getElementById('hero-eyebrow');
  const heroTitle = document.getElementById('hero-title');
  const heroSubtitle = document.getElementById('hero-subtitle');
  const heroDescription = document.getElementById('hero-description');
  const contactEmail = document.getElementById('contact-email');
  const contactNote = document.getElementById('contact-note');
  const footerLabName = document.getElementById('footer-lab-name');
  const footerYear = document.getElementById('footer-year');
  const keywordTracks = document.querySelectorAll('[data-keyword-track]');
  const pageHeroTitle = document.getElementById('page-hero-title');
  const pageHeroDescription = document.getElementById('page-hero-description');

  if (heroEyebrow) heroEyebrow.textContent = 'Chungnam National University';
  if (heroTitle) heroTitle.textContent = siteContent.heroTitle;
  if (heroSubtitle) heroSubtitle.textContent = siteContent.heroSubtitle;
  if (heroDescription) heroDescription.textContent = siteContent.heroDescription;
  if (contactEmail) contactEmail.textContent = siteContent.contact.email;
  if (contactNote) contactNote.textContent = siteContent.contact.note;
  if (footerLabName) footerLabName.textContent = siteContent.labName;
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());

  keywordTracks.forEach((track) => {
    track.innerHTML = [...siteContent.keywords, ...siteContent.keywords]
      .map((keyword) => `<span class="keyword-chip">${escapeHTML(keyword)}</span>`)
      .join('');
  });

  if (pageHeroTitle && pageHeroDescription) {
    const titles = {
      members: 'Members.',
      projects: 'Projects.',
      publications: 'Publications.'
    };
    const descriptions = {
      members:
        '교수진, 박사후연구원, 대학원생, 졸업생을 별도 페이지에서 편하게 볼 수 있도록 구성했습니다.',
      projects:
        '현재 진행 중인 과제와 종료된 과제를 분리해 보여주고, 관리자는 상태만 바꿔 손쉽게 이동시킬 수 있습니다.',
      publications:
        '연도별 정리와 검색 기능을 제공해 논문 제목, 저자, 저널, DOI로 바로 찾을 수 있게 했습니다.'
    };

    pageHeroTitle.textContent = titles[currentPage] || siteContent.shortName;
    pageHeroDescription.textContent = descriptions[currentPage] || siteContent.heroDescription;
  }
}

function renderAll() {
  renderHomeExplore();
  renderHeroStats();
  renderPageStats();
  renderMembers();
  renderProjects();
  renderPublications();
  refreshScrollTargets();
}

function countCardsMarkup(stats) {
  return stats
    .map((stat) => {
      const value = Number(stat.value);
      const countMarkup = Number.isFinite(value)
        ? `<strong class="count-up" data-count="${escapeHTML(value)}">0</strong>`
        : `<strong>${escapeHTML(stat.value)}</strong>`;
      return `
        <div class="hero-stat-card">
          ${countMarkup}
          <span>${escapeHTML(stat.label)}</span>
        </div>
      `;
    })
    .join('');
}

function observeCountUps(target) {
  const countNodes = target.querySelectorAll('.count-up');
  if (!countNodes.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.querySelectorAll('.count-up').forEach(animateCount);
        observer.disconnect();
      });
    },
    { threshold: 0.25 }
  );

  observer.observe(target);
}

function renderHeroStats() {
  const statsTarget = document.getElementById('hero-stat-grid');
  if (!statsTarget) return;

  const currentMembers = state.members.filter((member) => member.status !== 'alumni').length;
  const ongoingProjects = state.projects.filter((project) => project.status === 'ongoing').length;
  const publicationCount = state.publications.length;

  const stats = [
    { label: 'Current members', value: currentMembers },
    { label: 'Publications', value: publicationCount },
    { label: 'Ongoing projects', value: ongoingProjects },
    { label: 'Focus areas', value: 3 }
  ];

  statsTarget.innerHTML = countCardsMarkup(stats);
  observeCountUps(statsTarget);
}

function renderPageStats() {
  const target = document.getElementById('page-stat-grid');
  if (!target) return;

  const activeMembers = state.members.filter((member) => member.status !== 'alumni');
  const alumniMembers = state.members.filter((member) => member.status === 'alumni');
  const ongoingProjects = state.projects.filter((project) => project.status === 'ongoing');
  const completedProjects = state.projects.filter((project) => project.status === 'completed');
  const publicationYears = new Set(state.publications.map((item) => item.year).filter(Boolean));
  const currentPage = pageName();

  const statMap = {
    members: [
      { label: 'Current members', value: activeMembers.length },
      { label: 'Alumni', value: alumniMembers.length },
      { label: 'Faculty + Postdoc', value: activeMembers.filter((m) => m.group !== 'Graduate Students').length },
      { label: 'Graduate students', value: activeMembers.filter((m) => m.group === 'Graduate Students').length }
    ],
    projects: [
      { label: 'Ongoing', value: ongoingProjects.length },
      { label: 'Completed', value: completedProjects.length },
      { label: 'Members involved', value: activeMembers.length },
      { label: 'Research areas', value: 3 }
    ],
    publications: [
      { label: 'Total papers', value: state.publications.length },
      { label: 'Publication years', value: publicationYears.size || 1 },
      { label: 'Ongoing projects', value: ongoingProjects.length },
      { label: 'Current members', value: activeMembers.length }
    ]
  };

  target.innerHTML = countCardsMarkup(statMap[currentPage] || []);
  observeCountUps(target);
}

function animateCount(node) {
  const targetValue = Number(node.dataset.count || 0);
  const duration = 900;
  const start = performance.now();

  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const value = Math.round(progress * targetValue);
    node.textContent = String(value);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function memberPhotoMarkup(member, size = 'large') {
  if (member.photoUrl) {
    return `<img src="${escapeHTML(member.photoUrl)}" alt="${escapeHTML(member.name)}" loading="lazy" class="member-photo-image">`;
  }

  return `<div class="member-photo-fallback member-photo-fallback--${size}">${escapeHTML(getInitials(member.name))}</div>`;
}

function renderHomeExplore() {
  const grid = document.getElementById('home-explore-grid');
  if (!grid) return;

  const activeMembers = state.members.filter((member) => member.status !== 'alumni').length;
  const alumniMembers = state.members.filter((member) => member.status === 'alumni').length;
  const ongoingProjects = state.projects.filter((project) => project.status === 'ongoing').length;
  const publicationCount = state.publications.length;
  const latestPublicationYear = state.publications.find((item) => item.year)?.year || 'Latest';

  const cards = [
    {
      eyebrow: 'Members',
      title: 'People of the lab',
      metric: `${activeMembers} active · ${alumniMembers} alumni`,
      copy: '현재 구성원과 졸업생을 페이지 단위로 정리했습니다.',
      href: './members.html',
      cta: 'Open members'
    },
    {
      eyebrow: 'Projects',
      title: 'Research portfolio',
      metric: `${ongoingProjects} ongoing`,
      copy: '진행 중 과제와 종료 과제를 분리해 볼 수 있습니다.',
      href: './projects.html',
      cta: 'Open projects'
    },
    {
      eyebrow: 'Publications',
      title: 'Paper archive',
      metric: `${publicationCount} papers · ${latestPublicationYear}`,
      copy: '연도별 정리와 DOI 중심의 접근성을 높였습니다.',
      href: './publications.html',
      cta: 'Open publications'
    },
    {
      eyebrow: 'Admin',
      title: 'Firebase CMS',
      metric: 'Members · Papers · Projects',
      copy: '관리자 페이지에서 추가·수정·삭제와 졸업 처리를 진행합니다.',
      href: './admin.html',
      cta: 'Open admin'
    }
  ];

  grid.innerHTML = cards
    .map(
      (card) => `
        <a class="overview-card reveal" href="${escapeHTML(card.href)}">
          <span class="eyebrow">${escapeHTML(card.eyebrow)}</span>
          <h3>${escapeHTML(card.title)}</h3>
          <strong class="overview-metric">${escapeHTML(card.metric)}</strong>
          <p>${escapeHTML(card.copy)}</p>
          <span class="overview-link">${escapeHTML(card.cta)}</span>
        </a>
      `
    )
    .join('');
}

function renderMembers() {
  const currentTarget = document.getElementById('current-member-groups');
  const alumniTarget = document.getElementById('alumni-groups');
  const memberResult = document.getElementById('member-result-label');
  if (!currentTarget || !alumniTarget) return;

  const activeMembers = state.members.filter((member) => member.status !== 'alumni');
  const alumniMembers = state.members.filter((member) => member.status === 'alumni');
  const filterMap = {
    all: () => true,
    faculty: (member) => member.group === 'Principal Investigator',
    postdoc: (member) => member.group === 'Postdoctoral Researcher',
    graduate: (member) => member.group === 'Graduate Students'
  };

  const predicate = filterMap[state.memberFilter] || filterMap.all;
  const filteredActiveMembers = activeMembers.filter(predicate);
  const grouped = groupBy(filteredActiveMembers, (member) => member.group);
  const orderedGroups = ['Principal Investigator', 'Postdoctoral Researcher', 'Graduate Students'];

  currentTarget.innerHTML = orderedGroups
    .filter((groupName) => grouped[groupName]?.length)
    .map((groupName) => {
      const members = grouped[groupName];
      const groupDescription =
        groupName === 'Principal Investigator'
          ? 'Lab leadership, research direction, and interdisciplinary cultivation strategy.'
          : groupName === 'Postdoctoral Researcher'
            ? 'Advanced research across smart irrigation, crop physiology, and controlled environment systems.'
            : 'Hands-on research across AI, plant physiology, indoor cultivation, and sustainability.';

      if (groupName === 'Graduate Students') {
        const tracks = groupBy(members, (member) => member.track || 'Students');
        return `
          <section class="member-block">
            <div class="section-inline-header">
              <div>
                <span class="eyebrow">Members</span>
                <h3>${escapeHTML(groupName)}</h3>
              </div>
              <p>${escapeHTML(groupDescription)}</p>
            </div>
            ${Object.entries(tracks)
              .map(([trackName, trackMembers]) => {
                const courseGroups = groupBy(trackMembers, (member) => member.course || 'Students');
                return `
                  <div class="member-subsection">
                    <div class="member-subsection-head">
                      <h4>${escapeHTML(trackName)}</h4>
                    </div>
                    ${Object.entries(courseGroups)
                      .map(
                        ([courseName, courseMembers]) => `
                          <div class="member-course">
                            <div class="member-course-title">${escapeHTML(courseName)}</div>
                            <div class="member-grid">
                              ${courseMembers.map((member) => renderMemberCard(member)).join('')}
                            </div>
                          </div>
                        `
                      )
                      .join('')}
                  </div>
                `;
              })
              .join('')}
          </section>
        `;
      }

      const gridClass = groupName === 'Principal Investigator' ? 'member-grid member-grid--pi' : 'member-grid';
      return `
        <section class="member-block">
          <div class="section-inline-header">
            <div>
              <span class="eyebrow">Members</span>
              <h3>${escapeHTML(groupName)}</h3>
            </div>
            <p>${escapeHTML(groupDescription)}</p>
          </div>
          <div class="${gridClass}">
            ${members.map((member) => renderMemberCard(member)).join('')}
          </div>
        </section>
      `;
    })
    .join('');

  const alumniGroups = Object.entries(groupBy(alumniMembers, (member) => member.graduationYear || 'Alumni'))
    .sort((a, b) => Number(b[0]) - Number(a[0]));

  alumniTarget.innerHTML = alumniGroups
    .map(
      ([year, members]) => `
        <section class="alumni-year-block">
          <div class="alumni-year-heading">
            <span class="eyebrow">Alumni</span>
            <h4>${escapeHTML(year)}</h4>
          </div>
          <div class="alumni-grid">
            ${members.map((member) => renderAlumniCard(member)).join('')}
          </div>
        </section>
      `
    )
    .join('');

  if (memberResult) {
    memberResult.textContent = `${filteredActiveMembers.length} current members · ${alumniMembers.length} alumni`;
  }
}

function renderMemberCard(member) {
  const researchSummary =
    member.researchInterest ||
    member.bio ||
    member.education ||
    member.currentPosition ||
    'Research profile will appear here when added by the administrator.';
  const courseLabel = [member.track, member.course].filter(Boolean).join(' · ');

  return `
    <article class="member-card ${member.group === 'Principal Investigator' ? 'member-card--featured' : ''}">
      <div class="member-photo">${memberPhotoMarkup(member)}</div>
      <div class="member-card-body">
        <div class="member-card-meta">
          <span class="badge">${escapeHTML(member.group)}</span>
          ${member.course ? `<span class="muted">${escapeHTML(courseLabel)}</span>` : ''}
        </div>
        <h4>${escapeHTML(member.name)}</h4>
        <p class="member-copy">${escapeHTML(researchSummary)}</p>
        <div class="member-footer">
          ${member.email ? `<a href="mailto:${escapeHTML(member.email)}">${escapeHTML(member.email)}</a>` : '<span class="muted">Email not listed</span>'}
        </div>
      </div>
    </article>
  `;
}

function renderAlumniCard(member) {
  return `
    <article class="alumni-card">
      <div class="alumni-avatar">${escapeHTML(getInitials(member.name))}</div>
      <div class="alumni-body">
        <h5>${escapeHTML(member.name)}</h5>
        ${member.course ? `<p class="muted">${escapeHTML(member.course)}</p>` : ''}
        ${member.currentPosition ? `<p>${escapeHTML(member.currentPosition)}</p>` : '<p>Current position can be updated in the admin dashboard.</p>'}
      </div>
    </article>
  `;
}

function renderProjects() {
  const ongoingTarget = document.getElementById('ongoing-project-grid');
  const completedTarget = document.getElementById('completed-project-list');
  const projectResult = document.getElementById('project-result-label');
  if (!ongoingTarget || !completedTarget) return;

  const ongoingProjects = state.projects.filter((project) => project.status === 'ongoing');
  const completedProjects = state.projects.filter((project) => project.status === 'completed');

  ongoingTarget.innerHTML = ongoingProjects
    .map(
      (project) => `
        <article class="project-card">
          <div class="card-topline">
            <span class="badge badge--green">In progress</span>
            ${project.period ? `<span class="muted">${escapeHTML(project.period)}</span>` : ''}
          </div>
          <h4>${escapeHTML(project.title)}</h4>
          <p>${escapeHTML(project.description || 'Project description can be added from the admin dashboard.')}</p>
          ${
            project.tags?.length
              ? `<div class="tag-row">${project.tags
                  .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
                  .join('')}</div>`
              : ''
          }
        </article>
      `
    )
    .join('');

  completedTarget.innerHTML = completedProjects
    .map(
      (project) => `
        <li class="archive-item">
          <span class="archive-dot"></span>
          <div>
            <strong>${escapeHTML(project.title)}</strong>
            ${project.period || project.year ? `<span class="muted">${escapeHTML(project.period || project.year)}</span>` : ''}
            ${project.description ? `<p>${escapeHTML(project.description)}</p>` : ''}
          </div>
        </li>
      `
    )
    .join('');

  if (projectResult) {
    projectResult.textContent = `${ongoingProjects.length} ongoing · ${completedProjects.length} archived`;
  }
}

function renderPublications() {
  const publicationsTarget = document.getElementById('publication-groups');
  const publicationResult = document.getElementById('publication-result-label');
  if (!publicationsTarget) return;

  const query = state.publicationQuery.trim().toLowerCase();
  const filtered = state.publications.filter((publication) => {
    if (!query) return true;
    const haystack = [
      publication.title,
      publication.authors,
      publication.journal,
      publication.year,
      publication.doi,
      publication.abstract
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });

  if (publicationResult) {
    publicationResult.textContent = `${filtered.length} publications`;
  }

  if (!filtered.length) {
    publicationsTarget.innerHTML = `
      <div class="empty-card">
        <h4>No matching publications</h4>
        <p>Try a different keyword for title, journal, DOI, or author.</p>
      </div>
    `;
    return;
  }

  const grouped = groupBy(filtered, (publication) => publication.year || 'Uncategorized');
  const orderedGroups = Object.keys(grouped).sort((left, right) => {
    const leftNum = /^\d{4}$/.test(left) ? Number(left) : 1;
    const rightNum = /^\d{4}$/.test(right) ? Number(right) : 1;
    return rightNum - leftNum;
  });

  publicationsTarget.innerHTML = orderedGroups
    .map((yearLabel, index) => {
      const isOpen = index < 2 || !!query;
      return `
        <details class="publication-group" ${isOpen ? 'open' : ''}>
          <summary>
            <span>${escapeHTML(yearLabel)}</span>
            <span class="muted">${grouped[yearLabel].length} items</span>
          </summary>
          <div class="publication-list">
            ${grouped[yearLabel].map((publication) => renderPublicationCard(publication)).join('')}
          </div>
        </details>
      `;
    })
    .join('');
}

function renderPublicationCard(publication) {
  const link = resolveLink(publication);
  return `
    <article class="publication-card">
      <div class="card-topline">
        <span class="badge badge--dark">${escapeHTML(publication.year || 'Paper')}</span>
        ${publication.journal ? `<span class="muted">${escapeHTML(publication.journal)}</span>` : ''}
      </div>
      <h4>${escapeHTML(publication.title)}</h4>
      ${publication.authors ? `<p class="publication-authors">${escapeHTML(publication.authors)}</p>` : ''}
      ${publication.abstract ? `<p class="publication-abstract">${escapeHTML(publication.abstract)}</p>` : ''}
      <div class="publication-actions">
        ${link ? `<a href="${escapeHTML(link)}" target="_blank" rel="noreferrer noopener" class="button secondary">Open DOI</a>` : ''}
        ${publication.doi ? `<span class="muted">DOI · ${escapeHTML(publication.doi)}</span>` : ''}
      </div>
    </article>
  `;
}

function setupMemberFilters() {
  const buttons = document.querySelectorAll('[data-member-filter]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      state.memberFilter = button.dataset.memberFilter || 'all';
      buttons.forEach((target) => target.classList.remove('is-active'));
      button.classList.add('is-active');
      renderMembers();
    });
  });
}

function setupPublicationSearch() {
  const input = document.getElementById('publication-search');
  if (!input) return;

  input.addEventListener('input', (event) => {
    state.publicationQuery = event.currentTarget.value || '';
    renderPublications();
  });
}

function setupNavigation() {
  const header = document.querySelector('.site-header');
  const navToggle = document.querySelector('[data-menu-toggle]');
  const navPanel = document.querySelector('[data-nav-panel]');
  const links = document.querySelectorAll('.site-nav a');
  const currentPage = pageName();

  links.forEach((link) => {
    const targetPage = link.dataset.navPage;
    const isActive = targetPage === currentPage;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
  });

  navToggle?.addEventListener('click', () => {
    navPanel?.classList.toggle('is-open');
    navToggle.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', navPanel?.classList.contains('is-open') ? 'true' : 'false');
  });

  links.forEach((link) => {
    link.addEventListener('click', () => {
      navPanel?.classList.remove('is-open');
      navToggle?.classList.remove('is-open');
      navToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  const handleScroll = () => {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 24);
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
}

function setupHeroSlider() {
  const slides = Array.from(document.querySelectorAll('[data-hero-slide]'));
  if (!slides.length) return;

  let activeIndex = 0;
  slides[0].classList.add('is-active');

  window.setInterval(() => {
    slides[activeIndex].classList.remove('is-active');
    activeIndex = (activeIndex + 1) % slides.length;
    slides[activeIndex].classList.add('is-active');
  }, 5600);
}

let revealObserver;
function setupRevealAnimations() {
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      });
    },
    { threshold: 0.12 }
  );
  refreshScrollTargets();
}

function refreshScrollTargets() {
  if (!revealObserver) return;
  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));
}
