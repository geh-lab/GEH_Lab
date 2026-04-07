export function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getInitials(name = '') {
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0])
    .join('')
    .toUpperCase();
  return initials || 'GEH';
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === 0 || value === false) return true;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function mergeObjects(base = {}, override = {}) {
  const result = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length) result[key] = value;
      return;
    }
    if (hasMeaningfulValue(value)) result[key] = value;
  });
  return result;
}

function semanticKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '');
}

export function memberSemanticKey(item = {}) {
  return semanticKey(item.name || item.id || '');
}

export function projectSemanticKey(item = {}) {
  return semanticKey(item.title || item.id || '');
}

export function publicationSemanticKey(item = {}) {
  return semanticKey(item.doi || `${item.year || ''}-${item.title || item.id || ''}`);
}

export function groupBy(items = [], keyGetter) {
  return items.reduce((acc, item) => {
    const key = keyGetter(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

export function rootAsset(path = '', root = '.') {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const normalized = path.replace(/^\.\//, '');
  return root === '.' ? normalized : `${root}/${normalized}`;
}

export function toTimeValue(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
  }
  if (value?.seconds) return value.seconds * 1000;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return 0;
}

export function formatDate(value, locale = 'ko-KR') {
  const time = toTimeValue(value);
  const date = time ? new Date(time) : new Date();
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function normalizeString(value = '') {
  return String(value || '').trim().toLowerCase();
}

function hasExplicitKey(item = {}, key) {
  return Object.prototype.hasOwnProperty.call(item, key) && String(item[key] ?? '').trim() !== '';
}

function mapStatus(value = '') {
  const text = normalizeString(value);
  if (text.includes('alumni') || text.includes('gradu') || text.includes('졸업')) return 'alumni';
  if (text.includes('active') || text.includes('enrolled') || text.includes('재학')) return 'enrolled';
  return 'enrolled';
}

function mapTrack(value = '') {
  const text = normalizeString(value);
  if (!text || text === 'none' || text === '해당 없음') return 'none';
  if (text.includes('part') || text.includes('파트')) return 'partTime';
  if (text.includes('full') || text.includes('풀타임')) return 'fullTime';
  return 'none';
}

function mapCourse(value = '', group = '') {
  const text = normalizeString(value);
  if (['professor', 'faculty'].includes(text) || text.includes('교수')) return 'professor';
  if (['postdoc', 'postdoctoral', 'postdoctoralresearcher'].includes(text) || text.includes('박사후')) return 'postdoc';
  if (['researcher', 'studentresearcher', 'research intern', 'intern'].includes(text) || text.includes('학생연구원')) return 'researcher';
  if (['alumni'].includes(text) || text.includes('졸업')) return 'alumni';
  if (['phd', 'ph.d', 'ph.d.', 'doctor'].includes(text) || text.includes('박사')) return 'phd';
  if (['ms', 'm.s', 'm.s.', 'master'].includes(text) || text.includes('석사')) return 'ms';
  if (group === 'pi') return 'professor';
  if (group === 'researchProfessor') return 'postdoc';
  if (group === 'studentResearcher') return 'researcher';
  if (group === 'alumni') return 'alumni';
  return 'ms';
}

function mapGroup(value = '', status = '', course = '') {
  const text = normalizeString(value);
  const courseText = normalizeString(course);
  if (status === 'alumni') return 'alumni';
  if (['pi', 'principalinvestigator', 'principal-investigator'].includes(text)) return 'pi';
  if (['researchprofessor', 'research professor', 'postdoc', 'postdoctoral', 'postdoctoralresearcher', 'research-professor'].includes(text)) return 'researchProfessor';
  if (['studentresearcher', 'student-researcher', 'researchintern', 'research intern', 'intern'].includes(text)) return 'studentResearcher';
  if (['graduatestudent', 'graduate-student', 'graduate student'].includes(text)) {
    if (courseText.includes('professor') || courseText.includes('교수')) return 'pi';
    if (courseText.includes('postdoc') || courseText.includes('박사후')) return 'researchProfessor';
    if (courseText.includes('researcher') || courseText.includes('intern') || courseText.includes('학생연구원')) return 'studentResearcher';
    return 'graduateStudent';
  }
  if (text.includes('principal') || text.includes('지도교수') || text.includes('연구책임') || text === '교수') return 'pi';
  if (text.includes('research professor') || text.includes('postdoctoral') || text.includes('postdoc') || text.includes('연구교수')) return 'researchProfessor';
  if (text.includes('student researcher') || text.includes('intern') || text.includes('학생연구원')) return 'studentResearcher';
  if (text.includes('alumni') || text.includes('졸업')) return 'alumni';
  if (courseText.includes('professor') || courseText.includes('교수')) return 'pi';
  if (courseText.includes('postdoc') || courseText.includes('박사후')) return 'researchProfessor';
  if (courseText.includes('researcher') || courseText.includes('intern') || courseText.includes('학생연구원')) return 'studentResearcher';
  return 'graduateStudent';
}

export function normalizeMember(item = {}, options = {}) {
  const preserveMissing = Boolean(options.preserveMissing);
  const courseSource = item.course || item.degree || '';
  const trackSource = item.track || item.degree || '';
  const explicitStatus = hasExplicitKey(item, 'status') ? mapStatus(item.status) : undefined;
  const explicitCourse = (hasExplicitKey(item, 'course') || hasExplicitKey(item, 'degree')) ? mapCourse(courseSource) : undefined;
  const explicitGroup = hasExplicitKey(item, 'group') ? mapGroup(item.group, explicitStatus || '', explicitCourse || courseSource || '') : undefined;
  const explicitTrack = (hasExplicitKey(item, 'track') || hasExplicitKey(item, 'degree')) ? mapTrack(trackSource) : undefined;

  const status = preserveMissing ? explicitStatus : (explicitStatus || 'enrolled');
  const group = preserveMissing
    ? (explicitGroup || (status === 'alumni' ? 'alumni' : undefined))
    : mapGroup(item.group, status || 'enrolled', explicitCourse || courseSource || '');
  const course = preserveMissing ? explicitCourse : mapCourse(item.course, group || '');
  const track = preserveMissing ? explicitTrack : mapTrack(item.track);
  const sortOrder = hasExplicitKey(item, 'sortOrder') ? Number(item.sortOrder) : (preserveMissing ? undefined : 999);

  return {
    id: item.id || (!preserveMissing ? slugify(item.name || crypto.randomUUID()) : undefined),
    name: item.name || '',
    group,
    track,
    course,
    email: item.email || '',
    bio: item.bio || '',
    education: item.education || '',
    experience: item.experience || '',
    researchInterest: item.researchInterest || '',
    currentPosition: item.currentPosition || item.employment || '',
    status,
    graduationYear: item.graduationYear || '',
    sortOrder,
    photoUrl: item.photoUrl || item.image || '',
    photoPath: item.photoPath || '',
    createdAt: item.createdAt || undefined,
    updatedAt: item.updatedAt || undefined
  };
}

export function normalizeProject(item = {}, options = {}) {
  const preserveMissing = Boolean(options.preserveMissing);
  const explicitStatus = hasExplicitKey(item, 'status')
    ? (normalizeString(item.status).includes('complete') || normalizeString(item.status).includes('종료') ? 'completed' : 'ongoing')
    : undefined;
  const sortOrder = hasExplicitKey(item, 'sortOrder') ? Number(item.sortOrder) : (preserveMissing ? undefined : 999);
  const tags = Array.isArray(item.tags)
    ? item.tags
    : hasExplicitKey(item, 'tags')
      ? String(item.tags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : preserveMissing
        ? undefined
        : [];
  return {
    id: item.id || (!preserveMissing ? slugify(item.title || crypto.randomUUID()) : undefined),
    title: item.title || '',
    description: item.description || item.desc || '',
    status: preserveMissing ? explicitStatus : (explicitStatus || 'ongoing'),
    period: item.period || '',
    year: item.year || '',
    tags,
    sortOrder,
    createdAt: item.createdAt || undefined,
    updatedAt: item.updatedAt || undefined
  };
}

export function normalizePublication(item = {}, options = {}) {
  const preserveMissing = Boolean(options.preserveMissing);
  const sortOrder = hasExplicitKey(item, 'sortOrder') ? Number(item.sortOrder) : (preserveMissing ? undefined : 999);
  return {
    id: item.id || (!preserveMissing ? slugify(`${item.year || ''}-${item.title || crypto.randomUUID()}`) : undefined),
    title: item.title || '',
    authors: item.authors || '',
    journal: item.journal || '',
    year: item.year || '',
    doi: item.doi || '',
    url: item.url || '',
    abstract: item.abstract || '',
    sortOrder,
    createdAt: item.createdAt || undefined,
    updatedAt: item.updatedAt || undefined
  };
}

function preserveLegacyMemberGroup(previous, remoteRaw = {}, merged) {
  const rawCourse = normalizeString(remoteRaw.course);
  const normalizedRemoteGroup = merged.group || '';
  const needsFallbackGroup = !hasExplicitKey(remoteRaw, 'group') || normalizedRemoteGroup === 'graduateStudent';
  const needsFallbackCourse = !hasExplicitKey(remoteRaw, 'course') || !rawCourse || rawCourse === 'ms' || rawCourse === 'm.s' || rawCourse === 'm.s.';
  if (!previous) return merged;
  if (['pi', 'researchProfessor', 'studentResearcher'].includes(previous.group) && needsFallbackGroup) {
    merged.group = previous.group;
    if (needsFallbackCourse) merged.course = previous.course;
    if (!hasExplicitKey(remoteRaw, 'track')) merged.track = previous.track;
  }
  return merged;
}

function mergeBySemanticKey(fallbackItems = [], remoteItems = [], normalizer, keyGetter, mergeResolver) {
  const map = new Map();
  fallbackItems.map((item) => normalizer(item)).forEach((item) => {
    const key = keyGetter(item);
    if (!key) return;
    map.set(key, item);
  });
  remoteItems.forEach((rawItem) => {
    const normalizedRemote = normalizer(rawItem, { preserveMissing: true });
    const key = keyGetter(normalizedRemote);
    if (!key) return;
    const previous = map.get(key);
    const merged = previous ? mergeObjects(previous, normalizedRemote) : normalizer(rawItem);
    map.set(key, mergeResolver ? mergeResolver(previous, rawItem, merged) : merged);
  });
  return Array.from(map.values());
}

export function mergeMembers(fallbackItems = [], remoteItems = []) {
  return mergeBySemanticKey(fallbackItems, remoteItems, normalizeMember, memberSemanticKey, preserveLegacyMemberGroup);
}

export function mergeProjects(fallbackItems = [], remoteItems = []) {
  return mergeBySemanticKey(fallbackItems, remoteItems, normalizeProject, projectSemanticKey);
}

export function mergePublications(fallbackItems = [], remoteItems = []) {
  return mergeBySemanticKey(fallbackItems, remoteItems, normalizePublication, publicationSemanticKey);
}

const GROUP_ORDER = { pi: 0, researchProfessor: 1, graduateStudent: 2, studentResearcher: 3, alumni: 4 };
const TRACK_ORDER = { fullTime: 0, partTime: 1, none: 2 };
const COURSE_ORDER = { professor: 0, postdoc: 1, phd: 2, ms: 3, researcher: 4, alumni: 5 };

function yearValue(value = '') {
  const match = String(value).match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

export function sortMembers(items = []) {
  return [...items]
    .map((item) => normalizeMember(item))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'enrolled' ? -1 : 1;
      if (a.status === 'alumni') {
        const byYear = yearValue(b.graduationYear) - yearValue(a.graduationYear);
        if (byYear) return byYear;
      }
      const byGroup = (GROUP_ORDER[a.group] ?? 99) - (GROUP_ORDER[b.group] ?? 99);
      if (byGroup) return byGroup;
      const byTrack = (TRACK_ORDER[a.track] ?? 99) - (TRACK_ORDER[b.track] ?? 99);
      if (byTrack) return byTrack;
      const byCourse = (COURSE_ORDER[a.course] ?? 99) - (COURSE_ORDER[b.course] ?? 99);
      if (byCourse) return byCourse;
      const bySort = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (bySort) return bySort;
      return a.name.localeCompare(b.name, 'en');
    });
}

export function sortProjects(items = []) {
  return [...items]
    .map((item) => normalizeProject(item))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ongoing' ? -1 : 1;
      const byYear = yearValue(b.year || b.period) - yearValue(a.year || a.period);
      if (byYear) return byYear;
      const bySort = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (bySort) return bySort;
      return a.title.localeCompare(b.title, 'en');
    });
}

export function sortPublications(items = []) {
  return [...items]
    .map((item) => normalizePublication(item))
    .sort((a, b) => {
      const byYear = yearValue(b.year) - yearValue(a.year);
      if (byYear) return byYear;
      const bySort = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (bySort) return bySort;
      return a.title.localeCompare(b.title, 'en');
    });
}

export function lastUpdated(items = [], fallback) {
  const max = items.reduce((acc, item) => Math.max(acc, toTimeValue(item.updatedAt), toTimeValue(item.createdAt)), 0);
  return max || fallback;
}

export function resolvePublicationLink(item = {}) {
  if (item.url) return item.url;
  if (item.doi) return /^https?:/i.test(item.doi) ? item.doi : `https://doi.org/${item.doi}`;
  return '';
}

export function memberStatusLabel(member, lang = 'kr') {
  if (lang === 'en') return member.status === 'alumni' ? 'Alumni' : 'Enrolled';
  return member.status === 'alumni' ? '졸업' : '재학중';
}

export function memberGroupLabel(group, lang = 'kr') {
  const map = {
    pi: { kr: '지도교수', en: 'Principal Investigator' },
    researchProfessor: { kr: '연구교수', en: 'Research Professor' },
    graduateStudent: { kr: '대학원생', en: 'Graduate Student' },
    studentResearcher: { kr: '학생연구원', en: 'Student Researcher' },
    alumni: { kr: '졸업생', en: 'Alumni' }
  };
  return map[group]?.[lang] || group;
}

export function memberTrackLabel(track, lang = 'kr') {
  const map = {
    fullTime: { kr: '풀타임', en: 'Full-time' },
    partTime: { kr: '파트타임', en: 'Part-time' },
    none: { kr: '', en: '' }
  };
  return map[track]?.[lang] || '';
}

export function memberCourseLabel(course, lang = 'kr') {
  const map = {
    professor: { kr: '교수', en: 'Professor' },
    postdoc: { kr: '박사후연구원', en: 'Postdoc' },
    phd: { kr: '박사과정', en: 'Ph.D.' },
    ms: { kr: '석사과정', en: 'M.S.' },
    researcher: { kr: '학생연구원', en: 'Student Researcher' },
    alumni: { kr: '졸업생', en: 'Alumni' }
  };
  return map[course]?.[lang] || course;
}

export function projectStatusLabel(status, lang = 'kr') {
  if (lang === 'en') return status === 'completed' ? 'Archived' : 'In progress';
  return status === 'completed' ? '종료' : '진행중';
}
