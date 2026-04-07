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
    if (hasMeaningfulValue(value)) {
      result[key] = value;
    }
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

function mergeBySemanticKey(fallbackItems = [], remoteItems = [], normalizer, keyGetter) {
  const map = new Map();
  fallbackItems.map(normalizer).forEach((item) => {
    const key = keyGetter(item);
    if (!key) return;
    map.set(key, item);
  });
  remoteItems.map(normalizer).forEach((item) => {
    const key = keyGetter(item);
    if (!key) return;
    const previous = map.get(key);
    map.set(key, previous ? mergeObjects(previous, item) : item);
  });
  return Array.from(map.values());
}

export function mergeMembers(fallbackItems = [], remoteItems = []) {
  return mergeBySemanticKey(fallbackItems, remoteItems, normalizeMember, memberSemanticKey);
}

export function mergeProjects(fallbackItems = [], remoteItems = []) {
  return mergeBySemanticKey(fallbackItems, remoteItems, normalizeProject, projectSemanticKey);
}

export function mergePublications(fallbackItems = [], remoteItems = []) {
  return mergeBySemanticKey(fallbackItems, remoteItems, normalizePublication, publicationSemanticKey);
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

function mapGroup(value = '', status = '') {
  const text = normalizeString(value);
  if (status === 'alumni') return 'alumni';
  if (text.includes('principal') || text.includes('faculty') || text.includes('교수')) return 'pi';
  if (text.includes('research professor') || text.includes('postdoctoral') || text.includes('postdoc') || text.includes('연구교수')) return 'researchProfessor';
  if (text.includes('intern') || text.includes('student researcher') || text.includes('학생연구원')) return 'studentResearcher';
  if (text.includes('alumni') || text.includes('졸업')) return 'alumni';
  return 'graduateStudent';
}

function mapTrack(value = '') {
  const text = normalizeString(value);
  if (text.includes('part') || text.includes('파트')) return 'partTime';
  if (text.includes('full') || text.includes('풀타임')) return 'fullTime';
  return 'none';
}

function mapCourse(value = '', group = '') {
  const text = normalizeString(value);
  if (group === 'pi') return 'professor';
  if (group === 'researchProfessor') return 'postdoc';
  if (group === 'studentResearcher') return 'researcher';
  if (group === 'alumni') return 'alumni';
  if (text.includes('ph') || text.includes('박사')) return 'phd';
  if (text.includes('m.s') || text.includes('ms') || text.includes('석사')) return 'ms';
  return 'ms';
}

function mapStatus(value = '') {
  const text = normalizeString(value);
  if (text.includes('alumni') || text.includes('gradu') || text.includes('졸업')) return 'alumni';
  return 'enrolled';
}

export function normalizeMember(item = {}) {
  const status = mapStatus(item.status);
  const group = mapGroup(item.group, status);
  const track = mapTrack(item.track);
  const course = mapCourse(item.course, group);
  return {
    id: item.id || slugify(item.name || crypto.randomUUID()),
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
    sortOrder: Number(item.sortOrder ?? 999),
    photoUrl: item.photoUrl || item.image || '',
    photoPath: item.photoPath || '',
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

export function normalizeProject(item = {}) {
  const rawStatus = normalizeString(item.status);
  const status = rawStatus.includes('complete') || rawStatus.includes('종료') ? 'completed' : 'ongoing';
  return {
    id: item.id || slugify(item.title || crypto.randomUUID()),
    title: item.title || '',
    description: item.description || item.desc || '',
    status,
    period: item.period || '',
    year: item.year || '',
    tags: Array.isArray(item.tags)
      ? item.tags
      : String(item.tags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
    sortOrder: Number(item.sortOrder ?? 999),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

export function normalizePublication(item = {}) {
  return {
    id: item.id || slugify(`${item.year || ''}-${item.title || crypto.randomUUID()}`),
    title: item.title || '',
    authors: item.authors || '',
    journal: item.journal || '',
    year: item.year || '',
    doi: item.doi || '',
    url: item.url || '',
    abstract: item.abstract || '',
    sortOrder: Number(item.sortOrder ?? 999),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

const GROUP_ORDER = {
  pi: 0,
  researchProfessor: 1,
  graduateStudent: 2,
  studentResearcher: 3,
  alumni: 4
};

const TRACK_ORDER = {
  fullTime: 0,
  partTime: 1,
  none: 2
};

const COURSE_ORDER = {
  professor: 0,
  postdoc: 1,
  phd: 2,
  ms: 3,
  researcher: 4,
  alumni: 5
};

function yearValue(value = '') {
  const match = String(value).match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

export function sortMembers(items = []) {
  return [...items]
    .map(normalizeMember)
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
    .map(normalizeProject)
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
    .map(normalizePublication)
    .sort((a, b) => {
      const byYear = yearValue(b.year) - yearValue(a.year);
      if (byYear) return byYear;
      const bySort = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (bySort) return bySort;
      return a.title.localeCompare(b.title, 'en');
    });
}

export function lastUpdated(items = [], fallback) {
  const max = items.reduce((acc, item) => {
    return Math.max(acc, toTimeValue(item.updatedAt), toTimeValue(item.createdAt));
  }, 0);
  return max || fallback;
}

export function resolvePublicationLink(item = {}) {
  if (item.url) return item.url;
  if (item.doi) return `https://doi.org/${item.doi}`;
  return '';
}

export function memberStatusLabel(member, lang = 'kr') {
  if (lang === 'en') return member.status === 'alumni' ? 'Alumni' : 'Enrolled';
  return member.status === 'alumni' ? '졸업' : '재학중';
}

export function memberGroupLabel(group, lang = 'kr') {
  const map = {
    pi: { kr: '연구책임자', en: 'Principal Investigator' },
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
