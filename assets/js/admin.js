import { FALLBACK_MEMBERS, FALLBACK_PROJECTS, FALLBACK_PUBLICATIONS, FALLBACK_BOARD_POSTS } from './data.js?v=65';
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
  formatEnglishName,
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
  publicationYearMonthLabel,
  normalizeProjectPeriod,
  groupBy,
  isActiveItem
} from './utils.js?v=65';
import {
  auth,
  hasFirebaseConfig,
  isLocalDevMode,
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
} from './firebase.js?v=65';

const state = {
  user: null,
  members: sortMembers(FALLBACK_MEMBERS),
  projects: sortProjects(FALLBACK_PROJECTS),
  publications: sortPublications(FALLBACK_PUBLICATIONS),
  board: sortBoardPosts(FALLBACK_BOARD_POSTS),
  trash: [],
  editingMember: null,
  editingProject: null,
  editingPublication: null,
  editingBoard: null,
  pendingMemberFile: null,
  pendingMemberPreview: '',
  memberPhotoRemoved: false,
  pendingProjectFile: null,
  pendingProjectPreview: '',
  pendingBoardFiles: [],
  pendingBoardPreviews: [],
  boardImageRemoved: false,
  seeded: false,
  unsubs: [],
  authResolved: false,
  activeTab: 'members',
  memberFilter: 'all',
  openEditorKind: '',
  projectFilter: 'all',
  publicationFilter: 'all',
  boardFilter: 'all',
  trashFilter: 'all',
  memberPage: 1,
  projectPage: 1,
  publicationPage: 1,
  boardPage: 1,
  trashPage: 1,
  pageSize: 10,
  memberQuery: '',
  projectQuery: '',
  publicationQuery: '',
  boardQuery: '',
  trashQuery: '',
  memberPublicationQuery: '',
  publicationMemberQuery: ''
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
  memberPhotoFileName: qs('#member-photo-file-name'),
  memberCourseScheduleWrap: qs('#member-course-schedule-wrap'),
  memberCourseScheduleList: qs('#member-course-schedule-list'),
  memberCourseScheduleAdd: qs('#member-course-schedule-add'),
  memberCoursesNoteField: qs('#member-courses-note-field'),
  memberRelatedProjectsField: qs('#member-related-projects-field'),
  memberExperienceList: qs('#member-experience-list'),
  memberExperienceAdd: qs('#member-experience-add'),
  memberFilterTabs: qs('#member-filter-tabs'),
  memberSearchInput: qs('#member-search'),
  memberProjectPicker: qs('#member-project-picker'),
  memberProjectPickerLabel: qs('#member-project-picker-label'),
  projectForm: qs('#project-form'),
  projectList: qs('#project-list'),
  projectTitle: qs('#project-form-title'),
  projectEditorCard: qs('#project-editor-card'),
  projectAddButton: qs('#project-add-button'),
  projectPagination: qs('#project-pagination'),
  projectFilterTabs: qs('#project-filter-tabs'),
  projectSearchInput: qs('#project-search'),
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
  publicationSearchInput: qs('#publication-search-admin'),
  publicationMemberPicker: qs('#publication-member-picker'),
  boardForm: qs('#board-form'),
  boardList: qs('#board-list'),
  boardTitle: qs('#board-form-title'),
  boardEditorCard: qs('#board-editor-card'),
  boardAddButton: qs('#board-add-button'),
  boardPagination: qs('#board-pagination'),
  boardFilterTabs: qs('#board-filter-tabs'),
  boardSearchInput: qs('#board-search'),
  boardImageInput: qs('#board-image-input'),
  boardImagePreview: qs('#board-image-preview'),
  boardImageRemove: qs('#board-image-remove'),
  boardImageFileName: qs('#board-image-file-name'),
  trashList: qs('#trash-list'),
  trashPagination: qs('#trash-pagination'),
  trashFilterTabs: qs('#trash-filter-tabs'),
  trashSearchInput: qs('#trash-search'),
  summaryMembers: qs('#summary-members'),
  summaryProjects: qs('#summary-projects'),
  summaryPublications: qs('#summary-publications'),
  summaryBoard: qs('#summary-board'),
  summaryTrash: qs('#summary-trash'),
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
  const nameKr = String(form.elements.namedItem('nameKr')?.value || '').trim();
  const nameEn = formatEnglishName(String(form.elements.namedItem('nameEn')?.value || '').trim());
  if (!state.editingMember) return;
  state.editingMember = {
    ...state.editingMember,
    nameKr: nameKr || state.editingMember.nameKr || '',
    nameEn: nameEn || state.editingMember.nameEn || '',
    name: nameKr || nameEn || state.editingMember.name || ''
  };
}

function setFormValue(form, fieldName, value) {
  const field = form?.elements?.namedItem(fieldName);
  if (field) field.value = value ?? '';
}


function updateFileInputLabel(input, labelElement, emptyText = '선택된 파일 없음') {
  if (!labelElement) return;
  const [file] = input?.files || [];
  labelElement.textContent = file?.name || emptyText;
}

function normalizeDoiInput(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const withoutLabel = text.replace(/^doi\s*:\s*/i, '').trim();
  const doiMatch = withoutLabel.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  if (doiMatch?.[1]) return doiMatch[1].trim();
  return withoutLabel;
}

function memberDisplayName(member = {}, locale = 'kr') {
  if (locale === 'en') return firstFilledValue(formatEnglishName(member.nameEn), formatEnglishName(member.name), member.nameKr);
  return firstFilledValue(member.nameKr, formatEnglishName(member.name), formatEnglishName(member.nameEn));
}

function normalizeLookupKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
}


function normalizeSearchText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchesSearch(query = '', ...values) {
  const keyword = normalizeSearchText(query);
  if (!keyword) return true;
  return values.some((value) => normalizeSearchText(value).includes(keyword));
}

function memberProjectPickerTitle(group = '', course = '') {
  const isParticipant = group === 'graduateStudent' || group === 'studentResearcher' || ['phd', 'ms', 'undergrad'].includes(course);
  return isParticipant ? '참여 과제 연결' : '관련 과제 연결';
}

function memberProjectSectionVisible(group = '', course = '', status = '') {
  return !(status === 'alumni' || group === 'alumni' || course === 'alumni');
}

const MEMBER_COURSE_OPTIONS = {
  pi: ['professor'],
  researchProfessor: ['postdoc'],
  graduateStudent: ['phd', 'ms'],
  studentResearcher: ['undergrad'],
  alumni: ['phd', 'ms']
};

function memberCourseOptionLabel(value = '', group = '') {
  const isAlumni = group === 'alumni';
  const labels = {
    professor: '교수',
    postdoc: '박사후연구원',
    phd: isAlumni ? '박사과정 졸업' : '박사과정',
    ms: isAlumni ? '석사과정 졸업' : '석사과정',
    undergrad: '학부연구생',
    alumni: '졸업생'
  };
  return labels[value] || value;
}

function syncMemberCourseAndStatus(form) {
  if (!form) return;
  const groupSelect = form.elements.namedItem('group');
  const courseSelect = form.elements.namedItem('course');
  const statusSelect = form.elements.namedItem('status');
  const group = String(groupSelect?.value || '').trim();
  const allowed = MEMBER_COURSE_OPTIONS[group] || MEMBER_COURSE_OPTIONS.graduateStudent;
  if (courseSelect) {
    Array.from(courseSelect.options).forEach((option) => {
      const enabled = allowed.includes(option.value);
      option.hidden = !enabled;
      option.disabled = !enabled;
      option.textContent = memberCourseOptionLabel(option.value, group);
    });
    if (!allowed.includes(courseSelect.value)) {
      courseSelect.value = group === 'alumni' ? 'ms' : (allowed[0] || 'ms');
    }
    const courseField = courseSelect.closest?.('.field');
    const courseLabel = courseField?.querySelector('span');
    if (courseLabel) courseLabel.textContent = group === 'alumni' ? '졸업 과정' : '과정 / 직위';
  }
  const isAlumniGroup = group === 'alumni';
  if (statusSelect) {
    if (isAlumniGroup) statusSelect.value = 'alumni';
    else if (statusSelect.value === 'alumni') statusSelect.value = 'enrolled';
    const statusField = statusSelect.closest?.('.field');
    if (statusField) statusField.hidden = isAlumniGroup;
  }
}

function memberProjectSearchValues(member = {}) {
  return [
    member.nameKr,
    member.nameEn,
    member.name,
    member.email,
    localizedMemberText(member, 'currentPosition', 'kr'),
    localizedMemberText(member, 'currentPosition', 'en'),
    localizedMemberText(member, 'bio', 'kr'),
    localizedMemberText(member, 'bio', 'en')
  ];
}

function projectSearchValues(project = {}) {
  return [
    localizedProjectTitle(project, 'kr'),
    localizedProjectTitle(project, 'en'),
    localizedProjectDescription(project, 'kr'),
    localizedProjectDescription(project, 'en'),
    projectInvestigatorDisplay(project, 'kr'),
    projectInvestigatorDisplay(project, 'en'),
    (Array.isArray(project.tagsKr) ? project.tagsKr : []).join(' '),
    (Array.isArray(project.tagsEn) ? project.tagsEn : []).join(' '),
    (Array.isArray(project.tags) ? project.tags : []).join(' ')
  ];
}

function publicationSearchValues(item = {}) {
  return [item.title, item.authors, item.journal, item.year, item.month, item.doi, item.abstract];
}

function boardSearchValues(item = {}) {
  return [item.title, item.description, item.linkUrl, item.youtubeUrl, item.category, item.date];
}

function trashSearchValues(item = {}) {
  return [item.title, item.originalId, item.kind, item.collectionName, item.deletedAt];
}

function adminMemberGridClass(count = 0) {
  if (count <= 1) return 'admin-member-grid admin-member-grid--1';
  if (count === 2) return 'admin-member-grid admin-member-grid--2';
  return 'admin-member-grid admin-member-grid--3';
}

function adminMemberSection(title, items = []) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return adminSection(title, emptyAdmin('없음'));
  return `<section class="admin-list-section"><h3>${escapeHTML(title)}</h3><div class="${adminMemberGridClass(list.length)}">${list.map(memberItemMarkup).join('')}</div></section>`;
}

function collectMemberProjectLinks() {
  if (!elements.memberProjectPicker) return [];
  return qsa('#member-project-picker input[data-project-id]:checked').map((input) => {
    const project = state.projects.find((item) => item.id === input.dataset.projectId);
    if (!project) return null;
    return {
      projectId: project.id,
      title: localizedProjectTitle(project, 'kr') || localizedProjectTitle(project, 'en'),
      titleKr: localizedProjectTitle(project, 'kr') || '',
      titleEn: localizedProjectTitle(project, 'en') || '',
      period: project.period || '',
      status: project.status || 'ongoing'
    };
  }).filter(Boolean);
}

function memberProjectLinksSummary(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => firstFilledValue(item.titleKr, item.titleEn, item.title))
    .filter(Boolean)
    .join('\n');
}

function renderMemberProjectPicker(selected = []) {
  const container = elements.memberProjectPicker;
  if (!container) return;
  const selectedIds = new Set((Array.isArray(selected) ? selected : []).map((entry) => String(entry?.projectId || entry?.id || '')));
  const items = state.projects.filter((project) => project.status === 'ongoing');
  if (!items.length) {
    container.className = 'project-picker project-picker--empty';
    container.innerHTML = `<p class="muted">현재 진행 중인 과제가 없습니다. 과제 관리에서 먼저 과제를 등록해주세요.</p>`;
    return;
  }
  const cols = items.length <= 1 ? 1 : items.length === 2 ? 2 : 3;
  container.className = `project-picker project-picker--cols-${cols}`;
  container.innerHTML = items.map((project) => {
    const title = localizedProjectTitle(project, 'kr') || localizedProjectTitle(project, 'en');
    const period = normalizeProjectPeriod(project.period || '');
    const investigator = projectInvestigatorDisplay(project, 'kr');
    const checked = selectedIds.has(String(project.id));
    return `<label class="project-picker__item${checked ? ' is-selected' : ''}"><input type="checkbox" data-project-id="${escapeHTML(project.id)}" ${checked ? 'checked' : ''}><span class="project-picker__content"><strong>${escapeHTML(title)}</strong>${period ? `<small>${escapeHTML(period)}</small>` : ''}${investigator ? `<span class="project-picker__hint">${escapeHTML(investigator)}</span>` : ''}</span></label>`;
  }).join('');
}


function findMemberByAnyName(value = '') {
  const target = normalizeLookupKey(value);
  if (!target) return null;
  return state.members.find((member) => {
    return [member.id, member.nameKr, member.nameEn, member.name].some((candidate) => normalizeLookupKey(candidate) === target);
  }) || null;
}

function resolveProjectInvestigatorMember(project = {}) {
  if (project.principalInvestigatorId) {
    const byId = state.members.find((member) => member.id === project.principalInvestigatorId);
    if (byId) return byId;
  }
  return findMemberByAnyName(project.principalInvestigator || '');
}

function projectInvestigatorDisplay(project = {}, locale = 'kr') {
  const member = resolveProjectInvestigatorMember(project);
  if (member) return memberDisplayName(member, locale);
  return project.principalInvestigator || '';
}

function localizedMemberText(member = {}, key, locale = 'kr') {
  const primary = locale === 'en' ? `${key}En` : `${key}Kr`;
  const secondary = locale === 'en' ? `${key}Kr` : `${key}En`;
  return firstFilledValue(member[primary], member[key], member[secondary]);
}

function experienceDetail(entry = {}, locale = 'kr') {
  return locale === 'en'
    ? firstFilledValue(entry.detailEn, entry.detail, entry.detailKr)
    : firstFilledValue(entry.detailKr, entry.detail, entry.detailEn);
}

function activeItems(items = []) {
  return (Array.isArray(items) ? items : []).filter(isActiveItem);
}

function experienceRowTemplate(entry = {}, index = 0) {
  const detailKr = firstFilledValue(entry.detailKr, entry.detail);
  const detailEn = firstFilledValue(entry.detailEn, entry.detail);
  return `
    <article class="experience-row" data-experience-row="${index}">
      <label class="field field--compact"><span>연도</span><input data-experience-field="period" type="text" value="${escapeHTML(entry.period || '')}" placeholder="2006–2008"></label>
      <label class="field field--compact experience-row__detail"><span>경력 (한국어) · 직위 | 소속</span><input data-experience-field="detailKr" type="text" value="${escapeHTML(detailKr || '')}" placeholder="박사후연구원 | 도쿄대학교"></label>
      <label class="field field--compact experience-row__detail"><span>Experience (English) · Position | Affiliation</span><input data-experience-field="detailEn" type="text" value="${escapeHTML(detailEn || '')}" placeholder="Postdoctoral Fellow | University of Tokyo"></label>
      <div class="experience-row__actions"><button type="button" class="small-button is-danger" data-experience-remove>삭제</button></div>
    </article>
  `;
}

function renderMemberExperienceRows(entries = []) {
  if (!elements.memberExperienceList) return;
  const rows = Array.isArray(entries) && entries.length ? entries : [{ period: '', detail: '' }];
  elements.memberExperienceList.innerHTML = rows.map((entry, index) => experienceRowTemplate(entry, index)).join('');
  elements.memberExperienceList.querySelectorAll('[data-experience-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      button.closest('.experience-row')?.remove();
      if (!elements.memberExperienceList?.children.length) renderMemberExperienceRows([]);
    });
  });
}

function collectMemberExperienceEntries() {
  const list = elements.memberExperienceList;
  if (!list) return [];
  return Array.from(list.querySelectorAll('.experience-row')).map((row) => {
    const period = String(row.querySelector('[data-experience-field="period"]')?.value || '').trim();
    const detailKr = String(row.querySelector('[data-experience-field="detailKr"]')?.value || '').trim();
    const detailEn = String(row.querySelector('[data-experience-field="detailEn"]')?.value || '').trim();
    return { period, detailKr, detailEn, detail: firstFilledValue(detailKr, detailEn) };
  }).filter((entry) => entry.period || entry.detailKr || entry.detailEn || entry.detail);
}

function buildExperienceText(entries = [], locale = 'kr') {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const period = String(entry?.period || '').trim();
    const detail = experienceDetail(entry, locale);
    if (period && detail) return `${period} | ${detail}`;
    return detail || period;
  }).filter(Boolean).join('\n');
}

function courseScheduleRowTemplate(entry = {}, index = 0) {
  const days = [
    ['월', '월'], ['화', '화'], ['수', '수'], ['목', '목'], ['금', '금']
  ];
  return `
    <article class="course-schedule-row" data-schedule-row="${index}">
      <label class="field field--compact"><span>요일</span><select data-schedule-field="day">${days.map(([value, label]) => `<option value="${escapeHTML(value)}" ${String(entry.day || '') === value ? 'selected' : ''}>${escapeHTML(label)}</option>`).join('')}</select></label>
      <label class="field field--compact"><span>시간</span><input data-schedule-field="time" type="text" value="${escapeHTML(entry.time || '')}" placeholder="09:00-10:15"></label>
      <label class="field field--compact"><span>강의명</span><input data-schedule-field="courseName" type="text" value="${escapeHTML(entry.courseName || '')}" placeholder="스마트농업개론"></label>
      <label class="field field--compact"><span>학점</span><input data-schedule-field="credits" type="text" value="${escapeHTML(entry.credits || '')}" placeholder="3"></label>
      <label class="field field--compact course-schedule-row__description"><span>강의 내용</span><input data-schedule-field="description" type="text" value="${escapeHTML(entry.description || '')}" placeholder="식물공장, 환경제어"></label>
      <div class="course-schedule-row__actions"><button type="button" class="small-button is-danger" data-schedule-remove>삭제</button></div>
    </article>
  `;
}

function renderMemberCourseSchedule(schedule = []) {
  if (!elements.memberCourseScheduleList) return;
  const rows = Array.isArray(schedule) && schedule.length ? schedule : [{ day: '월', time: '', courseName: '', credits: '', description: '' }];
  elements.memberCourseScheduleList.innerHTML = rows.map((entry, index) => courseScheduleRowTemplate(entry, index)).join('');
  elements.memberCourseScheduleList.querySelectorAll('[data-schedule-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('.course-schedule-row');
      row?.remove();
      if (!elements.memberCourseScheduleList?.children.length) renderMemberCourseSchedule([]);
    });
  });
}

function collectMemberCourseSchedule() {
  const list = elements.memberCourseScheduleList;
  if (!list) return [];
  return Array.from(list.querySelectorAll('.course-schedule-row')).map((row) => ({
    day: String(row.querySelector('[data-schedule-field="day"]')?.value || '').trim(),
    time: String(row.querySelector('[data-schedule-field="time"]')?.value || '').trim(),
    courseName: String(row.querySelector('[data-schedule-field="courseName"]')?.value || '').trim(),
    credits: String(row.querySelector('[data-schedule-field="credits"]')?.value || '').trim(),
    description: String(row.querySelector('[data-schedule-field="description"]')?.value || '').trim()
  })).filter((entry) => Object.values(entry).some((value) => String(value || '').trim()));
}

function numericYearSort(value) {
  return Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
}

function adminErrorMessage(error, fallback) {
  if (error?.code === 'permission-denied' || /Missing or insufficient permissions/i.test(error?.message || '')) {
    return `${fallback} Firestore 보안 규칙에 ${COLLECTIONS.board} / ${COLLECTIONS.members} / ${COLLECTIONS.projects} / ${COLLECTIONS.publications} / ${COLLECTIONS.trash} 쓰기 권한이 반영되었는지 확인해주세요.`;
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
  ensureEditorPseudoHidden();
  const target = editorElement(kind);
  if (!target) return;
  state.openEditorKind = kind;
  target.hidden = false;
  target.classList.add('is-open');
  target.style.background = '#ffffff';
  target.style.backgroundImage = 'none';
  document.body.classList.add('modal-open');
}

function closeEditor(kind) {
  const target = editorElement(kind);
  if (!target) return;
  target.classList.remove('is-open');
  target.hidden = true;
  if (state.openEditorKind === kind) state.openEditorKind = '';
  if (!state.openEditorKind && elements.dialog?.hidden !== false) document.body.classList.remove('modal-open');
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

function publicationRoleLabel(role) {
  const map = { first: '제1저자', co: '공동저자', corresponding: '교신저자' };
  return map[role] || role;
}


function publicationLinkMatchesPublication(link = {}, publication = {}) {
  const linkId = String(link?.publicationId || link?.id || '').trim();
  const publicationId = String(publication?.id || '').trim();
  if (linkId && publicationId) return linkId === publicationId;
  const linkTitle = String(link?.title || '').trim();
  const publicationTitle = String(publication?.title || '').trim();
  return Boolean(linkTitle && publicationTitle && linkTitle === publicationTitle);
}

function publicationSearchableText(publication = {}) {
  return normalizeSearchText([
    publication.title,
    publication.authors,
    publication.journal,
    publication.year,
    publication.month,
    publication.doi
  ].filter(Boolean).join(' '));
}

function memberSearchableText(member = {}) {
  return normalizeSearchText([
    member.nameKr,
    member.nameEn,
    member.name,
    member.email,
    member.currentPositionKr,
    member.currentPositionEn,
    member.currentPosition
  ].filter(Boolean).join(' '));
}

function updatePublicationPickerGroupVisibility(container) {
  if (!container) return;
  qsa('.publication-picker__group', container).forEach?.(() => {});
}

function filterPublicationPicker(container, query = '') {
  if (!container) return;
  const keyword = normalizeSearchText(query);
  const items = Array.from(container.querySelectorAll('.publication-picker__item'));
  items.forEach((row) => {
    const matched = !keyword || String(row.dataset.search || '').includes(keyword);
    row.hidden = !matched;
    row.style.display = matched ? '' : 'none';
  });
  Array.from(container.querySelectorAll('.publication-picker__group')).forEach((group) => {
    const hasVisibleItems = Array.from(group.querySelectorAll('.publication-picker__item')).some((row) => !row.hidden);
    group.hidden = !hasVisibleItems;
    group.style.display = hasVisibleItems ? '' : 'none';
  });
  let empty = container.querySelector('.publication-picker__empty');
  const anyVisible = items.some((row) => !row.hidden);
  if (!anyVisible) {
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'muted publication-picker__empty';
      empty.textContent = '검색 결과가 없습니다.';
      container.appendChild(empty);
    }
  } else if (empty) {
    empty.remove();
  }
}

function onPublicationPickerInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.matches('[data-publication-picker-search]')) {
    state.memberPublicationQuery = target.value || '';
    filterPublicationPicker(qs('#member-publication-picker'), state.memberPublicationQuery);
    return;
  }
  if (target.matches('[data-publication-member-search]')) {
    state.publicationMemberQuery = target.value || '';
    filterPublicationPicker(elements.publicationMemberPicker, state.publicationMemberQuery);
  }
}

function bindPublicationSearchInput(container, selector, onUpdate) {
  if (!container) return;
  const input = container.querySelector(selector);
  if (!input || input.dataset.searchBound === 'true') return;
  const apply = () => {
    const query = input.value || '';
    onUpdate(query);
  };
  ['input', 'keyup', 'change', 'search'].forEach((eventName) => {
    input.addEventListener(eventName, apply);
  });
  input.dataset.searchBound = 'true';
}

function resolvePublicationMemberLinks(publication = {}) {
  const derived = state.members.map((member) => {
    const link = (Array.isArray(member.publicationLinks) ? member.publicationLinks : []).find((item) => publicationLinkMatchesPublication(item, publication));
    if (!link) return null;
    return {
      memberId: member.id,
      memberName: memberDisplayName(member),
      email: member.email || '',
      roles: Array.isArray(link.roles) ? link.roles.filter(Boolean) : []
    };
  }).filter(Boolean);
  if (derived.length) return derived;
  return Array.isArray(publication.memberLinks) ? publication.memberLinks.map((item) => ({
    memberId: item.memberId || item.id || '',
    memberName: item.memberName || '',
    email: item.email || '',
    roles: Array.isArray(item.roles) ? item.roles.filter(Boolean) : []
  })) : [];
}

function renderPublicationMemberPicker(selected = []) {
  const container = elements.publicationMemberPicker;
  if (!container) return;
  const selectedMap = new Map();
  (Array.isArray(selected) ? selected : []).forEach((item) => {
    const key = item.memberId || item.id;
    if (key) selectedMap.set(String(key), item);
  });
  const searchMarkup = `<label class="publication-picker__search-row"><input type="search" class="publication-picker__search-input" data-publication-member-search placeholder="멤버 이름, 영문 이름, 이메일 검색" value="${escapeHTML(state.publicationMemberQuery)}"></label>`;
  const allMembers = sortMembers(state.members.slice());
  if (!allMembers.length) {
    container.innerHTML = '<p class="muted">등록된 멤버가 없습니다.</p>';
    return;
  }
  const items = allMembers;
  container.innerHTML = `${searchMarkup}<section class="publication-picker__group"><div class="publication-picker__group-title">멤버</div><div class="publication-picker__table"><div class="publication-picker__row publication-picker__row--head"><span class="publication-picker__cell publication-picker__cell--info">멤버</span><span class="publication-picker__cell publication-picker__cell--role">제1저자</span><span class="publication-picker__cell publication-picker__cell--role">공동저자</span><span class="publication-picker__cell publication-picker__cell--role">교신저자</span></div>${items.map((member) => {
    const picked = selectedMap.get(member.id) || {};
    const roles = Array.isArray(picked.roles) ? picked.roles : [];
    const detail = [member.email].filter(Boolean).join(' · ');
    return `<article class="publication-picker__row publication-picker__item" data-search="${escapeHTML(memberSearchableText(member))}"><div class="publication-picker__cell publication-picker__cell--info"><strong>${escapeHTML(memberDisplayName(member,'kr'))}</strong>${detail ? `<small class="muted">${escapeHTML(detail)}</small>` : ''}</div><label class="publication-picker__cell publication-picker__cell--role publication-picker__check"><input type="checkbox" data-publication-member-role="first" data-member-id="${escapeHTML(member.id)}" aria-label="${escapeHTML(memberDisplayName(member,'kr'))} 제1저자" ${roles.includes('first') ? 'checked' : ''}></label><label class="publication-picker__cell publication-picker__cell--role publication-picker__check"><input type="checkbox" data-publication-member-role="co" data-member-id="${escapeHTML(member.id)}" aria-label="${escapeHTML(memberDisplayName(member,'kr'))} 공동저자" ${roles.includes('co') ? 'checked' : ''}></label><label class="publication-picker__cell publication-picker__cell--role publication-picker__check"><input type="checkbox" data-publication-member-role="corresponding" data-member-id="${escapeHTML(member.id)}" aria-label="${escapeHTML(memberDisplayName(member,'kr'))} 교신저자" ${roles.includes('corresponding') ? 'checked' : ''}></label></article>`;
  }).join('')}</div></section>`;
  bindPublicationSearchInput(container, '[data-publication-member-search]', (query) => { state.publicationMemberQuery = query; filterPublicationPicker(container, query); });
  filterPublicationPicker(container, state.publicationMemberQuery);
}

function collectPublicationMemberLinks() {
  const picker = elements.publicationMemberPicker;
  if (!picker) return [];
  const roleMap = new Map();
  Array.from(picker.querySelectorAll('[data-publication-member-role]:checked')).forEach((el) => {
    const id = el.dataset.memberId;
    if (!id) return;
    if (!roleMap.has(id)) roleMap.set(id, []);
    roleMap.get(id).push(el.dataset.publicationMemberRole);
  });
  return Array.from(roleMap.entries()).map(([memberId, roles]) => {
    const member = state.members.find((item) => item.id === memberId);
    return {
      memberId,
      memberName: memberDisplayName(member || {}),
      email: member?.email || '',
      roles
    };
  });
}

async function syncPublicationLinksToMembers(publication = {}, memberLinks = []) {
  const linkMap = new Map((Array.isArray(memberLinks) ? memberLinks : []).map((item) => [String(item.memberId), item]));
  const nextMembers = state.members.map((member) => {
    const existingLinks = Array.isArray(member.publicationLinks) ? member.publicationLinks : [];
    const retained = existingLinks.filter((link) => !publicationLinkMatchesPublication(link, publication));
    const selected = linkMap.get(String(member.id));
    const nextLinks = selected
      ? [...retained, {
          publicationId: publication.id,
          title: publication.title || '',
          year: publication.year || '',
          month: publication.month || '',
          journal: publication.journal || '',
          doi: publication.doi || '',
          roles: Array.isArray(selected.roles) ? selected.roles.filter(Boolean) : []
        }]
      : retained;
    return {
      ...member,
      publicationLinks: nextLinks,
      authorshipNote: publicationLinksSummary(nextLinks)
    };
  });
  const changed = nextMembers.filter((member, index) => JSON.stringify(member.publicationLinks || []) !== JSON.stringify(state.members[index]?.publicationLinks || []));
  await Promise.all(changed.map((member) => saveDocument(COLLECTIONS.members, member.id, member)));
  state.members = activeItems(sortMembers(nextMembers));
}

function ensureEditorPseudoHidden() {
  if (document.getElementById('debug-hide-pseudo')) return;
  const el = document.querySelector('article#member-editor-card');
  if (!el) return;
  const styleTag = document.createElement('style');
  styleTag.id = 'debug-hide-pseudo';
  styleTag.innerHTML = `
    article#member-editor-card::before,
    .admin-editor-modal::before {
      display: none !important;
      content: none !important;
    }
  `;
  document.head.appendChild(styleTag);
}

document.addEventListener('DOMContentLoaded', async () => {
  ensureEditorPseudoHidden();
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
  elements.trashFilterTabs?.addEventListener('click', onTrashFilterClick);
  elements.memberForm?.addEventListener('submit', handleMemberSubmit);
  elements.memberForm?.elements?.namedItem('nameKr')?.addEventListener('input', syncMemberNameField);
  elements.memberForm?.elements?.namedItem('nameEn')?.addEventListener('input', syncMemberNameField);
  elements.memberForm?.elements?.namedItem('group')?.addEventListener('change', updateMemberEducationVisibility);
  elements.memberForm?.elements?.namedItem('course')?.addEventListener('change', updateMemberEducationVisibility);
  elements.memberForm?.elements?.namedItem('status')?.addEventListener('change', updateMemberEducationVisibility);
  elements.memberSearchInput?.addEventListener('input', (event) => { state.memberQuery = event.currentTarget.value; state.memberPage = 1; renderMembersList(); });
  elements.projectSearchInput?.addEventListener('input', (event) => { state.projectQuery = event.currentTarget.value; state.projectPage = 1; renderProjectsList(); });
  elements.publicationSearchInput?.addEventListener('input', (event) => { state.publicationQuery = event.currentTarget.value; state.publicationPage = 1; renderPublicationsList(); });
  elements.boardSearchInput?.addEventListener('input', (event) => { state.boardQuery = event.currentTarget.value; state.boardPage = 1; renderBoardList(); });
  elements.trashSearchInput?.addEventListener('input', (event) => { state.trashQuery = event.currentTarget.value; state.trashPage = 1; renderTrashList(); });
  elements.memberCourseScheduleAdd?.addEventListener('click', () => {
    const current = collectMemberCourseSchedule();
    current.push({ day: '월', time: '', courseName: '', credits: '', description: '' });
    renderMemberCourseSchedule(current);
  });
  elements.memberExperienceAdd?.addEventListener('click', () => {
    const current = collectMemberExperienceEntries();
    current.push({ period: '', detail: '' });
    renderMemberExperienceRows(current);
  });
  qs('#member-publication-picker')?.addEventListener('click', onPublicationPickerClick);
  qs('#member-publication-picker')?.addEventListener('input', onPublicationPickerInput);
  elements.publicationMemberPicker?.addEventListener('input', onPublicationPickerInput);
  elements.memberProjectPicker?.addEventListener('change', () => { qsa('#member-project-picker .project-picker__item').forEach((label) => label.classList.toggle('is-selected', Boolean(label.querySelector('input[data-project-id]')?.checked))); });
  document.addEventListener('pointerdown', (event) => {
    if (!state.openEditorKind) return;
    if (elements.dialog && !elements.dialog.hidden && elements.dialog.contains(event.target)) return;
    const editor = editorElement(state.openEditorKind);
    if (!editor || editor.hidden) return;
    if (editor.contains(event.target)) return;
    closeEditor(state.openEditorKind);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.openEditorKind) closeEditor(state.openEditorKind);
    else if (elements.dialog && !elements.dialog.hidden) closeDialog(null);
  });
  elements.projectForm?.addEventListener('submit', handleProjectSubmit);
  elements.publicationForm?.addEventListener('submit', handlePublicationSubmit);
  elements.boardForm?.addEventListener('submit', handleBoardSubmit);
  elements.memberPhotoInput?.addEventListener('change', onMemberPhotoChange);
  elements.memberPhotoRemove?.addEventListener('click', clearMemberPhoto);
  elements.projectFigureInput?.addEventListener('change', onProjectFigureChange);
  elements.projectFigureRemove?.addEventListener('click', clearProjectFigure);
  elements.boardImageInput?.addEventListener('change', onBoardImageChange);
  elements.boardImageRemove?.addEventListener('click', clearBoardImage);
  elements.boardImagePreview?.addEventListener('click', (event) => { const button = event.target.closest?.('[data-board-preview-remove]'); if (!button) return; event.preventDefault(); removeBoardImageAt(Number(button.dataset.boardPreviewRemove)); });
  qs('#member-reset')?.addEventListener('click', resetMemberForm);
  qs('#project-reset')?.addEventListener('click', resetProjectForm);
  qs('#publication-reset')?.addEventListener('click', resetPublicationForm);
  qs('#board-reset')?.addEventListener('click', resetBoardForm);
  elements.memberList?.addEventListener('click', onMemberListClick);
  elements.projectList?.addEventListener('click', onProjectListClick);
  elements.publicationList?.addEventListener('click', onPublicationListClick);
  elements.boardList?.addEventListener('click', onBoardListClick);
  elements.trashList?.addEventListener('click', onTrashListClick);
  elements.dialogCancel?.addEventListener('click', () => closeDialog(null));
  elements.dialogConfirm?.addEventListener('click', submitDialog);
  qsa('[data-dialog-close]').forEach((btn) => btn.addEventListener('click', () => closeDialog(null)));
  elements.dialog?.addEventListener('click', (event) => {
    if (event.target === elements.dialog || event.target.closest('[data-dialog-close]')) closeDialog(null);
  });
}


function educationLevelForMember(formOrMember = {}) {
  const group = String(formOrMember.group || '').trim();
  const status = String(formOrMember.status || '').trim();
  const course = String(formOrMember.course || formOrMember.enrolledCourse || formOrMember.restoreCourse || '').trim();
  const isAlumni = group === 'alumni' || status === 'alumni';
  if (isAlumni) {
    if (course === 'phd') return 'phd';
    if (course === 'ms') return 'ms';
    return 'ms';
  }
  if (group === 'pi' || group === 'researchProfessor' || course === 'professor' || course === 'postdoc') return 'phd';
  if (course === 'phd') return 'ms';
  if (course === 'ms') return 'bs';
  return 'phd';
}

function firstFilledValue(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function degreeValue(payload = {}, key, locale = 'en') {
  const suffix = locale === 'kr' ? 'Kr' : 'En';
  const opposite = locale === 'kr' ? 'En' : 'Kr';
  return firstFilledValue(payload[`${key}${suffix}`], payload[key], payload[`${key}${opposite}`]);
}

function buildEducationLines(payload = {}) {
  const lines = [];
  const bsSchool = degreeValue(payload, 'bachelorsSchool', 'en');
  const bsMajor = degreeValue(payload, 'bachelorsMajor', 'en');
  const msSchool = degreeValue(payload, 'mastersSchool', 'en');
  const msMajor = degreeValue(payload, 'mastersMajor', 'en');
  const phdSchool = degreeValue(payload, 'doctoralSchool', 'en');
  const phdMajor = degreeValue(payload, 'doctoralMajor', 'en');
  if (bsSchool || bsMajor) lines.push(`B.S. ${bsSchool || ''}${bsMajor ? `
${bsMajor}` : ''}`.trim());
  if (msSchool || msMajor) lines.push(`M.S. ${msSchool || ''}${msMajor ? `
${msMajor}` : ''}`.trim());
  if (phdSchool || phdMajor) lines.push(`Ph.D. ${phdSchool || ''}${phdMajor ? `
${phdMajor}` : ''}`.trim());
  return lines.join('\n');
}


function updateMemberEducationVisibility() {
  const form = elements.memberForm;
  if (!form) return;
  syncMemberCourseAndStatus(form);
  const group = String(form.elements.namedItem('group')?.value || '').trim();
  const course = String(form.elements.namedItem('course')?.value || '').trim();
  const status = String(form.elements.namedItem('status')?.value || '').trim();
  const level = educationLevelForMember({ group, course, status });
  const showBs = ['bs','ms','phd'].includes(level);
  const showMs = ['ms','phd'].includes(level);
  const showPhd = level === 'phd';
  qsa('.degree-field[data-degree-level="bs"]').forEach((el) => el.hidden = !showBs);
  qsa('.degree-field[data-degree-level="ms"]').forEach((el) => el.hidden = !showMs);
  qsa('.degree-field[data-degree-level="phd"]').forEach((el) => el.hidden = !showPhd);
  const isPi = group === 'pi' || course === 'professor';
  if (elements.memberCourseScheduleWrap) elements.memberCourseScheduleWrap.hidden = !isPi;
  if (elements.memberCoursesNoteField) elements.memberCoursesNoteField.hidden = !isPi;
  const showProjects = memberProjectSectionVisible(group, course, status);
  if (elements.memberRelatedProjectsField) elements.memberRelatedProjectsField.hidden = !showProjects;
  if (elements.memberProjectPickerLabel) elements.memberProjectPickerLabel.textContent = `${memberProjectPickerTitle(group, course)} (현재 진행 중 과제만)`;
}

function renderMemberPublicationPicker(selected = []) {
  const container = qs('#member-publication-picker');
  if (!container) return;
  const selectedItems = Array.isArray(selected) ? selected : [];
  const selectedMap = new Map();
  selectedItems.forEach((item) => {
    const key = item.publicationId || item.id || item.title;
    if (key) selectedMap.set(String(key), item);
  });
  const searchMarkup = `<label class="publication-picker__search-row"><input type="search" class="publication-picker__search-input" data-publication-picker-search placeholder="논문 제목, 저자, 저널, DOI 검색" value="${escapeHTML(state.memberPublicationQuery)}"></label>`;
  if (!state.publications.length) {
    container.innerHTML = `<p class="muted">등록된 논문이 없습니다. 논문 관리에서 먼저 논문을 추가해주세요.</p>`;
    return;
  }
  const items = state.publications.slice();
  const groups = Object.entries(groupBy(items, (pub) => pub.year || '미정'))
    .sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
  const toolbar = `
    ${searchMarkup}
    <div class="publication-picker__toolbar">
      <button type="button" class="small-button" data-publication-bulk="all">모두 선택</button>
      <button type="button" class="small-button" data-publication-bulk="first">제1저자 전체</button>
      <button type="button" class="small-button" data-publication-bulk="co">공동저자 전체</button>
      <button type="button" class="small-button" data-publication-bulk="corresponding">교신저자 전체</button>
      <button type="button" class="small-button secondary" data-publication-bulk="clear">전체 해제</button>
    </div>
  `;
  container.innerHTML = toolbar + groups.map(([year, yearItems]) => `
    <section class="publication-picker__group">
      <div class="publication-picker__group-title">${escapeHTML(year)}</div>
      <div class="publication-picker__table">
        <div class="publication-picker__row publication-picker__row--head">
          <span class="publication-picker__cell publication-picker__cell--info">논문 정보</span>
          <span class="publication-picker__cell publication-picker__cell--role">제1저자</span>
          <span class="publication-picker__cell publication-picker__cell--role">공동저자</span>
          <span class="publication-picker__cell publication-picker__cell--role">교신저자</span>
        </div>
        ${yearItems.map((pub) => {
          const picked = selectedMap.get(pub.id) || selectedMap.get(pub.title) || {};
          const roles = Array.isArray(picked.roles) ? picked.roles : [];
          const meta = [publicationYearMonthLabel(pub), pub.journal].filter(Boolean).join(' · ');
          return `
            <article class="publication-picker__row publication-picker__item" data-search="${escapeHTML(publicationSearchableText(pub))}">
              <div class="publication-picker__cell publication-picker__cell--info">
                <strong>${escapeHTML(pub.title)}</strong>
                ${meta ? `<small class="muted">${escapeHTML(meta)}</small>` : ''}
              </div>
              <label class="publication-picker__cell publication-picker__cell--role publication-picker__check"><input type="checkbox" data-pub-role="first" data-pub-id="${escapeHTML(pub.id)}" aria-label="${escapeHTML(pub.title)} 제1저자" ${roles.includes('first') ? 'checked' : ''}></label>
              <label class="publication-picker__cell publication-picker__cell--role publication-picker__check"><input type="checkbox" data-pub-role="co" data-pub-id="${escapeHTML(pub.id)}" aria-label="${escapeHTML(pub.title)} 공동저자" ${roles.includes('co') ? 'checked' : ''}></label>
              <label class="publication-picker__cell publication-picker__cell--role publication-picker__check"><input type="checkbox" data-pub-role="corresponding" data-pub-id="${escapeHTML(pub.id)}" aria-label="${escapeHTML(pub.title)} 교신저자" ${roles.includes('corresponding') ? 'checked' : ''}></label>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `).join('');
  bindPublicationSearchInput(container, '[data-publication-picker-search]', (query) => { state.memberPublicationQuery = query; filterPublicationPicker(container, query); });
  filterPublicationPicker(container, state.memberPublicationQuery);
}


function onPublicationPickerClick(event) {
  const button = event.target.closest('[data-publication-bulk]');
  if (!button) return;
  const picker = qs('#member-publication-picker');
  if (!picker) return;
  const action = button.dataset.publicationBulk;
  if (action === 'clear') {
    picker.querySelectorAll('[data-pub-role]').forEach((input) => {
      input.checked = false;
    });
    return;
  }
  if (action === 'all') {
    picker.querySelectorAll('[data-pub-role]').forEach((input) => {
      input.checked = true;
    });
    return;
  }
  picker.querySelectorAll(`[data-pub-role="${action}"]`).forEach((input) => {
    input.checked = true;
  });
}

function collectMemberPublicationLinks() {
  const picker = qs('#member-publication-picker');
  if (!picker) return [];
  const roleMap = new Map();
  Array.from(picker.querySelectorAll('[data-pub-role]:checked')).forEach((el) => {
    const id = el.dataset.pubId;
    if (!id) return;
    if (!roleMap.has(id)) roleMap.set(id, []);
    roleMap.get(id).push(el.dataset.pubRole);
  });
  return Array.from(roleMap.entries()).map(([id, roles]) => {
    const pub = state.publications.find((item) => item.id === id);
    return {
      publicationId: id,
      title: pub?.title || '',
      year: pub?.year || '',
      month: pub?.month || '',
      journal: pub?.journal || '',
      roles
    };
  });
}

function publicationLinksSummary(links = []) {
  if (!Array.isArray(links) || !links.length) return '';
  return links.map((item) => {
    const roleText = Array.isArray(item.roles) ? item.roles.map((key) => publicationRoleLabel(key)).join(', ') : '';
    return `${item.title}${roleText ? ` (${roleText})` : ''}`;
  }).join('\n');
}

function renderSetupMessage() {
  if (!elements.authNotice) return;
  if (isLocalDevMode) {
    elements.authNotice.hidden = false;
    elements.authNotice.textContent = '로컬 개발 모드입니다. localhost에서는 Google 로그인 없이 관리자 화면을 미리볼 수 있으며, 변경사항은 이 브라우저의 localStorage에 저장됩니다.';
    if (elements.googleLoginButton) elements.googleLoginButton.textContent = '로컬 개발 모드 시작';
    if (elements.loginShortcutButton) elements.loginShortcutButton.textContent = '로컬 관리자';
    return;
  }
  if (!hasFirebaseConfig) {
    elements.authNotice.hidden = false;
    elements.authNotice.textContent = 'firebase-config.js 설정을 입력하면 Google 로그인과 관리자 저장 기능이 활성화됩니다.';
    return;
  }
  elements.authNotice.textContent = '';
  elements.authNotice.hidden = true;
  if (elements.googleLoginButton) elements.googleLoginButton.textContent = 'Google 계정으로 로그인';
  if (elements.loginShortcutButton) elements.loginShortcutButton.textContent = '로그인';
}

async function handleGoogleLogin() {
  if (!hasFirebaseConfig) {
    showNotice('먼저 firebase-config.js를 채워주세요.', 'warning');
    return;
  }
  togglePending(true);
  elements.googleLoginButton?.setAttribute('disabled', 'disabled');
  elements.loginShortcutButton?.setAttribute('disabled', 'disabled');
  showNotice(isLocalDevMode ? '로컬 개발 모드로 관리자 화면을 엽니다.' : 'Google 로그인 창을 엽니다.', 'info');
  try {
    const credential = await signInAdminWithGoogle();
    if (credential?.user) {
      await handleAuthState(credential.user);
      return;
    }
    showNotice(isLocalDevMode ? '로컬 관리자 모드가 활성화되었습니다.' : '계정 선택 후 다시 관리자 페이지로 돌아옵니다.', 'info');
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
    const [members, projects, publications, board, trash] = await Promise.all([
      fetchCollection(COLLECTIONS.members),
      fetchCollection(COLLECTIONS.projects),
      fetchCollection(COLLECTIONS.publications),
      fetchCollection(COLLECTIONS.board),
      fetchCollection(COLLECTIONS.trash)
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
      state.members = activeItems(sortMembers(mergeMembers(FALLBACK_MEMBERS, items)));
      renderMembersList();
      renderProjectLeadOptions();
      renderMemberPublicationPicker(state.editingMember?.publicationLinks || []);
      renderSummary();
    }),
    listenCollection(COLLECTIONS.projects, (items) => {
      state.projects = activeItems(sortProjects(mergeProjects(FALLBACK_PROJECTS, items)));
      renderProjectsList();
      renderSummary();
    }),
    listenCollection(COLLECTIONS.publications, (items) => {
      state.publications = activeItems(sortPublications(mergePublications(FALLBACK_PUBLICATIONS, items)));
      renderPublicationsList();
      renderSummary();
    }),
    listenCollection(COLLECTIONS.board, (items) => {
      state.board = activeItems(sortBoardPosts(mergeBoardPosts(FALLBACK_BOARD_POSTS, items)));
      renderBoardList();
      renderSummary();
    }),
    listenCollection(COLLECTIONS.trash, (items) => {
      state.trash = sortTrashItems(items);
      renderTrashList();
      renderSummary();
      cleanupExpiredTrash().catch((error) => console.error(error));
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
  if (elements.summaryTrash) elements.summaryTrash.textContent = state.trash.length;
}

function sortTrashItems(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
}

function trashTypeLabel(type = '') {
  const map = { member: '멤버', project: '과제', publication: '논문', board: '소식' };
  return map[type] || '기타';
}

function trashTitle(item = {}) {
  return item.title || item.payload?.title || item.payload?.nameKr || item.payload?.nameEn || item.payload?.name || item.originalId || '제목 없음';
}

function storagePathsForPayload(payload = {}) {
  return [payload?.photoPath, payload?.figurePath, payload?.imagePath]
    .map((value) => String(value || '').trim())
    .filter((value) => value && !value.startsWith('inline:') && !value.startsWith('data:'));
}

let trashCleanupRunning = false;
async function cleanupExpiredTrash() {
  if (trashCleanupRunning || !state.user || !state.trash.length) return;
  const now = Date.now();
  const expired = state.trash.filter((item) => {
    const time = Date.parse(String(item.purgeAfterAt || ''));
    return Number.isFinite(time) && time <= now;
  });
  if (!expired.length) return;
  trashCleanupRunning = true;
  try {
    for (const item of expired) {
      await permanentlyDeleteTrashItem(item, { silent: true });
    }
  } finally {
    trashCleanupRunning = false;
  }
}

async function moveItemToTrash(itemType, collectionName, item, title) {
  const now = new Date();
  const deletedAt = now.toISOString();
  const purgeAfterAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const payload = { ...item, deleted: false, deletedAt: '', purgeAfterAt: '', trashExpired: false };
  const trashId = `${itemType}__${item.id}`;
  const trashEntry = {
    id: trashId,
    itemType,
    originalCollection: collectionName,
    originalId: item.id,
    title,
    deletedAt,
    purgeAfterAt,
    payload
  };
  await saveDocument(COLLECTIONS.trash, trashId, trashEntry);
  await saveDocument(collectionName, item.id, {
    id: item.id,
    deleted: true,
    deletedAt,
    purgeAfterAt,
    trashExpired: false
  });
  return trashEntry;
}

async function restoreTrashItem(item) {
  const payload = item?.payload || null;
  if (!item || !payload) return;
  await saveDocument(item.originalCollection || COLLECTIONS[item.itemType], item.originalId, {
    ...payload,
    deleted: false,
    deletedAt: '',
    purgeAfterAt: '',
    trashExpired: false
  });
  await deleteDocumentById(COLLECTIONS.trash, item.id);
}

async function permanentlyDeleteTrashItem(item, options = {}) {
  if (!item) return;
  const payload = item.payload || {};
  for (const path of storagePathsForPayload(payload)) {
    try { await deleteStoragePath(path); } catch (error) { console.warn(error); }
  }
  await saveDocument(item.originalCollection || COLLECTIONS[item.itemType], item.originalId, {
    id: item.originalId,
    deleted: true,
    deletedAt: item.deletedAt || new Date().toISOString(),
    purgeAfterAt: item.purgeAfterAt || '',
    trashExpired: true
  });
  await deleteDocumentById(COLLECTIONS.trash, item.id);
  if (!options.silent) showNotice('휴지통 항목이 영구 삭제되었습니다.', 'success');
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
    elements.dialogInputWrap.style.display = type === 'prompt' ? '' : 'none';
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
  if (!state.openEditorKind) document.body.classList.remove('modal-open');
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
  const currentProject = state.editingProject || {};
  const currentMember = resolveProjectInvestigatorMember(currentProject);
  const currentValue = currentMember?.id || currentProject.principalInvestigatorId || currentProject.principalInvestigator || '';
  const candidates = sortMembers(state.members).filter((member) => member.status !== 'alumni' && ['pi', 'researchProfessor'].includes(member.group));
  const seen = new Set();
  const options = ['<option value="">선택</option>'];
  candidates.forEach((member) => {
    if (!member?.id || seen.has(member.id)) return;
    seen.add(member.id);
    const displayName = String(memberDisplayName(member) || member.nameEn || member.name || '').trim();
    if (!displayName) return;
    const role = member.group === 'pi' ? '지도교수' : '연구교수 / 박사후연구원';
    options.push(`<option value="${escapeHTML(member.id)}">${escapeHTML(displayName)} · ${escapeHTML(role)}</option>`);
  });
  if (currentValue && !candidates.some((member) => member.id === currentValue)) {
    const fallbackText = currentProject.principalInvestigator || currentValue;
    options.push(`<option value="${escapeHTML(currentValue)}">${escapeHTML(fallbackText)}</option>`);
  }
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
function onTrashFilterClick(event) {
  const button = event.target.closest('[data-trash-filter]');
  if (!button) return;
  state.trashFilter = button.dataset.trashFilter;
  state.trashPage = 1;
  renderTrashList();
}

function onMemberPhotoChange(event) {
  updateFileInputLabel(event.currentTarget, elements.memberPhotoFileName);
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
  if (elements.memberPhotoInput) elements.memberPhotoInput.value = '';
  updateFileInputLabel(elements.memberPhotoInput, elements.memberPhotoFileName);
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

function revokeBoardPreviewUrls() {
  if (!Array.isArray(state.pendingBoardPreviews)) return;
  state.pendingBoardPreviews.forEach((url) => { try { URL.revokeObjectURL(url); } catch {} });
}

function updateBoardImageLabel() {
  if (!elements.boardImageFileName) return;
  if (Array.isArray(state.pendingBoardFiles) && state.pendingBoardFiles.length) {
    elements.boardImageFileName.textContent = state.pendingBoardFiles.length === 1
      ? state.pendingBoardFiles[0].name
      : `${state.pendingBoardFiles.length}개 파일 선택`;
    return;
  }
  const existing = Array.isArray(state.editingBoard?.imageUrls) ? state.editingBoard.imageUrls.filter(Boolean) : (state.editingBoard?.imageUrl ? [state.editingBoard.imageUrl] : []);
  if (existing.length) {
    elements.boardImageFileName.textContent = existing.length === 1 ? '기존 이미지 1장' : `기존 이미지 ${existing.length}장`;
    return;
  }
  elements.boardImageFileName.textContent = '선택된 파일 없음';
}
function onBoardImageChange(event) {
  const files = Array.from(event.currentTarget.files || []);
  state.pendingBoardFiles = files;
  state.boardImageRemoved = false;
  revokeBoardPreviewUrls();
  state.pendingBoardPreviews = files.map((file) => URL.createObjectURL(file));
  updateBoardImageLabel();
  renderBoardImagePreview();
}
function removeBoardImageAt(index) {
  if (Number.isNaN(Number(index))) return;
  const i = Number(index);
  if (Array.isArray(state.pendingBoardFiles) && state.pendingBoardFiles.length) {
    state.pendingBoardFiles = state.pendingBoardFiles.filter((_, idx) => idx !== i);
    if (Array.isArray(state.pendingBoardPreviews) && state.pendingBoardPreviews[i]) {
      try { URL.revokeObjectURL(state.pendingBoardPreviews[i]); } catch {}
    }
    state.pendingBoardPreviews = (state.pendingBoardPreviews || []).filter((_, idx) => idx !== i);
    if (!state.pendingBoardFiles.length && elements.boardImageInput) elements.boardImageInput.value = '';
    updateBoardImageLabel();
    renderBoardImagePreview();
    return;
  }
  const existing = Array.isArray(state.editingBoard?.imageUrls) ? state.editingBoard.imageUrls.filter(Boolean) : (state.editingBoard?.imageUrl ? [state.editingBoard.imageUrl] : []);
  const next = existing.filter((_, idx) => idx !== i);
  if (state.editingBoard) {
    state.editingBoard.imageUrls = next;
    state.editingBoard.imageUrl = next[0] || '';
    if (!next.length) state.editingBoard.imagePath = '';
  }
  state.boardImageRemoved = next.length === 0;
  updateBoardImageLabel();
  renderBoardImagePreview();
}
function clearBoardImage() {
  state.pendingBoardFiles = [];
  state.boardImageRemoved = true;
  revokeBoardPreviewUrls();
  state.pendingBoardPreviews = [];
  updateBoardImageLabel();
  if (elements.boardImageInput) elements.boardImageInput.value = '';
  if (state.editingBoard) {
    state.editingBoard.imageUrl = '';
    state.editingBoard.imageUrls = [];
    state.editingBoard.imagePath = '';
  }
  updateBoardImageLabel();
  renderBoardImagePreview();
}
function renderBoardImagePreview() {
  if (!elements.boardImagePreview) return;
  const previewUrls = Array.isArray(state.pendingBoardPreviews) && state.pendingBoardPreviews.length
    ? state.pendingBoardPreviews
    : (Array.isArray(state.editingBoard?.imageUrls) && state.editingBoard.imageUrls.length ? state.editingBoard.imageUrls : (state.editingBoard?.imageUrl ? [state.editingBoard.imageUrl] : []));
  if (!previewUrls.length) {
    elements.boardImagePreview.innerHTML = `<span>News</span>`;
    updateBoardImageLabel();
    return;
  }
  const names = Array.isArray(state.pendingBoardFiles) && state.pendingBoardFiles.length
    ? state.pendingBoardFiles.map((file) => file.name)
    : previewUrls.map((_, index) => `이미지 ${index + 1}`);
  const gridClass = previewUrls.length > 1 ? ' is-multi' : '';
  elements.boardImagePreview.innerHTML = `<div class="photo-preview-grid${gridClass}">` + previewUrls.map((url, index) => `<figure class="photo-preview-grid__item"><button type="button" class="photo-preview-grid__remove" data-board-preview-remove="${index}" aria-label="이미지 삭제">×</button><img src="${escapeHTML(rootAsset(url, root))}" alt="preview ${index + 1}"><figcaption class="photo-preview-grid__caption">${escapeHTML(names[index] || `이미지 ${index + 1}`)}</figcaption></figure>`).join('') + `</div>`;
  updateBoardImageLabel();
}

function resetMemberForm() {
  state.memberPublicationQuery = '';
  elements.memberForm?.reset();
  state.editingMember = null;
  state.pendingMemberFile = null;
  if (state.pendingMemberPreview) URL.revokeObjectURL(state.pendingMemberPreview);
  state.pendingMemberPreview = '';
  state.memberPhotoRemoved = false;
  if (elements.memberTitle) elements.memberTitle.textContent = '멤버 추가';
  if (elements.memberPhotoInput) elements.memberPhotoInput.value = '';
  updateFileInputLabel(elements.memberPhotoInput, elements.memberPhotoFileName);
  renderMemberPhotoPreview();
  renderMemberPublicationPicker([]);
  renderMemberProjectPicker([]);
  renderMemberCourseSchedule([]);
  renderMemberExperienceRows([]);
  updateMemberEducationVisibility();
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
  state.publicationMemberQuery = '';
  if (elements.publicationTitle) elements.publicationTitle.textContent = '논문 추가';
  renderPublicationMemberPicker([]);
}
function resetBoardForm() {
  elements.boardForm?.reset();
  state.editingBoard = null;
  updateFileInputLabel(elements.boardImageInput, elements.boardImageFileName);
  state.pendingBoardFiles = [];
  revokeBoardPreviewUrls();
  state.pendingBoardPreviews = [];
  state.boardImageRemoved = false;
  if (elements.boardTitle) elements.boardTitle.textContent = '소식 추가';
  renderBoardImagePreview();
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const bachelorsSchoolKr = String(formData.get('bachelorsSchoolKr') || '').trim();
  const bachelorsSchoolEn = String(formData.get('bachelorsSchoolEn') || '').trim();
  const bachelorsMajorKr = String(formData.get('bachelorsMajorKr') || '').trim();
  const bachelorsMajorEn = String(formData.get('bachelorsMajorEn') || '').trim();
  const mastersSchoolKr = String(formData.get('mastersSchoolKr') || '').trim();
  const mastersSchoolEn = String(formData.get('mastersSchoolEn') || '').trim();
  const mastersMajorKr = String(formData.get('mastersMajorKr') || '').trim();
  const mastersMajorEn = String(formData.get('mastersMajorEn') || '').trim();
  const doctoralSchoolKr = String(formData.get('doctoralSchoolKr') || '').trim();
  const doctoralSchoolEn = String(formData.get('doctoralSchoolEn') || '').trim();
  const doctoralMajorKr = String(formData.get('doctoralMajorKr') || '').trim();
  const doctoralMajorEn = String(formData.get('doctoralMajorEn') || '').trim();
  const nameKr = String(formData.get('nameKr') || '').trim();
  const nameEn = formatEnglishName(String(formData.get('nameEn') || '').trim());
  const bioKr = String(formData.get('bioKr') || '').trim();
  const bioEn = String(formData.get('bioEn') || '').trim();
  const researchInterestKr = String(formData.get('researchInterestKr') || '').trim();
  const researchInterestEn = String(formData.get('researchInterestEn') || '').trim();
  const currentPositionKr = String(formData.get('currentPositionKr') || '').trim();
  const currentPositionEn = String(formData.get('currentPositionEn') || '').trim();
  const experienceEntries = collectMemberExperienceEntries();
  let memberGroup = String(formData.get('group') || 'graduateStudent');
  let memberCourse = String(formData.get('course') || 'ms');
  let memberStatus = String(formData.get('status') || 'enrolled');
  if (memberGroup === 'alumni') {
    memberStatus = 'alumni';
    if (!['phd', 'ms'].includes(memberCourse)) memberCourse = 'ms';
  }
  const payload = {
    nameKr,
    nameEn,
    name: nameKr || nameEn || '',
    group: memberGroup,
    track: String(formData.get('track') || 'none'),
    course: memberCourse,
    email: String(formData.get('email') || '').trim(),
    bioKr,
    bioEn,
    bio: firstFilledValue(bioKr, bioEn),
    education: state.editingMember?.education || '',
    experienceEntries,
    experienceKr: '',
    experienceEn: '',
    experience: '',
    researchInterestKr,
    researchInterestEn,
    researchInterest: firstFilledValue(researchInterestKr, researchInterestEn),
    bachelorsSchoolKr,
    bachelorsSchoolEn,
    bachelorsMajorKr,
    bachelorsMajorEn,
    mastersSchoolKr,
    mastersSchoolEn,
    mastersMajorKr,
    mastersMajorEn,
    doctoralSchoolKr,
    doctoralSchoolEn,
    doctoralMajorKr,
    doctoralMajorEn,
    bachelorsSchool: firstFilledValue(bachelorsSchoolEn, bachelorsSchoolKr),
    bachelorsMajor: firstFilledValue(bachelorsMajorEn, bachelorsMajorKr),
    mastersSchool: firstFilledValue(mastersSchoolEn, mastersSchoolKr),
    mastersMajor: firstFilledValue(mastersMajorEn, mastersMajorKr),
    doctoralSchool: firstFilledValue(doctoralSchoolEn, doctoralSchoolKr),
    doctoralMajor: firstFilledValue(doctoralMajorEn, doctoralMajorKr),
    coursesInfo: String(formData.get('coursesInfo') || '').trim(),
    courseSchedule: collectMemberCourseSchedule(),
    projectLinks: collectMemberProjectLinks(),
    relatedProjects: '',
    publicationLinks: collectMemberPublicationLinks(),
    authorshipNote: '',
    currentPositionKr,
    currentPositionEn,
    currentPosition: firstFilledValue(currentPositionKr, currentPositionEn),
    status: memberStatus,
    graduationYear: String(formData.get('graduationYear') || '').trim(),
    startYear: String(formData.get('startYear') || '').trim(),
    startSemester: String(formData.get('startSemester') || '').trim(),
    enrolledGroup: state.editingMember?.enrolledGroup || '',
    enrolledCourse: state.editingMember?.enrolledCourse || '',
    enrolledTrack: state.editingMember?.enrolledTrack || '',
    sortOrder: state.editingMember?.sortOrder ?? 999,
    photoUrl: state.editingMember?.photoUrl || '',
    photoPath: state.editingMember?.photoPath || '',
    photoRemoved: state.memberPhotoRemoved
  };
  payload.education = buildEducationLines(payload) || state.editingMember?.education || '';
  payload.experienceKr = buildExperienceText(payload.experienceEntries, 'kr');
  payload.experienceEn = buildExperienceText(payload.experienceEntries, 'en');
  payload.experience = firstFilledValue(payload.experienceKr, payload.experienceEn);
  payload.authorshipNote = publicationLinksSummary(payload.publicationLinks);
  payload.relatedProjects = memberProjectLinksSummary(payload.projectLinks);
  if (!(payload.group === 'pi' || payload.course === 'professor')) {
    payload.courseSchedule = [];
    payload.coursesInfo = '';
  }
  if (!memberProjectSectionVisible(payload.group, payload.course, payload.status)) {
    payload.projectLinks = [];
    payload.relatedProjects = '';
  }
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
      payload.enrolledGroup = payload.enrolledGroup && payload.enrolledGroup !== 'alumni' ? payload.enrolledGroup : 'graduateStudent';
      payload.enrolledCourse = payload.enrolledCourse && payload.enrolledCourse !== 'alumni' ? payload.enrolledCourse : payload.course;
      payload.enrolledTrack = payload.enrolledTrack || payload.track;
    }
    const id = await saveDocument(COLLECTIONS.members, state.editingMember?.id || null, payload);
    state.members = activeItems(sortMembers(mergeMembers(state.members, [{ ...payload, id, updatedAt: new Date().toISOString() }])));
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
  const period = normalizeProjectPeriod(String(formData.get('period') || '').trim());
  const titleKr = String(formData.get('titleKr') || '').trim();
  const titleEn = String(formData.get('titleEn') || '').trim();
  const descriptionKr = String(formData.get('descriptionKr') || '').trim();
  const descriptionEn = String(formData.get('descriptionEn') || '').trim();
  const investigatorValue = String(formData.get('principalInvestigator') || '').trim();
  const selectedMember = state.members.find((member) => member.id === investigatorValue) || findMemberByAnyName(investigatorValue);
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
    leadRole: String(formData.get('leadRole') || 'leadInstitutionInvestigator').trim(),
    principalInvestigatorId: selectedMember?.id || '',
    principalInvestigator: selectedMember ? memberDisplayName(selectedMember) : investigatorValue,
    coResearchers: '',
    figureUrl: state.editingProject?.figureUrl || '',
    figurePath: state.editingProject?.figurePath || '',
    figureAspect: state.editingProject?.figureAspect || '16:9',
    tagsKr: String(formData.get('tagsKr') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    tagsEn: String(formData.get('tagsEn') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    tags: String(formData.get('tagsKr') || formData.get('tagsEn') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    sortOrder: state.editingProject?.sortOrder ?? 999
  };
  if (!payload.titleKr && !payload.titleEn) return showNotice('과제 제목을 입력해주세요.', 'warning');
  try {
    const id = await saveDocument(COLLECTIONS.projects, state.editingProject?.id || null, payload);
    state.projects = activeItems(sortProjects(mergeProjects(state.projects, [{ ...payload, id, updatedAt: new Date().toISOString() }])));
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
    doi: normalizeDoiInput(String(formData.get('doi') || '').trim()),
    url: '',
    abstract: String(formData.get('abstract') || '').trim(),
    indexing: publicationIndexingLabel(String(formData.get('indexing') || '').trim(), 'kr'),
    sortOrder: state.editingPublication?.sortOrder ?? 999
  };
  const linkedMembers = collectPublicationMemberLinks();
  if (!payload.title) return showNotice('논문 제목을 입력해주세요.', 'warning');
  try {
    const id = await saveDocument(COLLECTIONS.publications, state.editingPublication?.id || null, payload);
    const savedPublication = { ...payload, id, updatedAt: new Date().toISOString() };
    await syncPublicationLinksToMembers(savedPublication, linkedMembers);
    state.publications = activeItems(sortPublications(mergePublications(state.publications, [savedPublication])));
    renderMembersList();
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
    youtubeUrl: String(formData.get('youtubeUrl') || '').trim(),
    imageUrl: state.editingBoard?.imageUrl || '',
    imageUrls: Array.isArray(state.editingBoard?.imageUrls) ? [...state.editingBoard.imageUrls] : (state.editingBoard?.imageUrl ? [state.editingBoard.imageUrl] : []),
    imagePath: state.editingBoard?.imagePath || '',
    date: String(formData.get('date') || '').trim()
  };
  if (!payload.title) return showNotice('소식 제목을 입력해주세요.', 'warning');
  try {
    showNotice('소식을 저장하는 중입니다. 이미지가 있으면 잠시 더 걸릴 수 있습니다.', 'info');
    if (Array.isArray(state.pendingBoardFiles) && state.pendingBoardFiles.length) {
      const uploads = await Promise.all(state.pendingBoardFiles.map((file) => uploadBoardImage(file)));
      const urls = uploads.map((upload) => upload.imageUrl).filter(Boolean);
      payload.imageUrls = urls;
      payload.imageUrl = urls[0] || '';
      payload.imagePath = '';
    } else if (state.boardImageRemoved) {
      payload.imageUrl = '';
      payload.imageUrls = [];
      payload.imagePath = '';
    }
    const id = await saveDocument(COLLECTIONS.board, state.editingBoard?.id || null, payload);
    const saved = { ...payload, id, updatedAt: new Date().toISOString() };
    state.board = activeItems(sortBoardPosts(mergeBoardPosts(state.board, [saved])));
    resetBoardForm();
    closeEditor('board');
    if (elements.boardEditorCard) { elements.boardEditorCard.hidden = true; elements.boardEditorCard.classList.remove('is-open'); }
    state.openEditorKind = '';
    document.body.classList.remove('modal-open');
    renderBoardList();
    renderSummary();
    showNotice('소식이 저장되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    const message = /document.*too.*large|maximum document size|too many bytes/i.test(error?.message || '')
      ? '소식 이미지는 데이터베이스에 바로 저장되므로, 이미지 용량을 더 줄이거나 이미지 수를 줄인 뒤 다시 시도해주세요.'
      : adminErrorMessage(error, '소식 저장에 실패했습니다.');
    showNotice(message, 'danger');
  }
}

function renderAllLists() {
  renderMembersList();
  renderProjectsList();
  renderPublicationsList();
  renderBoardList();
  renderTrashList();
  renderSummary();
  renderMemberPhotoPreview();
  renderProjectFigurePreview();
  renderBoardImagePreview();
}

function renderMemberFilterTabs() {
  const filters = [
    ['all', '전체'],
    ['pi', '지도교수'],
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
    (member.group === 'graduateStudent' || member.status === 'alumni') && ['phd', 'ms'].includes(member.course) ? `${memberCourseLabel(member.course, 'kr')}${member.status === 'alumni' ? ' 졸업' : ''}` : '',
    member.track && member.track !== 'none' ? memberTrackLabel(member.track, 'kr') : '',
    memberYearLabel(member, 'kr')
  ].filter(Boolean).join(' · ');
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div class="admin-item-thumb">${member.photoUrl ? `<img src="${escapeHTML(rootAsset(member.photoUrl, root))}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}</div>
        <div class="admin-item-content">
          <div class="card-topline">
            <strong>${escapeHTML(memberDisplayName(member, 'kr'))}</strong>${member.nameEn ? `<small class=\"muted\">${escapeHTML(memberDisplayName(member, 'en'))}</small>` : ''}
            <span class="status-badge ${member.status === 'alumni' ? 'is-alumni' : ''}">${escapeHTML(memberStatusLabel(member, 'kr'))}</span>
          </div>
          ${detailBits ? `<p class="muted">${escapeHTML(detailBits)}</p>` : ''}
          ${member.email ? `<p>${escapeHTML(member.email)}</p>` : ''}
          ${localizedMemberText(member, 'currentPosition', 'kr') ? `<p>${escapeHTML(localizedMemberText(member, 'currentPosition', 'kr'))}</p>` : ''}
        </div>
      </div>
      <div class="admin-item-actions">
        <button type="button" class="small-button" data-member-action="edit" data-id="${escapeHTML(member.id)}">수정</button>
        ${member.group === 'pi' ? '' : (member.status === 'alumni' ? `<button type="button" class="small-button" data-member-action="restore" data-id="${escapeHTML(member.id)}">재학전환</button>` : `<button type="button" class="small-button" data-member-action="graduate" data-id="${escapeHTML(member.id)}">졸업처리</button>`)}
        <button type="button" class="small-button is-danger" data-member-action="delete" data-id="${escapeHTML(member.id)}">삭제</button>
      </div>
    </article>
  `;
}


function renderMembersList() {
  if (!elements.memberList) return;
  renderMemberFilterTabs();
  const matched = state.members.filter((item) => matchesSearch(state.memberQuery, ...memberProjectSearchValues(item)));
  const enrolled = matched.filter((item) => item.status !== 'alumni');
  const alumni = matched.filter((item) => item.status === 'alumni');
  let sections = [];
  elements.memberPagination.innerHTML = '';

  if (state.memberFilter === 'all') {
    const piItems = enrolled.filter((item) => item.group === 'pi');
    const researchItems = enrolled.filter((item) => item.group === 'researchProfessor');
    const phdFull = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'phd' && item.track === 'fullTime');
    const phdPart = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'phd' && item.track === 'partTime');
    const msFull = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'ms' && item.track === 'fullTime');
    const msPart = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'ms' && item.track === 'partTime');
    const undergradItems = enrolled.filter((item) => item.group === 'studentResearcher');
    const alumniGroups = Object.entries(groupBy(alumni, (item) => item.graduationYear || '이전')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
    sections = [
      adminMemberSection(`지도교수 (${piItems.length})`, piItems),
      adminMemberSection(`연구교수 · 박사후연구원 (${researchItems.length})`, researchItems),
      adminMemberSection(`박사과정 · 풀타임 (${phdFull.length})`, phdFull),
      adminMemberSection(`박사과정 · 파트타임 (${phdPart.length})`, phdPart),
      adminMemberSection(`석사과정 · 풀타임 (${msFull.length})`, msFull),
      adminMemberSection(`석사과정 · 파트타임 (${msPart.length})`, msPart),
      adminMemberSection(`학부연구생 (${undergradItems.length})`, undergradItems),
      ...alumniGroups.map(([year, items]) => adminMemberSection(`${year} (${items.length})`, items))
    ];
  } else if (state.memberFilter === 'pi') {
    const all = enrolled.filter((item) => item.group === 'pi');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    sections.push(adminMemberSection(`지도교수 (${all.length})`, pageData.items));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'research') {
    const all = enrolled.filter((item) => item.group === 'researchProfessor');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    sections.push(adminMemberSection(`연구교수 · 박사후연구원 (${all.length})`, pageData.items));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'phd') {
    const all = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'phd');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    const full = pageData.items.filter((item) => item.track === 'fullTime');
    const part = pageData.items.filter((item) => item.track === 'partTime');
    sections.push(adminMemberSection('박사과정 · 풀타임', full));
    sections.push(adminMemberSection('박사과정 · 파트타임', part));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'ms') {
    const all = enrolled.filter((item) => item.group === 'graduateStudent' && item.course === 'ms');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    const full = pageData.items.filter((item) => item.track === 'fullTime');
    const part = pageData.items.filter((item) => item.track === 'partTime');
    sections.push(adminMemberSection('석사과정 · 풀타임', full));
    sections.push(adminMemberSection('석사과정 · 파트타임', part));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'undergrad') {
    const all = enrolled.filter((item) => item.group === 'studentResearcher');
    const pageData = paginateItems(all, state.memberPage);
    state.memberPage = pageData.page;
    sections.push(adminMemberSection(`학부연구생 (${all.length})`, pageData.items));
    elements.memberPagination.innerHTML = paginationMarkup('member', pageData.page, pageData.pages);
  } else if (state.memberFilter === 'alumni') {
    const pageData = paginateItems(alumni, state.memberPage);
    state.memberPage = pageData.page;
    const grouped = Object.entries(groupBy(pageData.items, (item) => item.graduationYear || '이전')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
    sections = grouped.map(([year, items]) => adminMemberSection(`${year} (${items.length})`, items));
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
  const roleMap = { leadInstitutionInvestigator: '주관연구책임자', coPrincipalInvestigator: '공동연구책임자', principalInvestigator: '주관연구책임자' };
  const roleLabel = roleMap[project.leadRole] || '주관연구책임자';
  return `
    <article class="admin-item-card">
      <div class="admin-item-main admin-item-main--single">
        <div class="admin-item-content">
          <div class="card-topline">
            <strong>${escapeHTML(localizedProjectTitle(project, 'kr'))}</strong>
            <span class="status-badge ${project.status === 'completed' ? 'is-alumni' : ''}">${escapeHTML(projectStatusLabel(project.status, 'kr'))}</span>
          </div>
          ${project.period ? `<p class="muted">기간 · ${escapeHTML(normalizeProjectPeriod(project.period))}</p>` : ''}
          ${projectInvestigatorDisplay(project, 'kr') ? `<p class="muted">${escapeHTML(roleLabel)} · ${escapeHTML(projectInvestigatorDisplay(project, 'kr'))}</p>` : ''}
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
  const filteredProjects = state.projects.filter((item) => matchesSearch(state.projectQuery, ...projectSearchValues(item)));
  const ongoing = filteredProjects.filter((item) => item.status === 'ongoing');
  const completed = filteredProjects.filter((item) => item.status === 'completed');
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
  const ym = publicationYearMonthLabel(item);
  const indexing = publicationIndexingLabel(item.indexing, 'kr');
  const indexClass = indexing ? indexing.toLowerCase().replace(/[^a-z]+/g, '') : '';
  return `
    <article class="admin-item-card">
      <div class="admin-item-main admin-item-main--single">
        <div class="admin-item-content">
          <div class="card-topline"><strong>${escapeHTML(item.title)}</strong>${indexing ? `<span class="index-pill ${indexClass ? `index-pill--${escapeHTML(indexClass)}` : ''}">${escapeHTML(indexing)}</span>` : ''}</div>
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
  const filteredPublications = state.publications.filter((item) => matchesSearch(state.publicationQuery, ...publicationSearchValues(item)));
  let groups;
  let pageData;
  if (state.publicationFilter === 'all') {
    pageData = paginateItems(filteredPublications, state.publicationPage);
    groups = Object.entries(groupBy(pageData.items, (item) => item.year || '기타')).sort((a, b) => numericYearSort(b[0]) - numericYearSort(a[0]));
  } else {
    const filtered = filteredPublications.filter((item) => String(item.year) === String(state.publicationFilter));
    pageData = paginateItems(filtered, state.publicationPage);
    groups = [[state.publicationFilter, pageData.items]];
  }
  state.publicationPage = pageData.page;
  elements.publicationList.innerHTML = groups.map(([year, items]) => adminSection(`${year} (${items.length}편)`, items.map(publicationItemMarkup).join('') || emptyAdmin('없음'))).join('');
  elements.publicationPagination.innerHTML = paginationMarkup('publication', pageData.page, pageData.pages);
  bindPagination(elements.publicationPagination, 'publicationPage');
}

function renderBoardFilterTabs() {
  const filters = [['all', '전체'], ['notice', '공지'], ['equipment', '실험실 장비 소개'], ['conference', '학회']];
  elements.boardFilterTabs.innerHTML = filters.map(([value, label]) => `<button type="button" class="admin-subtab${state.boardFilter === value ? ' is-active' : ''}" data-board-filter="${escapeHTML(value)}">${escapeHTML(label)}</button>`).join('');
}

function boardItemMarkup(item) {
  return `
    <article class="admin-item-card">
      <div class="admin-item-main">
        <div class="admin-item-thumb">${(Array.isArray(item.imageUrls) && item.imageUrls[0]) || item.imageUrl ? `<img src="${escapeHTML(rootAsset((Array.isArray(item.imageUrls) && item.imageUrls[0]) || item.imageUrl, root))}" alt="${escapeHTML(item.title)}">` : `<span>${escapeHTML(boardCategoryLabel(item.category).slice(0,1) || '소')}</span>`}</div>
        <div class="admin-item-content">
          <div class="card-topline"><strong>${escapeHTML(item.title)}</strong><span class="status-badge">${escapeHTML(boardCategoryLabel(item.category))}</span></div>
          ${item.date ? `<p class="muted">${escapeHTML(item.date)}</p>` : ''}
          ${item.description ? `<p>${escapeHTML(item.description)}</p>` : ''}
          ${item.linkUrl ? `<p class="muted">${escapeHTML(item.linkUrl)}</p>` : ''}
          ${item.youtubeUrl ? `<p class="muted">${escapeHTML(item.youtubeUrl)}</p>` : ''}
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
  const map = { notice: '공지', equipment: '실험실 장비 소개', conference: '학회', poster: '학회', oral: '학회', news: '실험실 장비 소개' };
  return map[category] || '공지';
}

function renderBoardList() {
  if (!elements.boardList) return;
  renderBoardFilterTabs();
  const items = (state.boardFilter === 'all' ? state.board : state.board.filter((item) => item.category === state.boardFilter)).filter((item) => matchesSearch(state.boardQuery, ...boardSearchValues(item)));
  const pageData = paginateItems(items, state.boardPage);
  state.boardPage = pageData.page;
  elements.boardList.innerHTML = adminSection(`소식 (${items.length})`, pageData.items.map(boardItemMarkup).join('') || emptyAdmin('없음'));
  elements.boardPagination.innerHTML = paginationMarkup('board', pageData.page, pageData.pages);
  bindPagination(elements.boardPagination, 'boardPage');
}

function renderTrashFilterTabs() {
  if (!elements.trashFilterTabs) return;
  const filters = [
    ['all', '전체'],
    ['member', '멤버'],
    ['project', '과제'],
    ['publication', '논문'],
    ['board', '소식']
  ];
  elements.trashFilterTabs.innerHTML = filters.map(([value, label]) => `
    <button type="button" class="admin-subtab${state.trashFilter === value ? ' is-active' : ''}" data-trash-filter="${escapeHTML(value)}">${escapeHTML(label)}</button>
  `).join('');
}

function trashItemMarkup(item) {
  const deletedAt = String(item.deletedAt || '').slice(0, 10);
  const purgeAt = String(item.purgeAfterAt || '').slice(0, 10);
  return `
    <article class="admin-item-card">
      <div class="admin-item-main admin-item-main--single">
        <div class="admin-item-content">
          <div class="card-topline">
            <strong>${escapeHTML(trashTitle(item))}</strong>
            <span class="status-badge is-alumni">${escapeHTML(trashTypeLabel(item.itemType))}</span>
          </div>
          <p class="muted">삭제일 · ${escapeHTML(deletedAt || '-')}</p>
          <p class="muted">자동 삭제 예정 · ${escapeHTML(purgeAt || '-')}</p>
          <p>${escapeHTML(item.originalId || '')}</p>
        </div>
      </div>
      <div class="admin-item-actions">
        <button type="button" class="small-button" data-trash-action="restore" data-id="${escapeHTML(item.id)}">복원</button>
        <button type="button" class="small-button is-danger" data-trash-action="purge" data-id="${escapeHTML(item.id)}">영구 삭제</button>
      </div>
    </article>
  `;
}

function renderTrashList() {
  if (!elements.trashList) return;
  renderTrashFilterTabs();
  const items = (state.trashFilter === 'all' ? state.trash : state.trash.filter((item) => item.itemType === state.trashFilter)).filter((item) => matchesSearch(state.trashQuery, ...trashSearchValues(item)));
  const pageData = paginateItems(items, state.trashPage);
  state.trashPage = pageData.page;
  const groups = Object.entries(groupBy(pageData.items, (item) => trashTypeLabel(item.itemType))).map(([title, groupItems]) => adminSection(`${title} (${groupItems.length})`, groupItems.map(trashItemMarkup).join('') || emptyAdmin('없음')));
  elements.trashList.innerHTML = groups.join('') || emptyAdmin('휴지통이 비어 있습니다.');
  if (elements.trashPagination) {
    elements.trashPagination.innerHTML = paginationMarkup('trash', pageData.page, pageData.pages);
    bindPagination(elements.trashPagination, 'trashPage');
  }
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

function onTrashListClick(event) {
  const button = event.target.closest('[data-trash-action]');
  if (!button) return;
  const item = state.trash.find((entry) => entry.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.trashAction === 'restore') return restoreTrash(item);
  if (button.dataset.trashAction === 'purge') return purgeTrash(item);
}

function loadMemberForm(member) {
  state.editingMember = member;
  state.memberPhotoRemoved = false;
  elements.memberTitle.textContent = '멤버 수정';
  const form = elements.memberForm;
  [
    ['nameKr', member.nameKr || ''],
    ['nameEn', formatEnglishName(member.nameEn || '')],
    ['group', member.group || 'graduateStudent'],
    ['track', member.track || 'none'],
    ['course', member.course || 'ms'],
    ['email', member.email || ''],
    ['bioKr', firstFilledValue(member.bioKr, member.bio)],
    ['bioEn', firstFilledValue(member.bioEn, member.bio)],
    ['researchInterestKr', firstFilledValue(member.researchInterestKr, member.researchInterest)],
    ['researchInterestEn', firstFilledValue(member.researchInterestEn, member.researchInterest)],
    ['coursesInfo', member.coursesInfo || ''],
    ['currentPositionKr', firstFilledValue(member.currentPositionKr, member.currentPosition)],
    ['currentPositionEn', firstFilledValue(member.currentPositionEn, member.currentPosition)],
    ['status', member.status || 'enrolled'],
    ['graduationYear', member.graduationYear || ''],
    ['startYear', member.startYear || member.admissionYear || member.entranceYear || member.entryYear || member.enrollmentYear || member.enterYear || ''],
    ['startSemester', member.startSemester || member.admissionSemester || member.entranceSemester || member.entrySemester || member.enrollmentSemester || member.enterSemester || member.semester || '']
  ].forEach(([field, value]) => setFormValue(form, field, value));
  [
    ['bachelorsSchoolKr', member.bachelorsSchoolKr || ''],
    ['bachelorsSchoolEn', member.bachelorsSchoolEn || member.bachelorsSchool || ''],
    ['bachelorsMajorKr', member.bachelorsMajorKr || ''],
    ['bachelorsMajorEn', member.bachelorsMajorEn || member.bachelorsMajor || ''],
    ['mastersSchoolKr', member.mastersSchoolKr || ''],
    ['mastersSchoolEn', member.mastersSchoolEn || member.mastersSchool || ''],
    ['mastersMajorKr', member.mastersMajorKr || ''],
    ['mastersMajorEn', member.mastersMajorEn || member.mastersMajor || ''],
    ['doctoralSchoolKr', member.doctoralSchoolKr || ''],
    ['doctoralSchoolEn', member.doctoralSchoolEn || member.doctoralSchool || ''],
    ['doctoralMajorKr', member.doctoralMajorKr || ''],
    ['doctoralMajorEn', member.doctoralMajorEn || member.doctoralMajor || '']
  ].forEach(([field, value]) => setFormValue(form, field, value));
  renderMemberCourseSchedule(member.courseSchedule || []);
  renderMemberExperienceRows(member.experienceEntries || []);
  updateFileInputLabel(elements.memberPhotoInput, elements.memberPhotoFileName);
  renderMemberPhotoPreview();
  state.memberPublicationQuery = '';
  renderMemberPublicationPicker(member.publicationLinks || []);
  renderMemberProjectPicker(member.projectLinks || []);
  updateMemberEducationVisibility();
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
  ['status','period','leadRole'].forEach((field) => setFormValue(form, field, project[field] || ''));
  renderProjectLeadOptions();
  setFormValue(form, 'principalInvestigator', project.principalInvestigatorId || resolveProjectInvestigatorMember(project)?.id || project.principalInvestigator || '');
  setFormValue(form, 'tagsKr', ((project.tagsKr && project.tagsKr.length) ? project.tagsKr : project.tags || []).join(', '));
  setFormValue(form, 'tagsEn', ((project.tagsEn && project.tagsEn.length) ? project.tagsEn : project.tags || []).join(', '));
  renderProjectFigurePreview();
  openEditor('project');
}
function loadPublicationForm(item) {
  state.editingPublication = item;
  state.publicationMemberQuery = '';
  elements.publicationTitle.textContent = '논문 수정';
  const form = elements.publicationForm;
  ['title','authors','journal','year','month','doi','abstract','indexing'].forEach((field) => setFormValue(form, field, field === 'doi' ? (item.doi || item.url || '') : (item[field] || '')));
  renderPublicationMemberPicker(resolvePublicationMemberLinks(item));
  openEditor('publication');
}
function loadBoardForm(item) {
  state.editingBoard = item;
  elements.boardTitle.textContent = '소식 수정';
  const form = elements.boardForm;
  setFormValue(form, 'category', item.category || 'notice');
  ['title','description','linkUrl','youtubeUrl','date'].forEach((field) => setFormValue(form, field, item[field] || ''));
  state.boardImageRemoved = false;
  state.pendingBoardFiles = [];
  revokeBoardPreviewUrls();
  state.pendingBoardPreviews = [];
  updateFileInputLabel(elements.boardImageInput, elements.boardImageFileName);
  renderBoardImagePreview();
  openEditor('board');
}

async function quickGraduate(member) {
  const year = await openDialog({ title: '졸업 처리', message: '졸업 연도를 입력하세요.', inputLabel: '졸업 연도', defaultValue: member.graduationYear || new Date().getFullYear().toString(), type: 'prompt' });
  if (year === null) return;
  const currentPosition = await openDialog({ title: '현재 소속', message: '현재 소속을 입력하세요.', inputLabel: '현재 소속', defaultValue: member.currentPosition || '', type: 'prompt' });
  if (currentPosition === null) return;
  const currentPositionValue = String(currentPosition).trim();
  const payload = {
    ...member,
    status: 'alumni',
    graduationYear: String(year).trim(),
    currentPositionKr: currentPositionValue,
    currentPositionEn: firstFilledValue(member.currentPositionEn, currentPositionValue),
    currentPosition: currentPositionValue,
    enrolledGroup: member.enrolledGroup || member.group,
    enrolledCourse: member.enrolledCourse || member.course,
    enrolledTrack: member.enrolledTrack || member.track
  };
  await saveDocument(COLLECTIONS.members, member.id, payload);
  state.members = activeItems(sortMembers(mergeMembers(state.members, [{ ...payload, updatedAt: new Date().toISOString() }])));
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
  state.members = activeItems(sortMembers(mergeMembers(state.members, [{ ...payload, updatedAt: new Date().toISOString() }])));
  state.memberFilter = memberFilterFor(payload);
  renderMembersList();
  renderSummary();
  showNotice('재학 상태로 변경되었습니다.', 'success');
}
async function removeMember(member) {
  const ok = await openDialog({ title: '멤버 삭제', message: `${memberDisplayName(member)} 멤버를 휴지통으로 이동할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    const trashEntry = await moveItemToTrash('member', COLLECTIONS.members, member, memberDisplayName(member));
    state.members = state.members.filter((item) => item.id !== member.id);
    state.trash = sortTrashItems([trashEntry, ...state.trash.filter((item) => item.id !== trashEntry.id)]);
    renderMembersList();
    renderTrashList();
    renderSummary();
    showNotice('멤버가 휴지통으로 이동되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '멤버 삭제에 실패했습니다.'), 'danger');
  }
}
async function removeProject(project) {
  const title = localizedProjectTitle(project, 'kr');
  const ok = await openDialog({ title: '과제 삭제', message: `${title} 과제를 휴지통으로 이동할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    const trashEntry = await moveItemToTrash('project', COLLECTIONS.projects, project, title);
    state.projects = state.projects.filter((item) => item.id !== project.id);
    state.trash = sortTrashItems([trashEntry, ...state.trash.filter((item) => item.id !== trashEntry.id)]);
    renderProjectsList();
    renderTrashList();
    renderSummary();
    showNotice('과제가 휴지통으로 이동되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '과제 삭제에 실패했습니다.'), 'danger');
  }
}
async function removePublication(item) {
  const ok = await openDialog({ title: '논문 삭제', message: `${item.title} 논문을 휴지통으로 이동할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    const trashEntry = await moveItemToTrash('publication', COLLECTIONS.publications, item, item.title);
    state.publications = state.publications.filter((pub) => pub.id !== item.id);
    state.trash = sortTrashItems([trashEntry, ...state.trash.filter((entry) => entry.id !== trashEntry.id)]);
    renderPublicationsList();
    renderTrashList();
    renderSummary();
    showNotice('논문이 휴지통으로 이동되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '논문 삭제에 실패했습니다.'), 'danger');
  }
}
async function removeBoard(item) {
  const ok = await openDialog({ title: '소식 삭제', message: `${item.title} 항목을 휴지통으로 이동할까요?`, type: 'confirm' });
  if (!ok) return;
  try {
    const trashEntry = await moveItemToTrash('board', COLLECTIONS.board, item, item.title);
    state.board = state.board.filter((entry) => entry.id !== item.id);
    state.trash = sortTrashItems([trashEntry, ...state.trash.filter((entry) => entry.id !== trashEntry.id)]);
    renderBoardList();
    renderTrashList();
    renderSummary();
    showNotice('소식이 휴지통으로 이동되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '소식 삭제에 실패했습니다.'), 'danger');
  }
}

async function restoreTrash(item) {
  const ok = await openDialog({ title: '휴지통 복원', message: `${trashTitle(item)} 항목을 복원할까요?`, type: 'confirm', confirmText: '복원' });
  if (!ok) return;
  try {
    await restoreTrashItem(item);
    state.trash = state.trash.filter((entry) => entry.id !== item.id);
    renderTrashList();
    renderSummary();
    showNotice('항목이 복원되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '휴지통 복원에 실패했습니다.'), 'danger');
  }
}

async function purgeTrash(item) {
  const ok = await openDialog({ title: '영구 삭제', message: `${trashTitle(item)} 항목을 영구 삭제할까요? 되돌릴 수 없습니다.`, type: 'confirm', confirmText: '영구 삭제' });
  if (!ok) return;
  try {
    await permanentlyDeleteTrashItem(item);
    state.trash = state.trash.filter((entry) => entry.id !== item.id);
    renderTrashList();
    renderSummary();
  } catch (error) {
    console.error(error);
    showNotice(adminErrorMessage(error, '영구 삭제에 실패했습니다.'), 'danger');
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
