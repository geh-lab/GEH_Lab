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
  publicationIndexingLabel,
  groupBy
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
  memberPhotoRemoved: false,
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
  boardFilter: 'all',
  memberPage: 1,
  projectPage: 1,
  publicationPage: 1,
  boardPage: 1,
  pageSize: 10
};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));
const root = document.body.dataset.root || '.';

const elements = {
  authLoading: qs('#auth-loading'),
  loginView: qs('#login-view'),
  dashboardView: qs('#dashboard-view'),
  googleLoginButton: qs('#google-login-button'),
  loginShortcutButton: qs('#login-shortcut-button'),
  logoutButton: qs('#logout-button'),
  currentUser: qs('#current-user-label'),
  authNotice: qs('#auth-notice'),
  tabButtons: qsa('[data-admin-tab]'),
  panels: qsa('[data-panel]'),
  memberForm: qs('#member-form'),
  memberList: qs('#member-list'),
  memberTitle: qs('#member-form-title'),
  memberEditorCard: qs('#member-editor-card'),
  memberAddButton: qs('#member-add-button'),
  memberPagination: qs('#member-pagination'),
  memberPhotoInput: qs('#member-photo-input'),
  memberPhotoPreview: qs('#member-photo-preview'),
  memberPhotoRemove: qs('#member-photo-remove'),
  memberFilterTabs: qs('#member-filter-tabs'),
  projectForm: qs('#project-form'),
  projectList: qs('#project-list'),
  projectTitle: qs('#project-form-title'),
  projectEditorCard: qs('#project-editor-card'),
  projectAddButton: qs('#project-add-button'),
  projectPagination: qs('#project-pagination'),
  projectFilterTabs: qs('#project-filter-tabs'),
  projectFigureInput: qs('#project-figure-input'),
  projectFigurePreview: qs('#project-figure-preview'),
  projectFigureRemove: qs('#project-figure-remove'),
  projectPrincipalInvestigator: qs('#project-principal-investigator'),
  publicationForm: qs('#publication-form'),
  publicationList: qs('#publication-list'),
  publicationTitle: qs('#publication-form-title'),
  publicationEditorCard: qs('#publication-editor-card'),
  publicationAddButton: qs('#publication-add-button'),
  publicationPagination: qs('#publication-pagination'),
  publicationFilterTabs: qs('#publication-filter-tabs'),
  boardForm: qs('#board-form'),
  boardList: qs('#board-list'),
  boardTitle: qs('#board-form-title'),
  boardEditorCard: qs('#board-editor-card'),
  boardAddButton: qs('#board-add-button'),
  boardPagination: qs('#board-pagination'),
  boardFilterTabs: qs('#board-filter-tabs'),
  boardImageInput: qs('#board-image-input'),
  boardImagePreview: qs('#board-image-preview'),
  boardImageRemove: qs('#board-image-remove'),
  summaryMembers: qs('#summary-members'),
  summaryProjects: qs('#summary-projects'),
  summaryPublications: qs('#summary-publications'),
  summaryBoard: qs('#summary-board'),
  dialog: qs('#admin-dialog'),
  dialogTitle: qs('#admin-dialog-title'),
  dialogMessage: qs('#admin-dialog-message'),
  dialogInputWrap: qs('#admin-dialog-input-wrap'),
  dialogInputLabel: qs('#admin-dialog-input-label'),
  dialogInput: qs('#admin-dialog-input'),
  dialogCancel: qs('#admin-dialog-cancel'),
  dialogConfirm: qs('#admin-dialog-confirm')
};

function setTopbarAuthState(isAuthenticated, email = '') {
  if (elements.currentUser) {
    elements.currentUser.textContent = isAuthenticated ? (email || '관리자') : '로그인 필요';
    elements.currentUser.classList.toggle('is-authenticated', Boolean(isAuthenticated));
  }
  if (elements.loginShortcutButton) {
    elements.loginShortcutButton.hidden = Boolean(isAuthenticated);
    elements.loginShortcutButton.style.display = isAuthenticated ? 'none' : 'inline-flex';
    elements.loginShortcutButton.setAttribute('aria-hidden', String(Boolean(isAuthenticated)));
  }
  if (elements.logoutButton) {
    elements.logoutButton.hidden = !isAuthenticated;
    elements.logoutButton.style.display = isAuthenticated ? 'inline-flex' : 'none';
    elements.logoutButton.setAttribute('aria-hidden', String(!isAuthenticated));
  }
}

function syncMemberNameField() {
  const form = elements.memberForm;
  if (!form) return;
  const kr = String(form.elements.namedItem('nameKr')?.value || '').trim();
  const en = String(form.elements.namedItem('nameEn')?.value || '').trim();
  const display = form.elements.namedItem('name');
  if (display) display.value = en || kr;
}

function setFormValue(form, fieldName, value) {
  const field = form?.elements?.namedItem(fieldName);
  if (field) field.value = value ?? '';
}

function numericYearSort(value) {
  return Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
}

function adminErrorMessage(error, fallback) {
  if (error?.code === 'permission-denied' || /Missing or insufficient permissions/i.test(error?.message || '')) {
    return `${fallback} Firestore 보안 규칙에 ${COLLECTIONS.board} / ${COLLECTIONS.members} / ${COLLECTIONS.projects} / ${COLLECTIONS.publications} 쓰기 권한이 반영되었는지 확인해주세요.`;
  }
  return error?.message || fallback;
}


function editorElement(kind) {
  return {
    member: elements.memberEditorCard,
    project: elements.projectEditorCard,
    publication: elements.publicationEditorCard,
    board: elements.boardEditorCard
  }[kind] || null;
}

function openEditor(kind) {
  const target = editorElement(kind);
  if (!target) return;
  target.hidden = false;
  target.classList.add('is-open');
}

function closeEditor(kind) {
  const target = editorElement(kind);
  if (!target) return;
  target.classList.remove('is-open');
  target.hidden = true;
}

function paginateItems(items = [], page = 1) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * state.pageSize;
  return { items: items.slice(start, start + state.pageSize), page: current, pages, total };
}

function paginationMarkup(kind, page, pages) {
  if (pages <= 1) return '';
  const nums = Array.from({ length: pages }, (_, index) => index + 1).map((num) =>
    `<button type="button" class="small-button${num === page ? ' is-active' : ''}" data-page-kind="${escapeHTML(kind)}" data-page="${num}">${num}</button>`
  ).join('');
  return `<div class="pagination-shell"><button type="button" class="small-button" data-page-kind="${escapeHTML(kind)}" data-page="${Math.max(1, page - 1)}" ${page === 1 ? 'disabled' : ''}>이전</button>${nums}<button type="button" class="small-button" data-page-kind="${escapeHTML(kind)}" data-page="${Math.min(pages, page + 1)}" ${page === pages ? 'disabled' : ''}>다음</button></div>`;
}

function bindPagination(container, key) {
  container?.querySelectorAll('[data-page-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      state[key] = Number(button.dataset.page || 1);
      renderAllLists();
    });
  });
}

function localizedProjectTitle(project, locale = 'kr') {
  return locale === 'en'
    ? (project.titleEn || project.title || project.titleKr || '')
    : (project.titleKr || project.title || project.titleEn || '');
}

function localizedProjectDescription(project, locale = 'kr') {
  return locale === 'en'
    ? (project.descriptionEn || project.description || project.descriptionKr || '')
    : (project.descriptionKr || project.description || project.descriptionEn || '');
}

function localizedProjectTags(project, locale = 'kr') {
  const arr = locale === 'en'
    ? ((project.tagsEn && project.tagsEn.length) ? project.tagsEn : project.tags)
    : ((project.tagsKr && project.tagsKr.length) ? project.tagsKr : project.tags);
  return Array.isArray(arr) ? arr : [];
}

function resolveMemberFilter(member = {}) {
  if (member.status === 'alumni') return 'alumni';
  if (member.group === 'pi') return 'pi';
  if (member.group === 'researchProfessor') return 'research';
  if (member.group === 'studentResearcher') return 'undergrad';
  if (member.group === 'graduateStudent' && member.course === 'phd') return 'phd';
  return 'ms';
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  renderSetupMessage();
  renderAllLists();
  setTopbarAuthState(false);

  if (!hasFirebaseConfig) {
    togglePending(false);
    toggleViews(false);
    return;
  }

  togglePending(true);
  let initialUser = auth?.currentUser || null;
  try {
    const redirectCredential = await resolveRedirectResult();
    if (redirectCredential?.user) initialUser = redirectCredential.user;
  } catch (error) {
    console.error(error);
    showNotice(error.message || 'Google 로그인 처리 중 오류가 발생했습니다.', 'danger');
  }

  await handleAuthState(initialUser);

  watchAdminState(async (user) => {
    const currentUid = state.user?.uid || '';
    const nextUid = user?.uid || '';
    if (currentUid === nextUid) return;
    await handleAuthState(user || null);
  });
});

function bindEvents() {
  elements.googleLoginButton?.addEventListener('click', handleGoogleLogin);
  elements.loginShortcutButton?.addEventListener('click', handleGoogleLogin);
  elements.logoutButton?.addEventListener('click', async () => {
    if (!state.user) {
      await handleAuthState(null);
      return;
    }
    await signOutAdmin();
    await handleAuthState(null);
  });
  elements.tabButtons.forEach((button) => button.addEventListener('click', () => setActiveTab(button.dataset.adminTab)));
  elements.memberAddButton?.addEventListener('click', () => { resetMemberForm(); openEditor('member'); });
  elements.projectAddButton?.addEventListener('click', () => { resetProjectForm(); openEditor('project'); });
  elements.publicationAddButton?.addEventListener('click', () => { resetPublicationForm(); openEditor('publication'); });
  elements.boardAddButton?.addEventListener('click', () => { resetBoardForm(); openEditor('board'); });
  qsa('[data-editor-close]').forEach((button) => button.addEventListener('click', () => closeEditor(button.dataset.editorClose)));
  elements.memberFilterTabs?.addEventListener('click', onMemberFilterClick);
  elements.projectFilterTabs?.addEventListener('click', onProjectFilterClick);
  elements.publicationFilterTabs?.addEventListener('click', onPublicationFilterClick);
  elements.boardFilterTabs?.addEventListener('click', onBoardFilterClick);
  elements.memberForm?.addEventListener('submit', handleMemberSubmit);
  elements.memberForm?.elements?.namedItem('nameKr')?.addEventListener('input', syncMemberNameField);
  elements.memberForm?.elements?.namedItem('nameEn')?.addEventListener('input', syncMemberNameField);
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
  elements.dialogCancel?.addEventListener('click', () => closeDialog(null));
  elements.dialogConfirm?.addEventListener('click', submitDialog);
  qsa('[data-dialog-close]').forEach((btn) => btn.addEventListener('click', () => closeDialog(null)));
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
  togglePending(true);
  elements.googleLoginButton?.setAttribute('disabled', 'disabled');
  elements.loginShortcutButton?.setAttribute('disabled', 'disabled');
  showNotice('Google 로그인 창을 엽니다.', 'info');
  try {
    const credential = await signInAdminWithGoogle();
    if (credential?.user) {
      await handleAuthState(credential.user);
      return;
    }
    showNotice('계정 선택 후 다시 관리자 페이지로 돌아옵니다.', 'info');
  } catch (error) {
    console.error(error);
    togglePending(false);
    toggleViews(false);
    showNotice(error.message || 'Google 로그인에 실패했습니다.', 'danger');
  } finally {
    elements.googleLoginButton?.removeAttribute('disabled');
    elements.loginShortcutButton?.removeAttribute('disabled');
  }
}

async function handleAuthState(user) {
  const previousUid = state.user?.uid || '';
  state.user = user || null;
  state.authResolved = true;
  togglePending(false);
  toggleViews(Boolean(state.user));
  setTopbarAuthState(Boolean(state.user), state.user?.email || '');
  if (!state.user) {
    teardownListeners();
    state.seeded = false;
    renderProjectLeadOptions();
    return;
  }
  await ensureSeeded();
  attachListeners();
  setActiveTab(state.activeTab || 'members');
  renderProjectLeadOptions();
  if (previousUid !== state.user.uid) showNotice(`${state.user.email} 계정으로 로그인되었습니다.`, 'success');
}

function togglePending(isPending) {
  if (elements.authLoading) elements.authLoading.hidden = !isPending;
  if (!isPending) return;
  if (elements.loginView) elements.loginView.hidden = true;
  if (elements.dashboardView) elements.dashboardView.hidden = true;
  setTopbarAuthState(false);
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
      renderProjectLeadOptions();
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

const dialogState = { resolve: null, type: 'alert' };

function openDialog({ title = '확인', message = '', inputLabel = '입력', defaultValue = '', type = 'alert', confirmText = '확인', cancelText = '취소' } = {}) {
  return new Promise((resolve) => {
    if (!elements.dialog) return resolve(null);
    dialogState.resolve = resolve;
    dialogState.type = type;
    elements.dialogTitle.textContent = title;
    elements.dialogMessage.textContent = message;
    elements.dialogInputLabel.textContent = inputLabel;
    elements.dialogInput.value = defaultValue;
    elements.dialogInputWrap.hidden = type !== 'prompt';
    elements.dialogCancel.hidden = type === 'alert';
    elements.dialogCancel.textContent = cancelText;
    elements.dialogConfirm.textContent = confirmText;
    elements.dialog.hidden = false;
    document.body.classList.add('modal-open');
    if (type === 'prompt') setTimeout(() => elements.dialogInput.focus(), 40);
    else setTimeout(() => elements.dialogConfirm.focus(), 40);
  });
}

function closeDialog(result = null) {
  if (!elements.dialog) return;
  elements.dialog.hidden = true;
  document.body.classList.remove('modal-open');
  const resolve = dialogState.resolve;
  dialogState.resolve = null;
  resolve?.(result);
}

function submitDialog() {
  if (dialogState.type === 'prompt') closeDialog(elements.dialogInput.value);
  else closeDialog(true);
}

function renderProjectLeadOptions() {
  if (!elements.projectPrincipalInvestigator) return;
  const currentValue = state.editingProject?.principalInvestigator || elements.projectPrincipalInvestigator.value || '';
  const candidates = sortMembers(state.members).filter((member) => member.status !== 'alumni' && ['pi', 'researchProfessor'].includes(member.group));
  const seen = new Set();
  const options = ['<option value="">선택</option>'];
  candidates.forEach((member) => {
    if (!member.name || seen.has(member.name)) return;
    seen.add(member.name);
    const role = member.group === 'pi' ? '교수' : '연구교수 / 박사후연구원';
    options.push(`<option value="${escapeHTML(member.name)}">${escapeHTML(member.name)} · ${escapeHTML(role)}</option>`);
  });
  elements.projectPrincipalInvestigator.innerHTML = options.join('');
  elements.projectPrincipalInvestigator.value = currentValue;
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
  state.memberPage = 1;
  renderMembersList();
}
function onProjectFilterClick(event) {
  const button = event.target.closest('[data-project-filter]');
  if (!button) return;
  state.projectFilter = button.dataset.projectFilter;
  state.projectPage = 1;
  renderProjectsList();
}
function onPublicationFilterClick(event) {
  const button = event.target.closest('[data-publication-filter]');
  if (!button) return;
  state.publicationFilter = button.dataset.publicationFilter;
  state.publicationPage = 1;
  renderPublicationsList();
}
function onBoardFilterClick(event) {
  const button = event.target.closest('[data-board-filter]');
  if (!button) return;
  state.boardFilter = button.dataset.boardFilter;
  state.boardPage = 1;
  renderBoardList();
}

function onMemberPhotoChange(event) {
  const [file] = event.currentTarget.files || [];
  state.pendingMemberFile = file || null;
  state.memberPhotoRemoved = false;
  if (state.pendingMemberPreview) URL.revokeObjectURL(state.pendingMemberPreview);
  state.pendingMemberPreview = file ? URL.createObjectURL(file) : '';
  renderMemberPhotoPreview();
}
function clearMemberPhoto() {
  state.pendingMemberFile = null;
  state.memberPhotoRemoved = true;
  if (state.pendingMemberPreview) URL.revokeObjectURL(state.pendingMemberPreview);
  state.pendingMemberPreview = '';
  state.memberPhotoRemoved = false;
  if (elements.memberPhotoInput) elements.memberPhotoInput.value = '';
  if (state.editingMember) {
    state.editingMember.photoUrl = '';
    state.editingMember.photoPath = '';
  }
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
  syncMemberNameField();
  renderProjectLeadOptions();
}
function resetProjectForm() {
  elements.projectForm?.reset();
  state.editingProject = null;
  state.pendingProjectFile = null;
  if (state.pendingProjectPreview) URL.revokeObjectURL(state.pendingProjectPreview);
  state.pendingProjectPreview = '';
  if (elements.projectTitle) elements.projectTitle.textContent = '과제 추가';
  renderProjectFigurePreview();
  renderProjectLeadOptions();
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
    nameKr: String(formData.get('nameKr') || '').trim(),
    nameEn: String(formData.get('nameEn') || '').trim(),
    name: String(formData.get('nameEn') || formData.get('nameKr') || formData.get('name') || '').trim(),
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
    enrolledGroup: state.editingMember?.enrolledGroup || '',
    enrolledCourse: state.editingMember?.enrolledCourse || '',
    enrolledTrack: state.editingMember?.enrolledTrack || '',
    sortOrder: state.editingMember?.sortOrder ?? 999,
    photoUrl: state.editingMember?.photoUrl || '',
    photoPath: state.editingMember?.photoPath || '',
    photoRemoved: state.memberPhotoRemoved
  };
  if (!payload.nameKr && !payload.nameEn && !payload.name) return showNotice('이름을 입력해주세요.', 'warning');
  try {
    if (state.pendingMemberFile) {
      const upload = await uploadMemberPhoto(state.pendingMemberFile);
      if (state.editingMember?.photoPath && state.editingMember.photoPath !== upload.photoPath) {
        try { await deleteStoragePath(state.editingMember.photoPath); } catch {}
      }
      payload.photoUrl = upload.photoUrl;
      payload.photoPath = upload.photoPath;
      payload.photoRemoved = false;
    } else if (state.memberPhotoRemoved) {
      if (state.editingMember?.photoPath) {
        try { await deleteStoragePath(state.editingMember.photoPath); } catch {}
      }
      payload.photoUrl = '';
      payload.photoPath = '';
    }
    if (payload.status !== 'alumni') {
      payload.graduationYear = '';
      payload.enrolledGroup = payload.group;
      payload.enrolledCourse = payload.course;
      payload.enrolledTrack = payload.track;
    } else {
      payload.enrolledGroup = payload.enrolledGroup || payload.group;
      payload.enrolledCourse = payload.enrolledCourse || payload.course;
      payload.enrolledTrack = payload.enrolledTrack || payload.track;
    }
    const id = await saveDocument(COLLECTIONS.members, state.editingMember?.id || null, payload);
    state.members = sortMembers(mergeMembers(state.members, [{ ...payload, id, updatedAt: new Date().toISOString() }]));
    state.memberFilter = memberFilterFor(payload);
    renderMembersList();
    renderProjectLeadOptions();
    renderSummary();
    showNotice('멤버 정보가 저장되었습니다.', 'success');
    resetMemberForm();
    closeEditor('member');
    state.memberPhotoRemoved = false;
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '멤버 저장에 실패했습니다.'), 'danger');
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
  const titleKr = String(formData.get('titleKr') || '').trim();
  const titleEn = String(formData.get('titleEn') || '').trim();
  const descriptionKr = String(formData.get('descriptionKr') || '').trim();
  const descriptionEn = String(formData.get('descriptionEn') || '').trim();
  const payload = {
    titleKr,
    titleEn,
    title: titleEn || titleKr,
    descriptionKr,
    descriptionEn,
    description: descriptionEn || descriptionKr,
    status: String(formData.get('status') || 'ongoing'),
    period,
    year: extractYearFromPeriod(period),
    leadRole: String(formData.get('leadRole') || 'principalInvestigator').trim(),
    principalInvestigator: String(formData.get('principalInvestigator') || '').trim(),
    coResearchers: '',
    figureUrl: state.editingProject?.figureUrl || '',
    figurePath: state.editingProject?.figurePath || '',
    figureAspect: String(formData.get('figureAspect') || '16:9'),
    tagsKr: String(formData.get('tagsKr') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    tagsEn: String(formData.get('tagsEn') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    tags: String(formData.get('tagsKr') || formData.get('tagsEn') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    sortOrder: state.editingProject?.sortOrder ?? 999
  };
  if (!payload.titleKr && !payload.titleEn) return showNotice('과제 제목을 입력해주세요.', 'warning');
  try {
    if (state.pendingProjectFile) {
      const upload = await uploadProjectFigure(state.pendingProjectFile);
      if (state.editingProject?.figurePath && state.editingProject.figurePath !== upload.figurePath) {
        try { await deleteStoragePath(state.editingProject.figurePath); } catch {}
      }
      payload.figureUrl = upload.figureUrl;
      payload.figurePath = upload.figurePath;
    }
    const id = await saveDocument(COLLECTIONS.projects, state.editingProject?.id || null, payload);
    state.projects = sortProjects(mergeProjects(state.projects, [{ ...payload, id, updatedAt: new Date().toISOString() }]));
    renderProjectsList();
    renderSummary();
    showNotice('과제 정보가 저장되었습니다.', 'success');
    resetProjectForm();
    closeEditor('project');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '과제 저장에 실패했습니다.'), 'danger');
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
    month: String(formData.get('month') || '').trim().padStart(2, '0'),
    doi: String(formData.get('doi') || '').trim(),
    url: String(formData.get('url') || '').trim(),
    abstract: String(formData.get('abstract') || '').trim(),
    indexing: String(formData.get('indexing') || '').trim(),
    sortOrder: state.editingPublication?.sortOrder ?? 999
  };
  if (!payload.title) return showNotice('논문 제목을 입력해주세요.', 'warning');
  try {
    const id = await saveDocument(COLLECTIONS.publications, state.editingPublication?.id || null, payload);
    state.publications = sortPublications(mergePublications(state.publications, [{ ...payload, id, updatedAt: new Date().toISOString() }]));
    renderPublicationsList();
    renderSummary();
    showNotice('논문 정보가 저장되었습니다.', 'success');
    resetPublicationForm();
    closeEditor('publication');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '논문 저장에 실패했습니다.'), 'danger');
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
    const id = await saveDocument(COLLECTIONS.board, state.editingBoard?.id || null, payload);
    state.board = sortBoardPosts(mergeBoardPosts(state.board, [{ ...payload, id, updatedAt: new Date().toISOString() }]));
    renderBoardList();
    renderSummary();
    showNotice('게시글이 저장되었습니다.', 'success');
    resetBoardForm();
    closeEditor('board');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '게시글 저장에 실패했습니다.'), 'danger');
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
            <strong>${escapeHTML(member.nameKr || member.name)}</strong>${member.nameEn ? `<small class=\"muted\">${escapeHTML(member.nameEn)}</small>` : ''}
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
    const all = enrolled.filter((item) => item.group === 'pi');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    sections.push(adminSection(`지도교수 · 교수 (${all.length})`, pageData.items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'research') {
    const all = enrolled.filter((item) => item.group === 'researchProfessor');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    sections.push(adminSection(`연구교수 · 박사후연구원 (${all.length})`, pageData.items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'phd') {
    const all = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'phd');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    const full = pageData.items.filter((item) => item.track === 'fullTime');
    const part = pageData.items.filter((item) => item.track === 'partTime');
    sections.push(adminSection(`박사과정 · 풀타임`, full.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    sections.push(adminSection(`박사과정 · 파트타임`, part.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'ms') {
    const all = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'ms');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    const full = pageData.items.filter((item) => item.track === 'fullTime');
    const part = pageData.items.filter((item) => item.track === 'partTime');
    sections.push(adminSection(`석사과정 · 풀타임`, full.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    sections.push(adminSection(`석사과정 · 파트타임`, part.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'undergrad') {
    const all = enrolled.filter((item) => item.group === 'studentResearcher');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    sections.push(adminSection(`학부연구생 (${all.length})`, pageData.items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'alumni') {
    const pageData = paginateItems(alumni, state.memberPage);
    state.memberPage = pageData.page;
    const grouped = Object.entries(groupBy(pageData.items, (item) => item.graduationYear || '이전')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
    sections = grouped.map(([year, items]) => adminSection(`${year} (${items.length})`, items.map(memberItemMarkup).join('') || emptyAdmin('없음')));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  }
  elements.memberList.innerHTML = sections.join('');
  bindPagination(elements.memberPagination, 'memberPage');
}

function renderProjectFilterTabs() {
  const years = [...new Set(state.projects.filter((item) => item.status === 'completed').map((item) => item.year).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const filters = [['all', '전체'], ['ongoing', '진행중'], ...years.map((year) => [year, `${year}`])];
  elements.projectFilterTabs.innerHTML = filters.map(([value, label]) => `<button type="button" class="admin-subtab${state.projectFilter === value ? ' is-active' : ''}" data-project-filter="${escapeHTML(value)}">${escapeHTML(label)}</button>`).join('');
}

function projectItemMarkup(project) {
  const roleMap = { principalInvestigator: '연구책임자', coPrincipalInvestigator: '공동연구책임자', leadInstitutionInvestigator: '주관책임자' };
  const roleLabel = roleMap[project.leadRole] || '연구책임자';
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div>
          <div class="card-topline">
            <strong>${escapeHTML(localizedProjectTitle(project, 'kr'))}</strong>
            <span class="status-badge ${project.status === 'completed' ? 'is-alumni' : ''}">${escapeHTML(projectStatusLabel(project.status, 'kr'))}</span>
          </div>
          ${project.period ? `<p class="muted">기간 · ${escapeHTML(project.period)}</p>` : ''}
          ${project.principalInvestigator ? `<p class="muted">${escapeHTML(roleLabel)} · ${escapeHTML(project.principalInvestigator)}</p>` : ''}
          ${localizedProjectDescription(project, 'kr') ? `<p>${escapeHTML(localizedProjectDescription(project, 'kr'))}</p>` : ''}
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
    const all = [...ongoing, ...completed];
    const pageData = paginateItems(all, state.projectPage);
    state.projectPage = pageData.page;
    const ongoingPage = pageData.items.filter((item) => item.status === 'ongoing');
    const completedPage = pageData.items.filter((item) => item.status === 'completed');
    sections.push(adminSection(`진행 중 (${ongoing.length})`, ongoingPage.map(projectItemMarkup).join('') || emptyAdmin('없음')));
    const grouped = Object.entries(groupBy(completedPage, (item) => item.year || '이전')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
    sections.push(...grouped.map(([year, items]) => adminSection(`${year} (${items.length})`, items.map(projectItemMarkup).join('') || emptyAdmin('없음'))));
    elements.projectPagination.innerHTML = paginationMarkup('project', pageData.page, pageData.pages);
  } else if (state.projectFilter === 'ongoing') {
    const pageData = paginateItems(ongoing, state.projectPage);
    state.projectPage = pageData.page;
    sections.push(adminSection(`진행 중 (${ongoing.length})`, pageData.items.map(projectItemMarkup).join('') || emptyAdmin('없음')));
    elements.projectPagination.innerHTML = paginationMarkup('project', pageData.page, pageData.pages);
  } else {
    const items = completed.filter((item) => String(item.year) === String(state.projectFilter));
    const pageData = paginateItems(items, state.projectPage);
    state.projectPage = pageData.page;
    sections.push(adminSection(`${state.projectFilter} (${items.length})`, pageData.items.map(projectItemMarkup).join('') || emptyAdmin('없음')));
    elements.projectPagination.innerHTML = paginationMarkup('project', pageData.page, pageData.pages);
  }
  elements.projectList.innerHTML = sections.join('');
  bindPagination(elements.projectPagination, 'projectPage');
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
  let pageData;
  if (state.publicationFilter === 'all') {
    pageData = paginateItems(state.publications, state.publicationPage);
    groups = Object.entries(groupBy(pageData.items, (item) => item.year || '기타')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
  } else {
    const filtered = state.publications.filter((item) => String(item.year) === String(state.publicationFilter));
    pageData = paginateItems(filtered, state.publicationPage);
    groups = [[state.publicationFilter, pageData.items]];
  }
  state.publicationPage = pageData.page;
  elements.publicationList.innerHTML = groups.map(([year, items]) => adminSection(`${year} (${items.length}편)`, items.map(publicationItemMarkup).join('') || emptyAdmin('없음'))).join('');
  elements.publicationPagination.innerHTML = paginationMarkup('publication', pageData.page, pageData.pages);
  bindPagination(elements.publicationPagination, 'publicationPage');
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
  const pageData = paginateItems(items, state.boardPage);
  state.boardPage = pageData.page;
  elements.boardList.innerHTML = adminSection(`게시글 (${items.length})`, pageData.items.map(boardItemMarkup).join('') || emptyAdmin('없음'));
  elements.boardPagination.innerHTML = paginationMarkup('board', pageData.page, pageData.pages);
  bindPagination(elements.boardPagination, 'boardPage');
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
  ['nameKr','nameEn','name','group','track','course','email','bio','education','experience','researchInterest','coursesInfo','relatedProjects','authorshipNote','currentPosition','status','graduationYear','startYear'].forEach((field) => setFormValue(form, field, member[field] || ''));
  renderMemberPhotoPreview();
  openEditor('member');
}
function loadProjectForm(project) {
  state.editingProject = project;
  elements.projectTitle.textContent = '과제 수정';
  const form = elements.projectForm;
  setFormValue(form, 'titleKr', project.titleKr || project.title || '');
  setFormValue(form, 'titleEn', project.titleEn || project.title || '');
  setFormValue(form, 'descriptionKr', project.descriptionKr || project.description || '');
  setFormValue(form, 'descriptionEn', project.descriptionEn || project.description || '');
  ['status','period','leadRole','principalInvestigator','figureAspect'].forEach((field) => setFormValue(form, field, project[field] || ''));
  renderProjectLeadOptions();
  setFormValue(form, 'tagsKr', ((project.tagsKr && project.tagsKr.length) ? project.tagsKr : project.tags || []).join(', '));
  setFormValue(form, 'tagsEn', ((project.tagsEn && project.tagsEn.length) ? project.tagsEn : project.tags || []).join(', '));
  renderProjectFigurePreview();
  openEditor('project');
}
function loadPublicationForm(item) {
  state.editingPublication = item;
  elements.publicationTitle.textContent = '논문 수정';
  const form = elements.publicationForm;
  ['title','authors','journal','year','month','doi','url','abstract','indexing'].forEach((field) => setFormValue(form, field, item[field] || ''));
  openEditor('publication');
}
function loadBoardForm(item) {
  state.editingBoard = item;
  elements.boardTitle.textContent = '게시글 수정';
  const form = elements.boardForm;
  ['category','title','description','linkUrl','date'].forEach((field) => setFormValue(form, field, item[field] || ''));
  renderBoardImagePreview();
  openEditor('board');
}

async function quickGraduate(member) {
  const year = await openDialog({ title: '졸업 처리', message: '졸업 연도를 입력하세요.', inputLabel: '졸업 연도', defaultValue: member.graduationYear || new Date().getFullYear().toString(), type: 'prompt' });
  if (year === null) return;
  const currentPosition = await openDialog({ title: '현재 소속', message: '현재 소속을 입력하세요.', inputLabel: '현재 소속', defaultValue: member.currentPosition || '', type: 'prompt' });
  if (currentPosition === null) return;
  const payload = {
    ...member,
    status: 'alumni',
    graduationYear: String(year).trim(),
    currentPosition: String(currentPosition).trim(),
    enrolledGroup: member.enrolledGroup || member.group,
    enrolledCourse: member.enrolledCourse || member.course,
    enrolledTrack: member.enrolledTrack || member.track
  };
  await saveDocument(COLLECTIONS.members, member.id, payload);
  state.members = sortMembers(mergeMembers(state.members, [{ ...payload, updatedAt: new Date().toISOString() }]));
  state.memberFilter = 'alumni';
  renderMembersList();
  renderSummary();
  showNotice('졸업 처리되었습니다.', 'success');
}
function memberFilterFor(member) {
  if (!member) return 'pi';
  if (member.group === 'pi') return 'pi';
  if (member.group === 'researchProfessor') return 'research';
  if (member.group === 'studentResearcher') return 'undergrad';
  if (member.group === 'alumni' || member.status === 'alumni') return 'alumni';
  return member.course === 'phd' ? 'phd' : 'ms';
}

async function quickRestore(member) {
  const restoredGroup = member.enrolledGroup || (member.group === 'alumni' ? 'graduateStudent' : member.group);
  const restoredCourse = member.enrolledCourse || (member.course === 'alumni' ? 'ms' : member.course);
  const restoredTrack = member.enrolledTrack || (member.track || 'none');
  const payload = { ...member, status: 'enrolled', graduationYear: '', group: restoredGroup, course: restoredCourse, track: restoredTrack };
  await saveDocument(COLLECTIONS.members, member.id, payload);
  state.members = sortMembers(mergeMembers(state.members, [{ ...payload, updatedAt: new Date().toISOString() }]));
  state.memberFilter = memberFilterFor(payload);
  renderMembersList();
  renderSummary();
  showNotice('재학 상태로 변경되었습니다.', 'success');
}
async function removeMember(member) {
  const ok = await openDialog({ title: '멤버 삭제', message: `${member.name} 멤버를 삭제할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    if (member.photoPath) { try { await deleteStoragePath(member.photoPath); } catch {} }
    await deleteDocumentById(COLLECTIONS.members, member.id);
    state.members = state.members.filter((item) => item.id !== member.id);
    renderMembersList();
    renderSummary();
    showNotice('멤버가 삭제되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '멤버 삭제에 실패했습니다.'), 'danger');
  }
}
async function removeProject(project) {
  const ok = await openDialog({ title: '과제 삭제', message: `${project.title} 과제를 삭제할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    if (project.figurePath) { try { await deleteStoragePath(project.figurePath); } catch {} }
    await deleteDocumentById(COLLECTIONS.projects, project.id);
    state.projects = state.projects.filter((item) => item.id !== project.id);
    renderProjectsList();
    renderSummary();
    showNotice('과제가 삭제되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '과제 삭제에 실패했습니다.'), 'danger');
  }
}
async function removePublication(item) {
  const ok = await openDialog({ title: '논문 삭제', message: `${item.title} 논문을 삭제할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    await deleteDocumentById(COLLECTIONS.publications, item.id);
    state.publications = state.publications.filter((pub) => pub.id !== item.id);
    renderPublicationsList();
    renderSummary();
    showNotice('논문이 삭제되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '논문 삭제에 실패했습니다.'), 'danger');
  }
}
async function removeBoard(item) {
  const ok = await openDialog({ title: '게시글 삭제', message: `${item.title} 게시글을 삭제할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    if (item.imagePath) { try { await deleteStoragePath(item.imagePath); } catch {} }
    await deleteDocumentById(COLLECTIONS.board, item.id);
    state.board = state.board.filter((entry) => entry.id !== item.id);
    renderBoardList();
    renderSummary();
    showNotice('게시글이 삭제되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '게시글 삭제에 실패했습니다.'), 'danger');
  }
}

function showNotice(message, tone = 'info') {
  const target = (!elements.dashboardView?.hidden && qs('#notice-area')) || elements.authNotice || qs('#notice-area');
  if (!target) return;
  target.textContent = message;
  target.className = `notice-banner is-${tone}`;
  target.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { if (target !== elements.authNotice) target.hidden = true; }, 3600);
}
