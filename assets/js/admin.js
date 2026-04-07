import { FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS } from './data.js';
import {
  escapeHTML,
  getInitials,
  normalizeMember,
  normalizeProject,
  normalizePublication,
  sortMembers,
  sortProjects,
  sortPublications,
  memberStatusLabel,
  memberCourseLabel,
  memberTrackLabel,
  projectStatusLabel,
  rootAsset,
  mergeMembers,
  mergeProjects,
  mergePublications,
  memberSemanticKey,
  projectSemanticKey,
  publicationSemanticKey
} from './utils.js';
import {
  ADMIN_EMAILS,
  auth,
  hasFirebaseConfig,
  COLLECTIONS,
  resolveRedirectResult,
  watchAdminState,
  signInAdminWithGoogle,
  signOutAdmin,
  fetchCollection,
  listenCollection,
  saveDocument,
  deleteDocumentById,
  uploadMemberPhoto,
  deleteMemberPhoto
} from './firebase.js';

const state = {
  user: null,
  members: sortMembers(FALLBACK_MEMBERS),
  projects: sortProjects(FALLBACK_PROJECTS),
  publications: sortPublications(FALLBACK_PUBLICATIONS),
  editingMember: null,
  editingProject: null,
  editingPublication: null,
  pendingMemberFile: null,
  pendingMemberPreview: '',
  seeded: false,
  unsubs: [],
  authResolved: false
};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));
const root = document.body.dataset.root || '.';

const elements = {
  authLoading: qs('#auth-loading'),
  loginView: qs('#login-view'),
  dashboardView: qs('#dashboard-view'),
  googleLoginButton: qs('#google-login-button'),
  logoutButton: qs('#logout-button'),
  currentUser: qs('#current-user-label'),
  authNotice: qs('#auth-notice'),
  tabButtons: qsa('[data-admin-tab]'),
  panels: qsa('[data-panel]'),
  memberForm: qs('#member-form'),
  memberList: qs('#member-list'),
  memberTitle: qs('#member-form-title'),
  memberPhotoInput: qs('#member-photo-input'),
  memberPhotoPreview: qs('#member-photo-preview'),
  memberPhotoRemove: qs('#member-photo-remove'),
  projectForm: qs('#project-form'),
  projectList: qs('#project-list'),
  projectTitle: qs('#project-form-title'),
  publicationForm: qs('#publication-form'),
  publicationList: qs('#publication-list'),
  publicationTitle: qs('#publication-form-title'),
  summaryMembers: qs('#summary-members'),
  summaryProjects: qs('#summary-projects'),
  summaryPublications: qs('#summary-publications')
};

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  renderSetupMessage();
  renderAllLists();
  togglePending(true);
  try {
    await resolveRedirectResult();
  } catch (error) {
    showNotice(error.message || 'Google 로그인 처리 중 오류가 발생했습니다.', 'danger');
  }
  if (auth?.currentUser) {
    await handleAuthState(auth.currentUser);
  }
  watchAdminState(async (user) => {
    if ((state.user?.uid || '') === (user?.uid || '') && state.authResolved) return;
    await handleAuthState(user);
  });
  if (!hasFirebaseConfig) {
    togglePending(false);
    toggleViews(false);
  }
});

function bindEvents() {
  elements.googleLoginButton?.addEventListener('click', handleGoogleLogin);
  elements.logoutButton?.addEventListener('click', async () => {
    await signOutAdmin();
  });
  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.adminTab));
  });
  elements.memberForm?.addEventListener('submit', handleMemberSubmit);
  elements.projectForm?.addEventListener('submit', handleProjectSubmit);
  elements.publicationForm?.addEventListener('submit', handlePublicationSubmit);
  elements.memberPhotoInput?.addEventListener('change', onMemberPhotoChange);
  elements.memberPhotoRemove?.addEventListener('click', clearMemberPhoto);
  qs('#member-reset')?.addEventListener('click', resetMemberForm);
  qs('#project-reset')?.addEventListener('click', resetProjectForm);
  qs('#publication-reset')?.addEventListener('click', resetPublicationForm);
  elements.memberList?.addEventListener('click', onMemberListClick);
  elements.projectList?.addEventListener('click', onProjectListClick);
  elements.publicationList?.addEventListener('click', onPublicationListClick);
}

function renderSetupMessage() {
  if (!elements.authNotice) return;
  if (!hasFirebaseConfig) {
    elements.authNotice.textContent = 'firebase-config.js 설정을 입력하면 Google 로그인과 관리자 저장 기능이 활성화됩니다.';
    return;
  }
  elements.authNotice.textContent = ADMIN_EMAILS.length
    ? `허용된 관리자 계정: ${ADMIN_EMAILS.join(', ')}`
    : '허용 관리자 계정 목록이 비어 있습니다. 보안을 위해 관리자 이메일을 설정하세요.';
}

async function handleGoogleLogin() {
  if (!hasFirebaseConfig) {
    showNotice('먼저 firebase-config.js를 채워주세요.', 'warning');
    return;
  }
  elements.googleLoginButton?.setAttribute('disabled', 'disabled');
  try {
    await signInAdminWithGoogle();
    if (auth?.currentUser) {
      await handleAuthState(auth.currentUser);
    }
  } catch (error) {
    console.error(error);
    showNotice(error.message || 'Google 로그인에 실패했습니다.', 'danger');
  } finally {
    elements.googleLoginButton?.removeAttribute('disabled');
  }
}

async function handleAuthState(user) {
  const previousUid = state.user?.uid || '';
  state.user = user || null;
  state.authResolved = true;
  togglePending(false);
  toggleViews(Boolean(user));
  if (!user) {
    state.seeded = false;
    teardownListeners();
    elements.currentUser.textContent = '로그인 필요';
    return;
  }
  elements.currentUser.textContent = user.email || '관리자';
  await ensureSeeded();
  attachListeners();
  setActiveTab('members');
  if (previousUid !== user.uid) {
    showNotice(`${user.email} 계정으로 로그인되었습니다.`, 'success');
  }
}

function togglePending(isPending) {
  if (elements.authLoading) elements.authLoading.hidden = !isPending;
  if (isPending) {
    elements.loginView.hidden = true;
    elements.dashboardView.hidden = true;
    elements.logoutButton.hidden = true;
  }
}

function toggleViews(isAuthenticated) {
  elements.loginView.hidden = isAuthenticated;
  elements.dashboardView.hidden = !isAuthenticated;
  elements.logoutButton.hidden = !isAuthenticated;
  if (!isAuthenticated) {
    elements.currentUser.textContent = '로그인 필요';
  }
}

async function ensureSeeded() {
  if (!state.user || state.seeded) return;
  state.seeded = true;
  try {
    const [members, projects, publications] = await Promise.all([
      fetchCollection(COLLECTIONS.members),
      fetchCollection(COLLECTIONS.projects),
      fetchCollection(COLLECTIONS.publications)
    ]);

    const seedMissing = async (collectionName, existingItems, fallbackItems, normalizer, keyGetter) => {
      const seen = new Set(existingItems.map((item) => keyGetter(normalizer(item))).filter(Boolean));
      for (const item of fallbackItems) {
        const normalized = normalizer(item);
        const key = keyGetter(normalized);
        if (!key || seen.has(key)) continue;
        await saveDocument(collectionName, normalized.id, normalized);
        seen.add(key);
      }
    };

    await seedMissing(COLLECTIONS.members, members, FALLBACK_MEMBERS, normalizeMember, memberSemanticKey);
    await seedMissing(COLLECTIONS.projects, projects, FALLBACK_PROJECTS, normalizeProject, projectSemanticKey);
    await seedMissing(COLLECTIONS.publications, publications, FALLBACK_PUBLICATIONS, normalizePublication, publicationSemanticKey);
  } catch (error) {
    console.error(error);
    showNotice('기본 데이터 동기화 중 오류가 발생했습니다.', 'warning');
  }
}

function attachListeners() {
  teardownListeners();
  state.unsubs = [
    listenCollection(COLLECTIONS.members, (items) => {
      state.members = sortMembers(mergeMembers(FALLBACK_MEMBERS, items));
      renderMembersList();
      renderSummary();
    }),
    listenCollection(COLLECTIONS.projects, (items) => {
      state.projects = sortProjects(mergeProjects(FALLBACK_PROJECTS, items));
      renderProjectsList();
      renderSummary();
    }),
    listenCollection(COLLECTIONS.publications, (items) => {
      state.publications = sortPublications(mergePublications(FALLBACK_PUBLICATIONS, items));
      renderPublicationsList();
      renderSummary();
    })
  ];
}

function teardownListeners() {
  state.unsubs.forEach((unsub) => {
    try { unsub(); } catch {}
  });
  state.unsubs = [];
}

function renderSummary() {
  elements.summaryMembers.textContent = state.members.length;
  elements.summaryProjects.textContent = state.projects.length;
  elements.summaryPublications.textContent = state.publications.length;
}

function setActiveTab(tabName) {
  elements.tabButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.adminTab === tabName));
  elements.panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tabName;
  });
}

function onMemberPhotoChange(event) {
  const [file] = event.currentTarget.files || [];
  state.pendingMemberFile = file || null;
  if (state.pendingMemberPreview) URL.revokeObjectURL(state.pendingMemberPreview);
  state.pendingMemberPreview = file ? URL.createObjectURL(file) : '';
  renderMemberPhotoPreview();
}

function clearMemberPhoto() {
  state.pendingMemberFile = null;
  if (state.pendingMemberPreview) URL.revokeObjectURL(state.pendingMemberPreview);
  state.pendingMemberPreview = '';
  if (elements.memberPhotoInput) elements.memberPhotoInput.value = '';
  if (state.editingMember) {
    state.editingMember.photoUrl = '';
  }
  renderMemberPhotoPreview();
}

function renderMemberPhotoPreview() {
  const url = state.pendingMemberPreview || state.editingMember?.photoUrl || '';
  elements.memberPhotoPreview.innerHTML = url
    ? `<img src="${escapeHTML(rootAsset(url, root))}" alt="preview">`
    : `<span>${escapeHTML(getInitials(state.editingMember?.name || 'GEH'))}</span>`;
}

function resetMemberForm() {
  elements.memberForm?.reset();
  state.editingMember = null;
  state.pendingMemberFile = null;
  if (state.pendingMemberPreview) URL.revokeObjectURL(state.pendingMemberPreview);
  state.pendingMemberPreview = '';
  elements.memberTitle.textContent = '멤버 추가';
  if (elements.memberPhotoInput) elements.memberPhotoInput.value = '';
  renderMemberPhotoPreview();
}

function resetProjectForm() {
  elements.projectForm?.reset();
  state.editingProject = null;
  elements.projectTitle.textContent = '과제 추가';
}

function resetPublicationForm() {
  elements.publicationForm?.reset();
  state.editingPublication = null;
  elements.publicationTitle.textContent = '논문 추가';
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = {
    name: String(formData.get('name') || '').trim(),
    group: String(formData.get('group') || 'graduateStudent'),
    track: String(formData.get('track') || 'none'),
    course: String(formData.get('course') || 'ms'),
    email: String(formData.get('email') || '').trim(),
    bio: String(formData.get('bio') || '').trim(),
    education: String(formData.get('education') || '').trim(),
    experience: String(formData.get('experience') || '').trim(),
    researchInterest: String(formData.get('researchInterest') || '').trim(),
    currentPosition: String(formData.get('currentPosition') || '').trim(),
    status: String(formData.get('status') || 'enrolled'),
    graduationYear: String(formData.get('graduationYear') || '').trim(),
    sortOrder: Number(formData.get('sortOrder') || 999),
    photoUrl: state.editingMember?.photoUrl || '',
    photoPath: state.editingMember?.photoPath || ''
  };
  if (!payload.name) {
    showNotice('이름을 입력해주세요.', 'warning');
    return;
  }
  try {
    if (state.pendingMemberFile) {
      const upload = await uploadMemberPhoto(state.pendingMemberFile);
      if (state.editingMember?.photoPath && state.editingMember.photoPath !== upload.photoPath) {
        try { await deleteMemberPhoto(state.editingMember.photoPath); } catch {}
      }
      payload.photoUrl = upload.photoUrl;
      payload.photoPath = upload.photoPath;
    }
    if (payload.status !== 'alumni') {
      payload.graduationYear = '';
      payload.currentPosition = payload.currentPosition;
    }
    await saveDocument(COLLECTIONS.members, state.editingMember?.id || null, payload);
    showNotice('멤버 정보가 저장되었습니다.', 'success');
    resetMemberForm();
  } catch (error) {
    console.error(error);
    showNotice(error.message || '멤버 저장에 실패했습니다.', 'danger');
  }
}

async function handleProjectSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = {
    title: String(formData.get('title') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    status: String(formData.get('status') || 'ongoing'),
    period: String(formData.get('period') || '').trim(),
    year: String(formData.get('year') || '').trim(),
    tags: String(formData.get('tags') || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    sortOrder: Number(formData.get('sortOrder') || 999)
  };
  if (!payload.title) {
    showNotice('과제 제목을 입력해주세요.', 'warning');
    return;
  }
  try {
    await saveDocument(COLLECTIONS.projects, state.editingProject?.id || null, payload);
    showNotice('과제 정보가 저장되었습니다.', 'success');
    resetProjectForm();
  } catch (error) {
    console.error(error);
    showNotice(error.message || '과제 저장에 실패했습니다.', 'danger');
  }
}

async function handlePublicationSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = {
    title: String(formData.get('title') || '').trim(),
    authors: String(formData.get('authors') || '').trim(),
    journal: String(formData.get('journal') || '').trim(),
    year: String(formData.get('year') || '').trim(),
    doi: String(formData.get('doi') || '').trim(),
    url: String(formData.get('url') || '').trim(),
    abstract: String(formData.get('abstract') || '').trim(),
    sortOrder: Number(formData.get('sortOrder') || 999)
  };
  if (!payload.title) {
    showNotice('논문 제목을 입력해주세요.', 'warning');
    return;
  }
  try {
    await saveDocument(COLLECTIONS.publications, state.editingPublication?.id || null, payload);
    showNotice('논문 정보가 저장되었습니다.', 'success');
    resetPublicationForm();
  } catch (error) {
    console.error(error);
    showNotice(error.message || '논문 저장에 실패했습니다.', 'danger');
  }
}

function renderAllLists() {
  renderMembersList();
  renderProjectsList();
  renderPublicationsList();
  renderSummary();
  renderMemberPhotoPreview();
}

function renderMembersList() {
  if (!elements.memberList) return;
  if (!state.members.length) {
    elements.memberList.innerHTML = `<div class="admin-empty">저장된 멤버가 없습니다.</div>`;
    return;
  }
  elements.memberList.innerHTML = state.members
    .map((member) => `
      <article class="admin-item-card">
        <div class="admin-item-main">
          <div class="admin-item-thumb">${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}</div>
          <div>
            <div class="card-topline">
              <strong>${escapeHTML(member.name)}</strong>
              <span class="status-badge ${member.status === 'alumni' ? 'is-alumni' : ''}">${escapeHTML(memberStatusLabel(member, 'kr'))}</span>
            </div>
            <p class="muted">${escapeHTML([member.group === 'pi' ? '연구책임자' : member.group === 'researchProfessor' ? '연구교수' : member.group === 'studentResearcher' ? '학생연구원' : member.group === 'alumni' ? '졸업생' : '대학원생', memberTrackLabel(member.track, 'kr'), memberCourseLabel(member.course, 'kr')].filter(Boolean).join(' · '))}</p>
            ${member.email ? `<p>${escapeHTML(member.email)}</p>` : ''}
            ${member.currentPosition ? `<p>${escapeHTML(member.currentPosition)}</p>` : member.researchInterest ? `<p>${escapeHTML(member.researchInterest)}</p>` : ''}
            ${member.graduationYear ? `<p class="muted">졸업 연도 · ${escapeHTML(member.graduationYear)}</p>` : ''}
          </div>
        </div>
        <div class="admin-item-actions">
          <button type="button" class="small-button" data-member-action="edit" data-id="${escapeHTML(member.id)}">수정</button>
          ${member.status === 'alumni' ? `<button type="button" class="small-button" data-member-action="restore" data-id="${escapeHTML(member.id)}">재학 전환</button>` : `<button type="button" class="small-button" data-member-action="graduate" data-id="${escapeHTML(member.id)}">졸업 처리</button>`}
          <button type="button" class="small-button is-danger" data-member-action="delete" data-id="${escapeHTML(member.id)}">삭제</button>
        </div>
      </article>
    `)
    .join('');
}

function renderProjectsList() {
  if (!elements.projectList) return;
  if (!state.projects.length) {
    elements.projectList.innerHTML = `<div class="admin-empty">저장된 과제가 없습니다.</div>`;
    return;
  }
  const ongoing = state.projects.filter((item) => item.status === 'ongoing');
  const completed = state.projects.filter((item) => item.status === 'completed');
  elements.projectList.innerHTML = [
    adminSection('진행 중', ongoing.map(projectItemMarkup).join('') || `<div class="admin-empty">없음</div>`),
    adminSection('종료', completed.map(projectItemMarkup).join('') || `<div class="admin-empty">없음</div>`)
  ].join('');
}

function renderPublicationsList() {
  if (!elements.publicationList) return;
  if (!state.publications.length) {
    elements.publicationList.innerHTML = `<div class="admin-empty">저장된 논문이 없습니다.</div>`;
    return;
  }
  const grouped = {};
  state.publications.forEach((item) => {
    const year = item.year || '기타';
    if (!grouped[year]) grouped[year] = [];
    grouped[year].push(item);
  });
  elements.publicationList.innerHTML = Object.entries(grouped)
    .sort((a, b) => Number(b[0].match(/\d{4}/)?.[0] || 0) - Number(a[0].match(/\d{4}/)?.[0] || 0))
    .map(([year, items]) => adminSection(year, items.map(publicationItemMarkup).join('')))
    .join('');
}

function adminSection(title, content) {
  return `<section class="admin-list-section"><h3>${escapeHTML(title)}</h3>${content}</section>`;
}

function projectItemMarkup(project) {
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div>
          <div class="card-topline">
            <strong>${escapeHTML(project.title)}</strong>
            <span class="status-badge ${project.status === 'completed' ? 'is-alumni' : ''}">${escapeHTML(projectStatusLabel(project.status, 'kr'))}</span>
          </div>
          ${project.period ? `<p class="muted">기간 · ${escapeHTML(project.period)}</p>` : ''}
          ${project.description ? `<p>${escapeHTML(project.description)}</p>` : ''}
        </div>
      </div>
      <div class="admin-item-actions">
        <button type="button" class="small-button" data-project-action="edit" data-id="${escapeHTML(project.id)}">수정</button>
        <button type="button" class="small-button is-danger" data-project-action="delete" data-id="${escapeHTML(project.id)}">삭제</button>
      </div>
    </article>
  `;
}

function publicationItemMarkup(item) {
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div>
          <div class="card-topline"><strong>${escapeHTML(item.title)}</strong></div>
          <p class="muted">${escapeHTML(item.authors)}</p>
          <p>${escapeHTML(item.journal)}${item.doi ? ` · ${escapeHTML(item.doi)}` : ''}</p>
        </div>
      </div>
      <div class="admin-item-actions">
        <button type="button" class="small-button" data-publication-action="edit" data-id="${escapeHTML(item.id)}">수정</button>
        <button type="button" class="small-button is-danger" data-publication-action="delete" data-id="${escapeHTML(item.id)}">삭제</button>
      </div>
    </article>
  `;
}

function onMemberListClick(event) {
  const button = event.target.closest('[data-member-action]');
  if (!button) return;
  const action = button.dataset.memberAction;
  const member = state.members.find((item) => item.id === button.dataset.id);
  if (!member) return;
  if (action === 'edit') return loadMemberForm(member);
  if (action === 'graduate') return quickGraduate(member);
  if (action === 'restore') return quickRestore(member);
  if (action === 'delete') return removeMember(member);
}

function onProjectListClick(event) {
  const button = event.target.closest('[data-project-action]');
  if (!button) return;
  const project = state.projects.find((item) => item.id === button.dataset.id);
  if (!project) return;
  if (button.dataset.projectAction === 'edit') return loadProjectForm(project);
  if (button.dataset.projectAction === 'delete') return removeProject(project);
}

function onPublicationListClick(event) {
  const button = event.target.closest('[data-publication-action]');
  if (!button) return;
  const item = state.publications.find((pub) => pub.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.publicationAction === 'edit') return loadPublicationForm(item);
  if (button.dataset.publicationAction === 'delete') return removePublication(item);
}

function loadMemberForm(member) {
  state.editingMember = member;
  elements.memberTitle.textContent = '멤버 수정';
  const form = elements.memberForm;
  form.name.value = member.name || '';
  form.group.value = member.group || 'graduateStudent';
  form.track.value = member.track || 'none';
  form.course.value = member.course || 'ms';
  form.email.value = member.email || '';
  form.bio.value = member.bio || '';
  form.education.value = member.education || '';
  form.experience.value = member.experience || '';
  form.researchInterest.value = member.researchInterest || '';
  form.currentPosition.value = member.currentPosition || '';
  form.status.value = member.status || 'enrolled';
  form.graduationYear.value = member.graduationYear || '';
  form.sortOrder.value = member.sortOrder || '';
  renderMemberPhotoPreview();
}

function loadProjectForm(project) {
  state.editingProject = project;
  elements.projectTitle.textContent = '과제 수정';
  const form = elements.projectForm;
  form.title.value = project.title || '';
  form.description.value = project.description || '';
  form.status.value = project.status || 'ongoing';
  form.period.value = project.period || '';
  form.year.value = project.year || '';
  form.tags.value = (project.tags || []).join(', ');
  form.sortOrder.value = project.sortOrder || '';
}

function loadPublicationForm(item) {
  state.editingPublication = item;
  elements.publicationTitle.textContent = '논문 수정';
  const form = elements.publicationForm;
  form.title.value = item.title || '';
  form.authors.value = item.authors || '';
  form.journal.value = item.journal || '';
  form.year.value = item.year || '';
  form.doi.value = item.doi || '';
  form.url.value = item.url || '';
  form.abstract.value = item.abstract || '';
  form.sortOrder.value = item.sortOrder || '';
}

async function quickGraduate(member) {
  const year = window.prompt('졸업 연도를 입력하세요.', member.graduationYear || new Date().getFullYear().toString());
  if (year === null) return;
  const currentPosition = window.prompt('현재 진로 / 소속을 입력하세요.', member.currentPosition || '');
  if (currentPosition === null) return;
  await saveDocument(COLLECTIONS.members, member.id, { ...member, status: 'alumni', graduationYear: year, currentPosition });
  showNotice('졸업 처리되었습니다.', 'success');
}

async function quickRestore(member) {
  await saveDocument(COLLECTIONS.members, member.id, { ...member, status: 'enrolled', graduationYear: '' });
  showNotice('재학 상태로 변경되었습니다.', 'success');
}

async function removeMember(member) {
  if (!window.confirm(`${member.name} 멤버를 삭제할까요?`)) return;
  if (member.photoPath) {
    try { await deleteMemberPhoto(member.photoPath); } catch {}
  }
  await deleteDocumentById(COLLECTIONS.members, member.id);
  showNotice('멤버가 삭제되었습니다.', 'success');
}

async function removeProject(project) {
  if (!window.confirm(`${project.title} 과제를 삭제할까요?`)) return;
  await deleteDocumentById(COLLECTIONS.projects, project.id);
  showNotice('과제가 삭제되었습니다.', 'success');
}

async function removePublication(item) {
  if (!window.confirm(`${item.title} 논문을 삭제할까요?`)) return;
  await deleteDocumentById(COLLECTIONS.publications, item.id);
  showNotice('논문이 삭제되었습니다.', 'success');
}

function showNotice(message, tone = 'info') {
  const target = qs('#notice-area');
  if (!target) return;
  target.textContent = message;
  target.className = `notice-banner is-${tone}`;
  target.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    target.hidden = true;
  }, 3600);
}
