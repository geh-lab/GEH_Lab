import { FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS, FALLBACK_BOARD_POSTS } from './data.js';
import {
  escapeHTML,
  getInitials,
  normalizeMember,
  normalizeProject,
  normalizePublication,
  normalizeBoardPost,
  sortMembers,
  sortProjects,
  sortPublications,
  sortBoardPosts,
  memberStatusLabel,
  memberCourseLabel,
  memberTrackLabel,
  memberGroupLabel,
  projectStatusLabel,
  rootAsset,
  mergeMembers,
  mergeProjects,
  mergePublications,
  mergeBoardPosts,
  memberSemanticKey,
  projectSemanticKey,
  publicationSemanticKey,
  boardSemanticKey,
  memberYearLabel,
  publicationIndexingLabel
} from './utils.js';
import {
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
  uploadProjectFigure,
  uploadBoardImage,
  deleteStoragePath
} from './firebase.js';

const state = {
  user: null,
  members: sortMembers(FALLBACK_MEMBERS),
  projects: sortProjects(FALLBACK_PROJECTS),
  publications: sortPublications(FALLBACK_PUBLICATIONS),
  board: sortBoardPosts(FALLBACK_BOARD_POSTS),
  editingMember: null,
  editingProject: null,
  editingPublication: null,
  editingBoard: null,
  pendingMemberFile: null,
  pendingMemberPreview: '',
  pendingProjectFile: null,
  pendingProjectPreview: '',
  pendingBoardFile: null,
  pendingBoardPreview: '',
  seeded: false,
  unsubs: [],
  authResolved: false,
  activeTab: 'members',
  memberFilter: 'pi',
  projectFilter: 'all',
  publicationFilter: 'all',
  boardFilter: 'all'
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
  memberFilterTabs: qs('#member-filter-tabs'),
  projectForm: qs('#project-form'),
  projectList: qs('#project-list'),
  projectTitle: qs('#project-form-title'),
  projectFilterTabs: qs('#project-filter-tabs'),
  projectFigureInput: qs('#project-figure-input'),
  projectFigurePreview: qs('#project-figure-preview'),
  projectFigureRemove: qs('#project-figure-remove'),
  publicationForm: qs('#publication-form'),
  publicationList: qs('#publication-list'),
  publicationTitle: qs('#publication-form-title'),
  publicationFilterTabs: qs('#publication-filter-tabs'),
  boardForm: qs('#board-form'),
  boardList: qs('#board-list'),
  boardTitle: qs('#board-form-title'),
  boardFilterTabs: qs('#board-filter-tabs'),
  boardImageInput: qs('#board-image-input'),
  boardImagePreview: qs('#board-image-preview'),
  boardImageRemove: qs('#board-image-remove'),
  summaryMembers: qs('#summary-members'),
  summaryProjects: qs('#summary-projects'),
  summaryPublications: qs('#summary-publications'),
  summaryBoard: qs('#summary-board')
};

function setTopbarAuthState(isAuthenticated, email = '') {
  if (elements.currentUser) {
    elements.currentUser.textContent = isAuthenticated ? (email || '관리자') : '로그인 필요';
    elements.currentUser.classList.toggle('is-authenticated', Boolean(isAuthenticated));
  }
  if (elements.logoutButton) {
    elements.logoutButton.hidden = !isAuthenticated;
    elements.logoutButton.style.display = isAuthenticated ? 'inline-flex' : 'none';
    elements.logoutButton.setAttribute('aria-hidden', String(!isAuthenticated));
  }
}

function setFormValue(form, fieldName, value) {
  const field = form?.elements?.namedItem(fieldName);
  if (field) field.value = value ?? '';
}

function numericYearSort(value) {
  return Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  renderSetupMessage();
  renderAllLists();
  setTopbarAuthState(false);
  togglePending(true);

  if (!hasFirebaseConfig) {
    togglePending(false);
    toggleViews(false);
    return;
  }

  let fallbackTimer = window.setTimeout(() => {
    if (!state.authResolved) handleAuthState(auth?.currentUser || null);
  }, 900);

  try {
    const redirectCredential = await resolveRedirectResult();
    if (redirectCredential?.user) {
      await handleAuthState(redirectCredential.user);
    }
  } catch (error) {
    showNotice(error.message || 'Google 로그인 처리 중 오류가 발생했습니다.', 'danger');
  }

  if (auth?.currentUser) {
    await handleAuthState(auth.currentUser);
  }

  watchAdminState(async (user) => {
    window.clearTimeout(fallbackTimer);
    await handleAuthState(user);
  });
});

function bindEvents() {
  elements.googleLoginButton?.addEventListener('click', handleGoogleLogin);
  elements.logoutButton?.addEventListener('click', async () => {
    if (!state.user) {
      await handleAuthState(null);
      return;
    }
    await signOutAdmin();
    await handleAuthState(null);
  });
  elements.tabButtons.forEach((button) => button.addEventListener('click', () => setActiveTab(button.dataset.adminTab)));
  elements.memberFilterTabs?.addEventListener('click', onMemberFilterClick);
  elements.projectFilterTabs?.addEventListener('click', onProjectFilterClick);
  elements.publicationFilterTabs?.addEventListener('click', onPublicationFilterClick);
  elements.boardFilterTabs?.addEventListener('click', onBoardFilterClick);
  elements.memberForm?.addEventListener('submit', handleMemberSubmit);
  elements.projectForm?.addEventListener('submit', handleProjectSubmit);
  elements.publicationForm?.addEventListener('submit', handlePublicationSubmit);
  elements.boardForm?.addEventListener('submit', handleBoardSubmit);
  elements.memberPhotoInput?.addEventListener('change', onMemberPhotoChange);
  elements.memberPhotoRemove?.addEventListener('click', clearMemberPhoto);
  elements.projectFigureInput?.addEventListener('change', onProjectFigureChange);
  elements.projectFigureRemove?.addEventListener('click', clearProjectFigure);
  elements.boardImageInput?.addEventListener('change', onBoardImageChange);
  elements.boardImageRemove?.addEventListener('click', clearBoardImage);
  qs('#member-reset')?.addEventListener('click', resetMemberForm);
  qs('#project-reset')?.addEventListener('click', resetProjectForm);
  qs('#publication-reset')?.addEventListener('click', resetPublicationForm);
  qs('#board-reset')?.addEventListener('click', resetBoardForm);
  elements.memberList?.addEventListener('click', onMemberListClick);
  elements.projectList?.addEventListener('click', onProjectListClick);
  elements.publicationList?.addEventListener('click', onPublicationListClick);
  elements.boardList?.addEventListener('click', onBoardListClick);
}

function renderSetupMessage() {
  if (!elements.authNotice) return;
  if (!hasFirebaseConfig) {
    elements.authNotice.hidden = false;
    elements.authNotice.textContent = 'firebase-config.js 설정을 입력하면 Google 로그인과 관리자 저장 기능이 활성화됩니다.';
    return;
  }
  elements.authNotice.textContent = '';
  elements.authNotice.hidden = true;
}

async function handleGoogleLogin() {
  if (!hasFirebaseConfig) {
    showNotice('먼저 firebase-config.js를 채워주세요.', 'warning');
    return;
  }
  elements.googleLoginButton?.setAttribute('disabled', 'disabled');
  showNotice('Google 로그인 페이지로 이동합니다.', 'info');
  try {
    await signInAdminWithGoogle();
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
  setTopbarAuthState(Boolean(user), user?.email || '');
  if (!user) {
    teardownListeners();
    state.seeded = false;
    return;
  }
  await ensureSeeded();
  attachListeners();
  setActiveTab(state.activeTab || 'members');
  if (previousUid !== user.uid) showNotice(`${user.email} 계정으로 로그인되었습니다.`, 'success');
}

function togglePending(isPending) {
  if (elements.authLoading) elements.authLoading.hidden = !isPending;
  if (isPending) {
    elements.loginView.hidden = true;
    elements.dashboardView.hidden = true;
    setTopbarAuthState(false);
  }
}

function toggleViews(isAuthenticated) {
  if (elements.loginView) elements.loginView.hidden = isAuthenticated;
  if (elements.dashboardView) elements.dashboardView.hidden = !isAuthenticated;
  setTopbarAuthState(isAuthenticated, state.user?.email || '');
}

async function ensureSeeded() {
  if (!state.user || state.seeded) return;
  state.seeded = true;
  try {
    const [members, projects, publications, board] = await Promise.all([
      fetchCollection(COLLECTIONS.members),
      fetchCollection(COLLECTIONS.projects),
      fetchCollection(COLLECTIONS.publications),
      fetchCollection(COLLECTIONS.board)
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
    await seedMissing(COLLECTIONS.board, board, FALLBACK_BOARD_POSTS, normalizeBoardPost, boardSemanticKey);
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
    }),
    listenCollection(COLLECTIONS.board, (items) => {
      state.board = sortBoardPosts(mergeBoardPosts(FALLBACK_BOARD_POSTS, items));
      renderBoardList();
      renderSummary();
    })
  ];
}

function teardownListeners() {
  state.unsubs.forEach((unsub) => { try { unsub(); } catch {} });
  state.unsubs = [];
}

function renderSummary() {
  if (elements.summaryMembers) elements.summaryMembers.textContent = state.members.length;
  if (elements.summaryProjects) elements.summaryProjects.textContent = state.projects.length;
  if (elements.summaryPublications) elements.summaryPublications.textContent = state.publications.length;
  if (elements.summaryBoard) elements.summaryBoard.textContent = state.board.length;
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  elements.tabButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.adminTab === tabName));
  elements.panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== tabName; });
}

function onMemberFilterClick(event) {
  const button = event.target.closest('[data-member-filter]');
  if (!button) return;
  state.memberFilter = button.dataset.memberFilter;
  renderMembersList();
}
function onProjectFilterClick(event) {
  const button = event.target.closest('[data-project-filter]');
  if (!button) return;
  state.projectFilter = button.dataset.projectFilter;
  renderProjectsList();
}
function onPublicationFilterClick(event) {
  const button = event.target.closest('[data-publication-filter]');
  if (!button) return;
  state.publicationFilter = button.dataset.publicationFilter;
  renderPublicationsList();
}
function onBoardFilterClick(event) {
  const button = event.target.closest('[data-board-filter]');
  if (!button) return;
  state.boardFilter = button.dataset.boardFilter;
  renderBoardList();
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
  if (state.editingMember) state.editingMember.photoUrl = '';
  renderMemberPhotoPreview();
}
function renderMemberPhotoPreview() {
  const url = state.pendingMemberPreview || state.editingMember?.photoUrl || '';
  if (!elements.memberPhotoPreview) return;
  elements.memberPhotoPreview.innerHTML = url ? `<img src="${escapeHTML(rootAsset(url, root))}" alt="preview">` : `<span>${escapeHTML(getInitials(state.editingMember?.name || 'GEH'))}</span>`;
}

function onProjectFigureChange(event) {
  const [file] = event.currentTarget.files || [];
  state.pendingProjectFile = file || null;
  if (state.pendingProjectPreview) URL.revokeObjectURL(state.pendingProjectPreview);
  state.pendingProjectPreview = file ? URL.createObjectURL(file) : '';
  renderProjectFigurePreview();
}
function clearProjectFigure() {
  state.pendingProjectFile = null;
  if (state.pendingProjectPreview) URL.revokeObjectURL(state.pendingProjectPreview);
  state.pendingProjectPreview = '';
  if (elements.projectFigureInput) elements.projectFigureInput.value = '';
  if (state.editingProject) state.editingProject.figureUrl = '';
  renderProjectFigurePreview();
}
function renderProjectFigurePreview() {
  const url = state.pendingProjectPreview || state.editingProject?.figureUrl || '';
  if (!elements.projectFigurePreview) return;
  elements.projectFigurePreview.innerHTML = url ? `<img src="${escapeHTML(rootAsset(url, root))}" alt="preview">` : `<span>16:9</span>`;
}

function onBoardImageChange(event) {
  const [file] = event.currentTarget.files || [];
  state.pendingBoardFile = file || null;
  if (state.pendingBoardPreview) URL.revokeObjectURL(state.pendingBoardPreview);
  state.pendingBoardPreview = file ? URL.createObjectURL(file) : '';
  renderBoardImagePreview();
}
function clearBoardImage() {
  state.pendingBoardFile = null;
  if (state.pendingBoardPreview) URL.revokeObjectURL(state.pendingBoardPreview);
  state.pendingBoardPreview = '';
  if (elements.boardImageInput) elements.boardImageInput.value = '';
  if (state.editingBoard) state.editingBoard.imageUrl = '';
  renderBoardImagePreview();
}
function renderBoardImagePreview() {
  const url = state.pendingBoardPreview || state.editingBoard?.imageUrl || '';
  if (!elements.boardImagePreview) return;
  elements.boardImagePreview.innerHTML = url ? `<img src="${escapeHTML(rootAsset(url, root))}" alt="preview">` : `<span>Board</span>`;
}

function resetMemberForm() {
  elements.memberForm?.reset();
  state.editingMember = null;
  state.pendingMemberFile = null;
  if (state.pendingMemberPreview) URL.revokeObjectURL(state.pendingMemberPreview);
  state.pendingMemberPreview = '';
  if (elements.memberTitle) elements.memberTitle.textContent = '멤버 추가';
  if (elements.memberPhotoInput) elements.memberPhotoInput.value = '';
  renderMemberPhotoPreview();
}
function resetProjectForm() {
  elements.projectForm?.reset();
  state.editingProject = null;
  state.pendingProjectFile = null;
  if (state.pendingProjectPreview) URL.revokeObjectURL(state.pendingProjectPreview);
  state.pendingProjectPreview = '';
  if (elements.projectTitle) elements.projectTitle.textContent = '과제 추가';
  renderProjectFigurePreview();
}
function resetPublicationForm() {
  elements.publicationForm?.reset();
  state.editingPublication = null;
  if (elements.publicationTitle) elements.publicationTitle.textContent = '논문 추가';
}
function resetBoardForm() {
  elements.boardForm?.reset();
  state.editingBoard = null;
  state.pendingBoardFile = null;
  if (state.pendingBoardPreview) URL.revokeObjectURL(state.pendingBoardPreview);
  state.pendingBoardPreview = '';
  if (elements.boardTitle) elements.boardTitle.textContent = '게시글 추가';
  renderBoardImagePreview();
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
    coursesInfo: String(formData.get('coursesInfo') || '').trim(),
    relatedProjects: String(formData.get('relatedProjects') || '').trim(),
    authorshipNote: String(formData.get('authorshipNote') || '').trim(),
    currentPosition: String(formData.get('currentPosition') || '').trim(),
    status: String(formData.get('status') || 'enrolled'),
    graduationYear: String(formData.get('graduationYear') || '').trim(),
    startYear: String(formData.get('startYear') || '').trim(),
    sortOrder: state.editingMember?.sortOrder ?? 999,
    photoUrl: state.editingMember?.photoUrl || '',
    photoPath: state.editingMember?.photoPath || ''
  };
  if (!payload.name) return showNotice('이름을 입력해주세요.', 'warning');
  try {
    if (state.pendingMemberFile) {
      const upload = await uploadMemberPhoto(state.pendingMemberFile);
      if (state.editingMember?.photoPath && state.editingMember.photoPath !== upload.photoPath) {
        try { await deleteStoragePath(state.editingMember.photoPath); } catch {}
      }
      payload.photoUrl = upload.photoUrl;
      payload.photoPath = upload.photoPath;
    }
    if (payload.status !== 'alumni') payload.graduationYear = '';
    await saveDocument(COLLECTIONS.members, state.editingMember?.id || null, payload);
    showNotice('멤버 정보가 저장되었습니다.', 'success');
    resetMemberForm();
  } catch (error) {
    console.error(error);
    showNotice(error.message || '멤버 저장에 실패했습니다.', 'danger');
  }
}

function extractYearFromPeriod(period = '') {
  const years = String(period || '').match(/(?:19|20)\d{2}/g);
  return years?.length ? years[years.length - 1] : '';
}

async function handleProjectSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const period = String(formData.get('period') || '').trim();
  const payload = {
    title: String(formData.get('title') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    status: String(formData.get('status') || 'ongoing'),
    period,
    year: extractYearFromPeriod(period),
    principalInvestigator: String(formData.get('principalInvestigator') || '').trim(),
    coResearchers: String(formData.get('coResearchers') || '').trim(),
    figureUrl: state.editingProject?.figureUrl || '',
    figurePath: state.editingProject?.figurePath || '',
    figureAspect: String(formData.get('figureAspect') || '16:9'),
    tags: String(formData.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    sortOrder: state.editingProject?.sortOrder ?? 999
  };
  if (!payload.title) return showNotice('과제 제목을 입력해주세요.', 'warning');
  try {
    if (state.pendingProjectFile) {
      const upload = await uploadProjectFigure(state.pendingProjectFile);
      if (state.editingProject?.figurePath && state.editingProject.figurePath !== upload.figurePath) {
        try { await deleteStoragePath(state.editingProject.figurePath); } catch {}
      }
      payload.figureUrl = upload.figureUrl;
      payload.figurePath = upload.figurePath;
    }
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
    month: String(formData.get('month') || '').trim(),
    doi: String(formData.get('doi') || '').trim(),
    url: String(formData.get('url') || '').trim(),
    abstract: String(formData.get('abstract') || '').trim(),
    indexing: String(formData.get('indexing') || '').trim(),
    sortOrder: state.editingPublication?.sortOrder ?? 999
  };
  if (!payload.title) return showNotice('논문 제목을 입력해주세요.', 'warning');
  try {
    await saveDocument(COLLECTIONS.publications, state.editingPublication?.id || null, payload);
    showNotice('논문 정보가 저장되었습니다.', 'success');
    resetPublicationForm();
  } catch (error) {
    console.error(error);
    showNotice(error.message || '논문 저장에 실패했습니다.', 'danger');
  }
}

async function handleBoardSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = {
    category: String(formData.get('category') || 'notice'),
    title: String(formData.get('title') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    linkUrl: String(formData.get('linkUrl') || '').trim(),
    imageUrl: state.editingBoard?.imageUrl || '',
    imagePath: state.editingBoard?.imagePath || '',
    date: String(formData.get('date') || '').trim()
  };
  if (!payload.title) return showNotice('게시글 제목을 입력해주세요.', 'warning');
  try {
    if (state.pendingBoardFile) {
      const upload = await uploadBoardImage(state.pendingBoardFile);
      if (state.editingBoard?.imagePath && state.editingBoard.imagePath !== upload.imagePath) {
        try { await deleteStoragePath(state.editingBoard.imagePath); } catch {}
      }
      payload.imageUrl = upload.imageUrl;
      payload.imagePath = upload.imagePath;
    }
    await saveDocument(COLLECTIONS.board, state.editingBoard?.id || null, payload);
    showNotice('게시글이 저장되었습니다.', 'success');
    resetBoardForm();
  } catch (error) {
    console.error(error);
    showNotice(error.message || '게시글 저장에 실패했습니다.', 'danger');
  }
}

function renderAllLists() {
  renderMembersList();
  renderProjectsList();
  renderPublicationsList();
  renderBoardList();
  renderSummary();
  renderMemberPhotoPreview();
  renderProjectFigurePreview();
  renderBoardImagePreview();
}

function renderMemberFilterTabs() {
  const filters = [
    ['pi', '연구책임자 · 교수'],
    ['research', '연구교수 · 박사후연구원'],
    ['phd', '박사과정'],
    ['ms', '석사과정'],
    ['undergrad', '학부연구생'],
    ['alumni', '졸업생']
  ];
  elements.memberFilterTabs.innerHTML = filters.map(([value, label]) => `
    <button type="button" class="admin-subtab${state.memberFilter === value ? ' is-active' : ''}" data-member-filter="${escapeHTML(value)}">${escapeHTML(label)}</button>
  `).join('');
}

function memberItemMarkup(member) {
  const detailBits = [
    memberGroupLabel(member.group, 'kr'),
    member.group === 'graduateStudent' ? memberCourseLabel(member.course, 'kr') : '',
    member.track && member.track !== 'none' ? memberTrackLabel(member.track, 'kr') : '',
    memberYearLabel(member, 'kr')
  ].filter(Boolean).join(' · ');
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div class="admin-item-thumb">${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}</div>
        <div>
          <div class="card-topline">
            <strong>${escapeHTML(member.name)}</strong>
            <span class="status-badge ${member.status === 'alumni' ? 'is-alumni' : ''}">${escapeHTML(memberStatusLabel(member, 'kr'))}</span>
          </div>
          ${detailBits ? `<p class="muted">${escapeHTML(detailBits)}</p>` : ''}
          ${member.email ? `<p>${escapeHTML(member.email)}</p>` : ''}
          ${member.currentPosition ? `<p>${escapeHTML(member.currentPosition)}</p>` : member.researchInterest ? `<p>${escapeHTML(member.researchInterest)}</p>` : ''}
        </div>
      </div>
      <div class="admin-item-actions">
        <button type="button" class="small-button" data-member-action="edit" data-id="${escapeHTML(member.id)}">수정</button>
        ${member.status === 'alumni' ? `<button type="button" class="small-button" data-member-action="restore" data-id="${escapeHTML(member.id)}">재학전환</button>` : `<button type="button" class="small-button" data-member-action="graduate" data-id="${escapeHTML(member.id)}">졸업처리</button>`}
        <button type="button" class="small-button is-danger" data-member-action="delete" data-id="${escapeHTML(member.id)}">삭제</button>
      </div>
    </article>
  `;
}

function renderMembersList() {
  if (!elements.memberList) return;
  renderMemberFilterTabs();
  const enrolled = state.members.filter((item) => item.status !== 'alumni');
  const alumni = state.members.filter((item) => item.status === 'alumni');
  let sections = [];
  if (state.memberFilter === 'pi') {
    const items = enrolled.filter((item) => item.group === 'pi');
    sections.push(adminSection(`연구책임자 · 교수 (${items.length})`, items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
  } else if (state.memberFilter === 'research') {
    const items = enrolled.filter((item) => item.group === 'researchProfessor');
    sections.push(adminSection(`연구교수 · 박사후연구원 (${items.length})`, items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
  } else if (state.memberFilter === 'phd') {
    const full = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'phd' && item.track === 'fullTime');
    const part = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'phd' && item.track === 'partTime');
    sections.push(adminSection(`박사과정 · 풀타임 (${full.length})`, full.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    sections.push(adminSection(`박사과정 · 파트타임 (${part.length})`, part.map(memberItemMarkup).join('') || emptyAdmin('없음')));
  } else if (state.memberFilter === 'ms') {
    const full = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'ms' && item.track === 'fullTime');
    const part = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'ms' && item.track === 'partTime');
    sections.push(adminSection(`석사과정 · 풀타임 (${full.length})`, full.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    sections.push(adminSection(`석사과정 · 파트타임 (${part.length})`, part.map(memberItemMarkup).join('') || emptyAdmin('없음')));
  } else if (state.memberFilter === 'undergrad') {
    const items = enrolled.filter((item) => item.group === 'studentResearcher');
    sections.push(adminSection(`학부연구생 (${items.length})`, items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
  } else if (state.memberFilter === 'alumni') {
    const grouped = Object.entries(groupBy(alumni, (item) => item.graduationYear || '이전')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
    sections = grouped.map(([year, items]) => adminSection(`${year} (${items.length})`, items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
  }
  elements.memberList.innerHTML = sections.join('');
}

function renderProjectFilterTabs() {
  const years = [...new Set(state.projects.filter((item) => item.status === 'completed').map((item) => item.year).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const filters = [['all', '전체'], ['ongoing', '진행중'], ...years.map((year) => [year, `${year}`])];
  elements.projectFilterTabs.innerHTML = filters.map(([value, label]) => `<button type="button" class="admin-subtab${state.projectFilter === value ? ' is-active' : ''}" data-project-filter="${escapeHTML(value)}">${escapeHTML(label)}</button>`).join('');
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
          ${project.principalInvestigator ? `<p class="muted">연구책임자 · ${escapeHTML(project.principalInvestigator)}</p>` : ''}
          ${project.coResearchers ? `<p class="muted">공동연구원 · ${escapeHTML(project.coResearchers)}</p>` : ''}
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

function renderProjectsList() {
  if (!elements.projectList) return;
  renderProjectFilterTabs();
  const ongoing = state.projects.filter((item) => item.status === 'ongoing');
  const completed = state.projects.filter((item) => item.status === 'completed');
  let sections = [];
  if (state.projectFilter === 'all') {
    sections.push(adminSection(`진행 중 (${ongoing.length})`, ongoing.map(projectItemMarkup).join('') || emptyAdmin('없음')));
    const grouped = Object.entries(groupBy(completed, (item) => item.year || '이전')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
    sections.push(...grouped.map(([year, items]) => adminSection(`${year} (${items.length})`, items.map(projectItemMarkup).join('') || emptyAdmin('없음'))));
  } else if (state.projectFilter === 'ongoing') {
    sections.push(adminSection(`진행 중 (${ongoing.length})`, ongoing.map(projectItemMarkup).join('') || emptyAdmin('없음')));
  } else {
    const items = completed.filter((item) => String(item.year) === String(state.projectFilter));
    sections.push(adminSection(`${state.projectFilter} (${items.length})`, items.map(projectItemMarkup).join('') || emptyAdmin('없음')));
  }
  elements.projectList.innerHTML = sections.join('');
}

function renderPublicationFilterTabs() {
  const years = [...new Set(state.publications.map((item) => item.year).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const filters = [['all', '전체'], ...years.map((year) => [year, `${year}`])];
  elements.publicationFilterTabs.innerHTML = filters.map(([value, label]) => `<button type="button" class="admin-subtab${state.publicationFilter === value ? ' is-active' : ''}" data-publication-filter="${escapeHTML(value)}">${escapeHTML(label)}</button>`).join('');
}

function publicationItemMarkup(item) {
  const ym = [item.year, item.month ? `${Number(item.month)}월` : ''].filter(Boolean).join(' · ');
  const indexing = publicationIndexingLabel(item.indexing, 'kr');
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div>
          <div class="card-topline"><strong>${escapeHTML(item.title)}</strong>${indexing ? `<span class="status-badge">${escapeHTML(indexing)}</span>` : ''}</div>
          ${ym ? `<p class="muted">${escapeHTML(ym)}</p>` : ''}
          <p class="muted">${escapeHTML(item.authors)}</p>
          <p>${escapeHTML(item.journal)}${item.doi || item.url ? ` · ${escapeHTML(item.doi || item.url)}` : ''}</p>
        </div>
      </div>
      <div class="admin-item-actions">
        <button type="button" class="small-button" data-publication-action="edit" data-id="${escapeHTML(item.id)}">수정</button>
        <button type="button" class="small-button is-danger" data-publication-action="delete" data-id="${escapeHTML(item.id)}">삭제</button>
      </div>
    </article>
  `;
}

function renderPublicationsList() {
  if (!elements.publicationList) return;
  renderPublicationFilterTabs();
  let groups;
  if (state.publicationFilter === 'all') groups = Object.entries(groupBy(state.publications, (item) => item.year || '기타')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
  else groups = [[state.publicationFilter, state.publications.filter((item) => String(item.year) === String(state.publicationFilter))]];
  elements.publicationList.innerHTML = groups.map(([year, items]) => adminSection(`${year} (${items.length}편)`, items.map(publicationItemMarkup).join('') || emptyAdmin('없음'))).join('');
}

function renderBoardFilterTabs() {
  const filters = [['all', '전체'], ['notice', '공지'], ['poster', '포스터'], ['oral', '구두'], ['news', '소식']];
  elements.boardFilterTabs.innerHTML = filters.map(([value, label]) => `<button type="button" class="admin-subtab${state.boardFilter === value ? ' is-active' : ''}" data-board-filter="${escapeHTML(value)}">${escapeHTML(label)}</button>`).join('');
}

function boardItemMarkup(item) {
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div class="admin-item-thumb">${item.imageUrl ? `<img src="${escapeHTML(rootAsset(item.imageUrl, root))}" alt="${escapeHTML(item.title)}">` : `<span>${escapeHTML(item.category?.slice(0,1).toUpperCase() || 'B')}</span>`}</div>
        <div>
          <div class="card-topline"><strong>${escapeHTML(item.title)}</strong><span class="status-badge">${escapeHTML(boardCategoryLabel(item.category))}</span></div>
          ${item.date ? `<p class="muted">${escapeHTML(item.date)}</p>` : ''}
          ${item.description ? `<p>${escapeHTML(item.description)}</p>` : ''}
          ${item.linkUrl ? `<p class="muted">${escapeHTML(item.linkUrl)}</p>` : ''}
        </div>
      </div>
      <div class="admin-item-actions">
        <button type="button" class="small-button" data-board-action="edit" data-id="${escapeHTML(item.id)}">수정</button>
        <button type="button" class="small-button is-danger" data-board-action="delete" data-id="${escapeHTML(item.id)}">삭제</button>
      </div>
    </article>
  `;
}

function boardCategoryLabel(category = '') {
  const map = { notice: '공지', poster: '포스터', oral: '구두', news: '소식' };
  return map[category] || '게시판';
}

function renderBoardList() {
  if (!elements.boardList) return;
  renderBoardFilterTabs();
  const items = state.boardFilter === 'all' ? state.board : state.board.filter((item) => item.category === state.boardFilter);
  elements.boardList.innerHTML = adminSection(`게시글 (${items.length})`, items.map(boardItemMarkup).join('') || emptyAdmin('없음'));
}

function adminSection(title, content) { return `<section class="admin-list-section"><h3>${escapeHTML(title)}</h3>${content}</section>`; }
function emptyAdmin(text) { return `<div class="admin-empty">${escapeHTML(text)}</div>`; }

function onMemberListClick(event) {
  const button = event.target.closest('[data-member-action]');
  if (!button) return;
  const member = state.members.find((item) => item.id === button.dataset.id);
  if (!member) return;
  if (button.dataset.memberAction === 'edit') return loadMemberForm(member);
  if (button.dataset.memberAction === 'graduate') return quickGraduate(member);
  if (button.dataset.memberAction === 'restore') return quickRestore(member);
  if (button.dataset.memberAction === 'delete') return removeMember(member);
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
function onBoardListClick(event) {
  const button = event.target.closest('[data-board-action]');
  if (!button) return;
  const item = state.board.find((entry) => entry.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.boardAction === 'edit') return loadBoardForm(item);
  if (button.dataset.boardAction === 'delete') return removeBoard(item);
}

function loadMemberForm(member) {
  state.editingMember = member;
  elements.memberTitle.textContent = '멤버 수정';
  const form = elements.memberForm;
  ['name','group','track','course','email','bio','education','experience','researchInterest','coursesInfo','relatedProjects','authorshipNote','currentPosition','status','graduationYear','startYear'].forEach((field) => setFormValue(form, field, member[field] || ''));
  renderMemberPhotoPreview();
}
function loadProjectForm(project) {
  state.editingProject = project;
  elements.projectTitle.textContent = '과제 수정';
  const form = elements.projectForm;
  ['title','description','status','period','principalInvestigator','coResearchers','figureAspect'].forEach((field) => setFormValue(form, field, project[field] || ''));
  setFormValue(form, 'tags', (project.tags || []).join(', '));
  renderProjectFigurePreview();
}
function loadPublicationForm(item) {
  state.editingPublication = item;
  elements.publicationTitle.textContent = '논문 수정';
  const form = elements.publicationForm;
  ['title','authors','journal','year','month','doi','url','abstract','indexing'].forEach((field) => setFormValue(form, field, item[field] || ''));
}
function loadBoardForm(item) {
  state.editingBoard = item;
  elements.boardTitle.textContent = '게시글 수정';
  const form = elements.boardForm;
  ['category','title','description','linkUrl','date'].forEach((field) => setFormValue(form, field, item[field] || ''));
  renderBoardImagePreview();
}

async function quickGraduate(member) {
  const year = window.prompt('졸업 연도를 입력하세요.', member.graduationYear || new Date().getFullYear().toString());
  if (year === null) return;
  const currentPosition = window.prompt('현재 소속을 입력하세요.', member.currentPosition || '');
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
  if (member.photoPath) { try { await deleteStoragePath(member.photoPath); } catch {} }
  await deleteDocumentById(COLLECTIONS.members, member.id);
  showNotice('멤버가 삭제되었습니다.', 'success');
}
async function removeProject(project) {
  if (!window.confirm(`${project.title} 과제를 삭제할까요?`)) return;
  if (project.figurePath) { try { await deleteStoragePath(project.figurePath); } catch {} }
  await deleteDocumentById(COLLECTIONS.projects, project.id);
  showNotice('과제가 삭제되었습니다.', 'success');
}
async function removePublication(item) {
  if (!window.confirm(`${item.title} 논문을 삭제할까요?`)) return;
  await deleteDocumentById(COLLECTIONS.publications, item.id);
  showNotice('논문이 삭제되었습니다.', 'success');
}
async function removeBoard(item) {
  if (!window.confirm(`${item.title} 게시글을 삭제할까요?`)) return;
  if (item.imagePath) { try { await deleteStoragePath(item.imagePath); } catch {} }
  await deleteDocumentById(COLLECTIONS.board, item.id);
  showNotice('게시글이 삭제되었습니다.', 'success');
}

function showNotice(message, tone = 'info') {
  const target = qs('#notice-area');
  if (!target) return;
  target.textContent = message;
  target.className = `notice-banner is-${tone}`;
  target.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { target.hidden = true; }, 3600);
}
