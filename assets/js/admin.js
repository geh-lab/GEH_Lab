import { fallbackMembers, fallbackProjects, fallbackPublications, siteContent } from './fallback-data.js';
import {
  ADMIN_EMAILS,
  COLLECTIONS,
  deleteDocumentById,
  deleteMemberPhoto,
  hasFirebaseConfig,
  listenCollection,
  saveDocument,
  signInAdminWithGoogle,
  resolveGoogleRedirectResult,
  signOutAdmin,
  uploadMemberPhoto,
  watchAdminState,
  auth
} from './firebase.js';
import {
  escapeHTML,
  getInitials,
  normalizeMember,
  normalizeProject,
  normalizePublication,
  parseTags,
  resolveLink,
  sortMembers,
  sortProjects,
  sortPublications
} from './utils.js';

const state = {
  user: null,
  members: [],
  projects: [],
  publications: [],
  activeTab: 'members',
  editingMember: null,
  editingProject: null,
  editingPublication: null,
  memberPendingFile: null,
  memberPendingPreviewUrl: '',
  unsubs: []
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  wireStaticActions();
  renderSetupStatus();
  renderSummary();
  toggleAuthenticatedState(null);

  if (!hasFirebaseConfig) {
    showNotice('firebase-config.js에 설정값을 넣으면 관리자 기능이 활성화됩니다. 현재는 설정 안내만 표시 중입니다.', 'warning');
    return;
  }

  resolveGoogleRedirectResult().catch((error) => {
    console.error(error);
    showNotice(error.message || 'Google 로그인 확인에 실패했습니다. 승인된 도메인과 관리자 이메일을 다시 확인하세요.', 'danger');
  });

  watchAdminState(handleAuthStateChange);

  if (auth?.currentUser && (!ADMIN_EMAILS.length || ADMIN_EMAILS.includes(String(auth.currentUser.email || '').toLowerCase()))) {
    handleAuthStateChange(auth.currentUser);
  }
});

function cacheElements() {
  const ids = [
    'setup-status-text',
    'setup-extra-text',
    'allowed-admin-emails',
    'admin-alert',
    'login-panel',
    'dashboard-panel',
    'logout-button',
    'current-user-label',
    'admin-summary-grid',
    'google-login-button',
    'member-form',
    'project-form',
    'publication-form',
    'member-form-reset',
    'project-form-reset',
    'publication-form-reset',
    'member-admin-list',
    'project-admin-list',
    'publication-admin-list',
    'seed-data-button',
    'member-photo-input',
    'member-dropzone',
    'member-photo-preview',
    'member-photo-remove',
    'member-form-title',
    'project-form-title',
    'publication-form-title'
  ];

  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });

  elements.tabButtons = Array.from(document.querySelectorAll('[data-admin-tab]'));
  elements.panels = Array.from(document.querySelectorAll('[data-admin-panel]'));
}

function wireStaticActions() {
  elements['google-login-button']?.addEventListener('click', handleGoogleLoginClick);
  elements.logout-button?.addEventListener('click', async () => {
    await signOutAdmin();
    showNotice('로그아웃되었습니다.', 'info');
  });

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.adminTab));
  });

  elements.member-form?.addEventListener('submit', handleMemberSubmit);
  elements.project-form?.addEventListener('submit', handleProjectSubmit);
  elements.publication-form?.addEventListener('submit', handlePublicationSubmit);

  elements['member-form-reset']?.addEventListener('click', () => resetMemberForm());
  elements['project-form-reset']?.addEventListener('click', () => resetProjectForm());
  elements['publication-form-reset']?.addEventListener('click', () => resetPublicationForm());

  elements['member-admin-list']?.addEventListener('click', handleMemberListAction);
  elements['project-admin-list']?.addEventListener('click', handleProjectListAction);
  elements['publication-admin-list']?.addEventListener('click', handlePublicationListAction);

  elements['member-photo-input']?.addEventListener('change', (event) => {
    const [file] = event.currentTarget.files || [];
    setMemberPhotoFile(file || null);
  });

  elements['member-photo-remove']?.addEventListener('click', () => {
    setMemberPhotoFile(null);
    if (elements['member-photo-input']) elements['member-photo-input'].value = '';
  });

  elements['member-dropzone']?.addEventListener('click', () => elements['member-photo-input']?.click());
  elements['member-dropzone']?.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements['member-dropzone']?.classList.add('is-hovered');
  });
  elements['member-dropzone']?.addEventListener('dragleave', () => {
    elements['member-dropzone']?.classList.remove('is-hovered');
  });
  elements['member-dropzone']?.addEventListener('drop', (event) => {
    event.preventDefault();
    elements['member-dropzone']?.classList.remove('is-hovered');
    const [file] = event.dataTransfer?.files || [];
    if (!file) return;
    if (elements['member-photo-input']) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      elements['member-photo-input'].files = dataTransfer.files;
    }
    setMemberPhotoFile(file);
  });

  elements['seed-data-button']?.addEventListener('click', seedFallbackData);
}

function renderSetupStatus() {
  if (!elements['setup-status-text']) return;

  elements['setup-status-text'].textContent = hasFirebaseConfig
    ? 'Firebase 설정이 연결되었습니다. 이 관리자 페이지는 Google 로그인 전용입니다. 버튼을 누르면 Google 계정 선택 창이 열립니다.'
    : '아직 Firebase 설정이 비어 있습니다. firebase-config.js 파일을 채우면 Google 로그인과 데이터 저장이 활성화됩니다.';

  elements['setup-extra-text'].textContent = ADMIN_EMAILS.length
    ? `허용된 관리자 이메일: ${ADMIN_EMAILS.join(', ')}`
    : '허용 관리자 이메일이 비어 있으면, 클라이언트 화면에서는 로그인 후 접근 가능하지만 보안을 위해 Firestore/Storage 규칙에는 반드시 실제 관리자 이메일을 넣어야 합니다.';

  elements['allowed-admin-emails'].textContent = ADMIN_EMAILS.length
    ? ADMIN_EMAILS.join(', ')
    : '예: envlab1315@gmail.com';
}

async function handleAuthStateChange(user) {
  state.user = user;
  toggleAuthenticatedState(user);

  if (!user) {
    tearDownListeners();
    resetMemberForm();
    resetProjectForm();
    resetPublicationForm();
    return;
  }

  attachRealtimeListeners();
  showNotice(`${user.email} 계정으로 로그인되었습니다.`, 'success');
}

function toggleAuthenticatedState(user) {
  const isAuthenticated = Boolean(user);
  elements['login-panel'].hidden = isAuthenticated;
  elements['dashboard-panel'].hidden = !isAuthenticated;
  elements['logout-button'].hidden = !isAuthenticated;
  elements['current-user-label'].textContent = isAuthenticated
    ? user.email
    : 'Google sign-in required';

  if (!hasFirebaseConfig) {
    elements['login-panel'].hidden = false;
    elements['dashboard-panel'].hidden = true;
  }
}

function attachRealtimeListeners() {
  tearDownListeners();

  state.unsubs = [
    listenCollection(
      COLLECTIONS.members,
      (items) => {
        state.members = sortMembers(items.map(normalizeMember));
        renderMembersAdmin();
        renderSummary();
      },
      () => showNotice('Members 컬렉션을 불러오지 못했습니다.', 'warning')
    ),
    listenCollection(
      COLLECTIONS.projects,
      (items) => {
        state.projects = sortProjects(items.map(normalizeProject));
        renderProjectsAdmin();
        renderSummary();
      },
      () => showNotice('Projects 컬렉션을 불러오지 못했습니다.', 'warning')
    ),
    listenCollection(
      COLLECTIONS.publications,
      (items) => {
        state.publications = sortPublications(items.map(normalizePublication));
        renderPublicationsAdmin();
        renderSummary();
      },
      () => showNotice('Publications 컬렉션을 불러오지 못했습니다.', 'warning')
    )
  ];
}

function tearDownListeners() {
  state.unsubs.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      console.error(error);
    }
  });
  state.unsubs = [];
}

async function handleGoogleLoginClick() {
  if (!hasFirebaseConfig) {
    showNotice('먼저 firebase-config.js에 Firebase 설정을 입력하세요.', 'warning');
    return;
  }

  try {
    elements['google-login-button']?.setAttribute('disabled', 'disabled');
    elements['google-login-button']?.classList.add('is-loading');
    showNotice('Google 계정 선택 창을 여는 중입니다.', 'info');
    const credential = await signInAdminWithGoogle();

    if (credential?.user) {
      await handleAuthStateChange(credential.user);
      showNotice(`${credential.user.email} 계정으로 로그인되었습니다.`, 'success');
      return;
    }

    if (auth?.currentUser) {
      await handleAuthStateChange(auth.currentUser);
      showNotice(`${auth.currentUser.email} 계정으로 로그인되었습니다.`, 'success');
      return;
    }

    showNotice('Google 인증은 완료되었지만 세션 반영이 지연되고 있습니다. 잠시 후 자동 반영되지 않으면 페이지를 한 번 새로고침하세요.', 'warning');
  } catch (error) {
    console.error(error);
    showNotice(error.message || 'Google 로그인에 실패했습니다.', 'danger');
  } finally {
    elements['google-login-button']?.removeAttribute('disabled');
    elements['google-login-button']?.classList.remove('is-loading');
  }
}

function renderSummary() {
  if (!elements['admin-summary-grid']) return;
  const stats = [
    { label: 'Members', value: state.members.length },
    { label: 'Projects', value: state.projects.length },
    { label: 'Publications', value: state.publications.length }
  ];

  elements['admin-summary-grid'].innerHTML = stats
    .map(
      (item) => `
        <div class="summary-card">
          <strong>${escapeHTML(item.value)}</strong>
          <span>${escapeHTML(item.label)}</span>
        </div>
      `
    )
    .join('');
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  elements.tabButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.adminTab === tabName);
  });
  elements.panels.forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== tabName;
  });
}

function memberPreviewMarkup(url, label = 'Preview') {
  if (url) {
    return `<img src="${escapeHTML(url)}" alt="${escapeHTML(label)}">`;
  }
  const targetName =
    state.editingMember?.name ||
    elements['member-form']?.elements?.namedItem('name')?.value ||
    siteContent.shortName;
  return `<div class="member-photo-fallback member-photo-fallback--preview">${escapeHTML(getInitials(targetName))}</div>`;
}

function setMemberPhotoFile(file) {
  state.memberPendingFile = file || null;

  if (state.memberPendingPreviewUrl) {
    URL.revokeObjectURL(state.memberPendingPreviewUrl);
    state.memberPendingPreviewUrl = '';
  }

  if (file) {
    state.memberPendingPreviewUrl = URL.createObjectURL(file);
  }

  renderMemberPhotoPreview();
}

function renderMemberPhotoPreview() {
  if (!elements['member-photo-preview']) return;
  const previewUrl = state.memberPendingPreviewUrl || state.editingMember?.photoUrl || '';
  elements['member-photo-preview'].innerHTML = memberPreviewMarkup(previewUrl, state.editingMember?.name || 'Member photo');
}

function resetMemberForm() {
  elements['member-form']?.reset();
  state.editingMember = null;
  if (elements['member-form-title']) elements['member-form-title'].textContent = '멤버 추가';
  if (elements['member-photo-input']) elements['member-photo-input'].value = '';
  setMemberPhotoFile(null);
  renderMemberPhotoPreview();
}

function resetProjectForm() {
  elements['project-form']?.reset();
  state.editingProject = null;
  if (elements['project-form-title']) elements['project-form-title'].textContent = '과제 추가';
}

function resetPublicationForm() {
  elements['publication-form']?.reset();
  state.editingPublication = null;
  if (elements['publication-form-title']) elements['publication-form-title'].textContent = '논문 추가';
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);

  const payload = {
    name: String(formData.get('name') || '').trim(),
    group: String(formData.get('group') || 'Graduate Students'),
    track: String(formData.get('track') || '').trim(),
    course: String(formData.get('course') || '').trim(),
    email: String(formData.get('email') || '').trim(),
    bio: String(formData.get('bio') || '').trim(),
    education: String(formData.get('education') || '').trim(),
    experience: String(formData.get('experience') || '').trim(),
    researchInterest: String(formData.get('researchInterest') || '').trim(),
    currentPosition: String(formData.get('currentPosition') || '').trim(),
    status: String(formData.get('status') || 'active'),
    graduationYear: String(formData.get('graduationYear') || '').trim(),
    sortOrder: Number(formData.get('sortOrder') || 999),
    photoUrl: state.editingMember?.photoUrl || '',
    photoPath: state.editingMember?.photoPath || ''
  };

  if (!payload.name) {
    showNotice('멤버 이름은 필수입니다.', 'warning');
    return;
  }

  try {
    if (state.memberPendingFile) {
      const upload = await uploadMemberPhoto(state.memberPendingFile);
      payload.photoUrl = upload.photoUrl;
      payload.photoPath = upload.photoPath;

      if (state.editingMember?.photoPath && state.editingMember.photoPath !== upload.photoPath) {
        try {
          await deleteMemberPhoto(state.editingMember.photoPath);
        } catch (error) {
          console.warn('기존 사진 삭제는 실패했지만 새 사진은 저장되었습니다.', error);
        }
      }
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
    tags: parseTags(String(formData.get('tags') || '')),
    sortOrder: Number(formData.get('sortOrder') || 999)
  };

  if (!payload.title) {
    showNotice('과제 제목은 필수입니다.', 'warning');
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
    showNotice('논문 제목은 필수입니다.', 'warning');
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

function renderMembersAdmin() {
  if (!elements['member-admin-list']) return;

  if (!state.members.length) {
    elements['member-admin-list'].innerHTML = emptyStateMarkup('아직 저장된 멤버가 없습니다.');
    return;
  }

  elements['member-admin-list'].innerHTML = state.members
    .map((member) => {
      const quickAction =
        member.status === 'alumni'
          ? `<button class="small-button" data-member-action="restore" data-id="${escapeHTML(member.id)}">재학 전환</button>`
          : `<button class="small-button" data-member-action="graduate" data-id="${escapeHTML(member.id)}">졸업 처리</button>`;

      return `
        <article class="admin-item-card">
          <div class="admin-item-main">
            <div class="admin-item-thumb">${member.photoUrl ? `<img src="${escapeHTML(member.photoUrl)}" alt="${escapeHTML(member.name)}">` : `<span>${escapeHTML(getInitials(member.name))}</span>`}</div>
            <div>
              <div class="card-topline">
                <strong>${escapeHTML(member.name)}</strong>
                <span class="badge ${member.status === 'alumni' ? '' : 'badge--green'}">${escapeHTML(member.status)}</span>
              </div>
              <p class="muted">${escapeHTML([member.group, member.track, member.course].filter(Boolean).join(' · '))}</p>
              ${member.email ? `<p>${escapeHTML(member.email)}</p>` : ''}
              ${
                member.currentPosition
                  ? `<p>${escapeHTML(member.currentPosition)}</p>`
                  : member.researchInterest
                    ? `<p>${escapeHTML(member.researchInterest)}</p>`
                    : ''
              }
            </div>
          </div>
          <div class="admin-item-actions">
            <button class="small-button" data-member-action="edit" data-id="${escapeHTML(member.id)}">수정</button>
            ${quickAction}
            <button class="small-button small-button--danger" data-member-action="delete" data-id="${escapeHTML(member.id)}">삭제</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderProjectsAdmin() {
  if (!elements['project-admin-list']) return;

  if (!state.projects.length) {
    elements['project-admin-list'].innerHTML = emptyStateMarkup('아직 저장된 과제가 없습니다.');
    return;
  }

  elements['project-admin-list'].innerHTML = state.projects
    .map((project) => {
      const toggleAction =
        project.status === 'ongoing'
          ? `<button class="small-button" data-project-action="complete" data-id="${escapeHTML(project.id)}">종료 처리</button>`
          : `<button class="small-button" data-project-action="restore" data-id="${escapeHTML(project.id)}">진행중 전환</button>`;

      return `
        <article class="admin-item-card">
          <div class="admin-item-main">
            <div>
              <div class="card-topline">
                <strong>${escapeHTML(project.title)}</strong>
                <span class="badge ${project.status === 'ongoing' ? 'badge--green' : ''}">${escapeHTML(project.status)}</span>
              </div>
              ${project.period || project.year ? `<p class="muted">${escapeHTML(project.period || project.year)}</p>` : ''}
              ${project.description ? `<p>${escapeHTML(project.description)}</p>` : ''}
              ${
                project.tags?.length
                  ? `<div class="tag-row">${project.tags.map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join('')}</div>`
                  : ''
              }
            </div>
          </div>
          <div class="admin-item-actions">
            <button class="small-button" data-project-action="edit" data-id="${escapeHTML(project.id)}">수정</button>
            ${toggleAction}
            <button class="small-button small-button--danger" data-project-action="delete" data-id="${escapeHTML(project.id)}">삭제</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderPublicationsAdmin() {
  if (!elements['publication-admin-list']) return;

  if (!state.publications.length) {
    elements['publication-admin-list'].innerHTML = emptyStateMarkup('아직 저장된 논문이 없습니다.');
    return;
  }

  elements['publication-admin-list'].innerHTML = state.publications
    .map((publication) => {
      const link = resolveLink(publication);
      return `
        <article class="admin-item-card">
          <div class="admin-item-main">
            <div>
              <div class="card-topline">
                <strong>${escapeHTML(publication.title)}</strong>
                ${publication.year ? `<span class="badge badge--dark">${escapeHTML(publication.year)}</span>` : ''}
              </div>
              ${publication.journal ? `<p class="muted">${escapeHTML(publication.journal)}</p>` : ''}
              ${publication.authors ? `<p>${escapeHTML(publication.authors)}</p>` : ''}
              ${publication.doi ? `<p class="muted">DOI · ${escapeHTML(publication.doi)}</p>` : ''}
              ${link ? `<a href="${escapeHTML(link)}" target="_blank" rel="noreferrer noopener">원문 열기</a>` : ''}
            </div>
          </div>
          <div class="admin-item-actions">
            <button class="small-button" data-publication-action="edit" data-id="${escapeHTML(publication.id)}">수정</button>
            <button class="small-button small-button--danger" data-publication-action="delete" data-id="${escapeHTML(publication.id)}">삭제</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function handleMemberListAction(event) {
  const button = event.target.closest('[data-member-action]');
  if (!button) return;

  const member = state.members.find((item) => item.id === button.dataset.id);
  if (!member) return;

  const action = button.dataset.memberAction;
  if (action === 'edit') {
    state.editingMember = member;
    fillMemberForm(member);
    return;
  }

  if (action === 'delete') {
    deleteMember(member);
    return;
  }

  if (action === 'graduate') {
    quickGraduate(member);
    return;
  }

  if (action === 'restore') {
    restoreMember(member);
  }
}

function handleProjectListAction(event) {
  const button = event.target.closest('[data-project-action]');
  if (!button) return;

  const project = state.projects.find((item) => item.id === button.dataset.id);
  if (!project) return;

  const action = button.dataset.projectAction;
  if (action === 'edit') {
    state.editingProject = project;
    fillProjectForm(project);
    return;
  }

  if (action === 'delete') {
    deleteProject(project);
    return;
  }

  if (action === 'complete') {
    toggleProjectStatus(project, 'completed');
    return;
  }

  if (action === 'restore') {
    toggleProjectStatus(project, 'ongoing');
  }
}

function handlePublicationListAction(event) {
  const button = event.target.closest('[data-publication-action]');
  if (!button) return;

  const publication = state.publications.find((item) => item.id === button.dataset.id);
  if (!publication) return;

  if (button.dataset.publicationAction === 'edit') {
    state.editingPublication = publication;
    fillPublicationForm(publication);
    return;
  }

  if (button.dataset.publicationAction === 'delete') {
    deletePublication(publication);
  }
}

function fillMemberForm(member) {
  if (!elements['member-form']) return;
  if (elements['member-form-title']) elements['member-form-title'].textContent = '멤버 수정';

  const form = elements['member-form'];
  form.elements.name.value = member.name || '';
  form.elements.group.value = member.group || 'Graduate Students';
  form.elements.track.value = member.track || '';
  form.elements.course.value = member.course || '';
  form.elements.email.value = member.email || '';
  form.elements.bio.value = member.bio || '';
  form.elements.education.value = member.education || '';
  form.elements.experience.value = member.experience || '';
  form.elements.researchInterest.value = member.researchInterest || '';
  form.elements.currentPosition.value = member.currentPosition || '';
  form.elements.status.value = member.status || 'active';
  form.elements.graduationYear.value = member.graduationYear || '';
  form.elements.sortOrder.value = member.sortOrder || 999;

  setMemberPhotoFile(null);
  renderMemberPhotoPreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fillProjectForm(project) {
  if (!elements['project-form']) return;
  if (elements['project-form-title']) elements['project-form-title'].textContent = '과제 수정';

  const form = elements['project-form'];
  form.elements.title.value = project.title || '';
  form.elements.description.value = project.description || '';
  form.elements.status.value = project.status || 'ongoing';
  form.elements.period.value = project.period || '';
  form.elements.year.value = project.year || '';
  form.elements.tags.value = project.tags?.join(', ') || '';
  form.elements.sortOrder.value = project.sortOrder || 999;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fillPublicationForm(publication) {
  if (!elements['publication-form']) return;
  if (elements['publication-form-title']) elements['publication-form-title'].textContent = '논문 수정';

  const form = elements['publication-form'];
  form.elements.title.value = publication.title || '';
  form.elements.authors.value = publication.authors || '';
  form.elements.journal.value = publication.journal || '';
  form.elements.year.value = publication.year || '';
  form.elements.doi.value = publication.doi || '';
  form.elements.url.value = publication.url || '';
  form.elements.abstract.value = publication.abstract || '';
  form.elements.sortOrder.value = publication.sortOrder || 999;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function quickGraduate(member) {
  const graduationYear = window.prompt('졸업 연도를 입력하세요.', member.graduationYear || String(new Date().getFullYear()));
  if (graduationYear === null) return;
  const currentPosition = window.prompt('현재 진로 / 취업처를 입력하세요.', member.currentPosition || '') ?? '';

  try {
    await saveDocument(COLLECTIONS.members, member.id, {
      ...member,
      status: 'alumni',
      group: member.group === 'Alumni' ? member.group : member.group,
      graduationYear,
      currentPosition
    });
    showNotice('졸업 처리되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || '졸업 처리에 실패했습니다.', 'danger');
  }
}

async function restoreMember(member) {
  try {
    await saveDocument(COLLECTIONS.members, member.id, {
      ...member,
      status: 'active',
      graduationYear: '',
      currentPosition: member.currentPosition || ''
    });
    showNotice('현재 멤버로 복원되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || '재학 전환에 실패했습니다.', 'danger');
  }
}

async function toggleProjectStatus(project, status) {
  try {
    await saveDocument(COLLECTIONS.projects, project.id, {
      ...project,
      status
    });
    showNotice(status === 'completed' ? '과제가 종료 목록으로 이동되었습니다.' : '과제가 진행중 목록으로 이동되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || '과제 상태 변경에 실패했습니다.', 'danger');
  }
}

async function deleteMember(member) {
  if (!window.confirm(`${member.name} 멤버를 삭제할까요?`)) return;

  try {
    if (member.photoPath) {
      try {
        await deleteMemberPhoto(member.photoPath);
      } catch (error) {
        console.warn('사진 삭제 실패', error);
      }
    }
    await deleteDocumentById(COLLECTIONS.members, member.id);
    showNotice('멤버가 삭제되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || '멤버 삭제에 실패했습니다.', 'danger');
  }
}

async function deleteProject(project) {
  if (!window.confirm(`${project.title} 과제를 삭제할까요?`)) return;

  try {
    await deleteDocumentById(COLLECTIONS.projects, project.id);
    showNotice('과제가 삭제되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || '과제 삭제에 실패했습니다.', 'danger');
  }
}

async function deletePublication(publication) {
  if (!window.confirm(`${publication.title} 논문을 삭제할까요?`)) return;

  try {
    await deleteDocumentById(COLLECTIONS.publications, publication.id);
    showNotice('논문이 삭제되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || '논문 삭제에 실패했습니다.', 'danger');
  }
}

async function seedFallbackData() {
  if (!state.user) {
    showNotice('로그인 후에만 기본 데이터 업로드를 실행할 수 있습니다.', 'warning');
    return;
  }

  const shouldProceed = window.confirm(
    '현재 업로드한 사이트 기준의 기본 데이터를 Firebase에 넣습니다.\n이미 같은 ID의 문서가 있으면 덮어쓸 수 있습니다. 계속할까요?'
  );

  if (!shouldProceed) return;

  elements['seed-data-button'].disabled = true;
  elements['seed-data-button'].textContent = '업로드 중...';

  try {
    await Promise.all([
      ...fallbackMembers.map((item) => saveDocument(COLLECTIONS.members, item.id, item)),
      ...fallbackProjects.map((item) => saveDocument(COLLECTIONS.projects, item.id, item)),
      ...fallbackPublications.map((item) => saveDocument(COLLECTIONS.publications, item.id, item))
    ]);

    showNotice('기본 데이터 업로드가 완료되었습니다.', 'success');
  } catch (error) {
    console.error(error);
    showNotice(error.message || '기본 데이터 업로드에 실패했습니다.', 'danger');
  } finally {
    elements['seed-data-button'].disabled = false;
    elements['seed-data-button'].textContent = '현재 사이트 데이터로 시작하기';
  }
}

function emptyStateMarkup(message) {
  return `
    <div class="empty-card">
      <h4>Empty</h4>
      <p>${escapeHTML(message)}</p>
    </div>
  `;
}

function showNotice(message, type = 'info') {
  if (!elements['admin-alert']) return;
  elements['admin-alert'].className = `notice notice--${type}`;
  elements['admin-alert'].textContent = message;
}
