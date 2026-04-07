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
    .replace(/[^a-z0-9가-힣]+/g, '-')
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
  return semanticKey(item.id || item.name || '');
}

export function projectSemanticKey(item = {}) {
  return semanticKey(item.id || item.title || '');
}

export function publicationSemanticKey(item = {}) {
  return semanticKey(item.id || item.doi || item.url || `${item.year || ''}-${item.title || ''}`);
}

export function boardSemanticKey(item = {}) {
  return semanticKey(item.id || item.title || '');
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

function extractYear(value = '') {
  const years = String(value || '').match(/(?:19|20)\d{2}/g);
  return years?.length ? years[years.length - 1] : '';
}

function extractMonth(value = '') {
  const num = Number(String(value || '').trim());
  return Number.isFinite(num) && num >= 1 && num <= 12 ? String(num).padStart(2, '0') : '';
}

function mapStatus(value = '') {
  const text = normalizeString(value);
  if (text.includes('alumni') || text.includes('gradu') || text.includes('졸업')) return 'alumni';
  if (text.includes('active') || text.includes('enrolled') || text.includes('재학')) return 'enrolled';
  return 'enrolled';
}

function mapTrack(value = '') {
  const text = normalizeString(value);
  if (!text || text === 'none' || text === '해당없음' || text === '해당 없음') return 'none';
  if (text.includes('part') || text.includes('파트')) return 'partTime';
  if (text.includes('full') || text.includes('풀')) return 'fullTime';
  return 'none';
}

function mapLeadRole(value = '') {
  const text = normalizeString(value);
  if (text.includes('주관')) return 'host';
  if (text.includes('공동')) return 'co';
  return 'principal';
}

function mapCourse(value = '', group = '') {
  const text = normalizeString(value);
  if (text.includes('교수') || text === 'professor' || text === 'faculty') return 'professor';
  if (text.includes('박사후') || text.includes('postdoc') || text.includes('postdoctoral')) return 'postdoc';
  if (text.includes('학부연구생') || text.includes('undergrad') || text.includes('intern') || text.includes('researcher') || text.includes('학생연구원')) return 'undergrad';
  if (text.includes('졸업') || text === 'alumni') return 'alumni';
  if (text.includes('박사') || text === 'phd' || text === 'ph.d') return 'phd';
  if (text.includes('석사') || text === 'ms' || text === 'm.s' || text === 'master') return 'ms';
  if (group === 'pi') return 'professor';
  if (group === 'researchProfessor') return 'postdoc';
  if (group === 'studentResearcher') return 'undergrad';
  if (group === 'alumni') return 'alumni';
  return 'ms';
}

function mapGroup(value = '', status = '', course = '') {
  const text = normalizeString(value);
  const courseText = normalizeString(course);
  if (status === 'alumni') return 'alumni';
  if (['pi', 'principalinvestigator', 'principal-investigator'].includes(text) || text.includes('연구책임') || text.includes('지도교수')) return 'pi';
  if (text.includes('researchprofessor') || text.includes('research professor') || text.includes('연구교수') || text.includes('postdoc') || text.includes('박사후')) return 'researchProfessor';
  if (text.includes('studentresearcher') || text.includes('research intern') || text.includes('intern') || text.includes('학부연구생') || text.includes('학생연구원')) return 'studentResearcher';
  if (text.includes('alumni') || text.includes('졸업')) return 'alumni';
  if (courseText.includes('professor') || courseText.includes('교수')) return 'pi';
  if (courseText.includes('postdoc') || courseText.includes('박사후')) return 'researchProfessor';
  if (courseText.includes('undergrad') || courseText.includes('intern') || courseText.includes('학부연구생') || courseText.includes('학생연구원')) return 'studentResearcher';
  return 'graduateStudent';
}


function inferPublicationIndexing(journal = '') {
  const name = normalizeString(journal);
  if (!name) return '';
  const sciKeywords = [
    'horticultural science and technology'
  ];
  const kciKeywords = [
    'journal of bio-environment control',
    'the korean society for bio-environment control',
    'horticulture journal'
  ];
  if (sciKeywords.some((keyword) => name.includes(keyword))) return 'SCI';
  if (kciKeywords.some((keyword) => name.includes(keyword))) return 'KCI';
  return 'SCI';
}

export function normalizeMember(item = {}, options = {}) {
  const preserveMissing = Boolean(options.preserveMissing);
  const courseSource = item.course || item.degree || '';
  const trackSource = item.track || item.degree || '';
  const explicitStatus = hasExplicitKey(item, 'status') ? mapStatus(item.status) : undefined;
  const explicitCourse = (hasExplicitKey(item, 'course') || hasExplicitKey(item, 'degree')) ? mapCourse(courseSource, item.group || '') : undefined;
  const explicitGroup = hasExplicitKey(item, 'group') ? mapGroup(item.group, explicitStatus || '', explicitCourse || courseSource || '') : undefined;
  const explicitTrack = (hasExplicitKey(item, 'track') || hasExplicitKey(item, 'degree')) ? mapTrack(trackSource) : undefined;

  const status = preserveMissing ? explicitStatus : (explicitStatus || 'enrolled');
  const group = preserveMissing
    ? (explicitGroup || (status === 'alumni' ? 'alumni' : undefined))
    : mapGroup(item.group, status || 'enrolled', explicitCourse || courseSource || '');
  const course = preserveMissing ? explicitCourse : mapCourse(item.course || item.degree || '', group || '');
  const track = preserveMissing ? explicitTrack : mapTrack(item.track || '');
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
    coursesInfo: item.coursesInfo || item.courseInfo || '',
    relatedProjects: item.relatedProjects || '',
    authorshipNote: item.authorshipNote || '',
    currentPosition: item.currentPosition || item.employment || '',
    status,
    graduationYear: item.graduationYear || '',
    startYear: item.startYear || item.admissionYear || '',
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
      ? String(item.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)
      : preserveMissing ? undefined : [];
  const period = item.period || '';
  const year = item.year || extractYear(period);
  return {
    id: item.id || (!preserveMissing ? slugify(item.title || crypto.randomUUID()) : undefined),
    title: item.title || '',
    description: item.description || item.desc || '',
    status: preserveMissing ? explicitStatus : (explicitStatus || 'ongoing'),
    period,
    year,
    leadRole: mapLeadRole(item.leadRole || item.principalRole || ''),
    principalInvestigator: item.principalInvestigator || item.pi || '',
    coResearchers: item.coResearchers || item.coInvestigator || '',
    figureUrl: item.figureUrl || item.imageUrl || '',
    figurePath: item.figurePath || '',
    figureAspect: item.figureAspect || '16:9',
    tags,
    sortOrder,
    createdAt: item.createdAt || undefined,
    updatedAt: item.updatedAt || undefined
  };
}

export function normalizePublication(item = {}, options = {}) {
  const preserveMissing = Boolean(options.preserveMissing);
  const sortOrder = hasExplicitKey(item, 'sortOrder') ? Number(item.sortOrder) : (preserveMissing ? undefined : 999);
  const inferredIndexing = inferPublicationIndexing(item.journal || '');
  return {
    id: item.id || (!preserveMissing ? slugify(`${item.year || ''}-${item.title || crypto.randomUUID()}`) : undefined),
    title: item.title || '',
    authors: item.authors || '',
    journal: item.journal || '',
    year: item.year || '',
    month: extractMonth(item.month),
    doi: item.doi || '',
    url: item.url || '',
    abstract: item.abstract || '',
    indexing: inferredIndexing || item.indexing || '',
    sortOrder,
    createdAt: item.createdAt || undefined,
    updatedAt: item.updatedAt || undefined
  };
}

export function normalizeBoardPost(item = {}, options = {}) {
  const preserveMissing = Boolean(options.preserveMissing);
  return {
    id: item.id || (!preserveMissing ? slugify(item.title || crypto.randomUUID()) : undefined),
    category: item.category || 'notice',
    title: item.title || '',
    description: item.description || item.body || '',
    linkUrl: item.linkUrl || item.url || '',
    imageUrl: item.imageUrl || '',
    imagePath: item.imagePath || '',
    date: item.date || '',
    createdAt: item.createdAt || undefined,
    updatedAt: item.updatedAt || undefined
  };
}

function preserveLegacyMemberGroup(previous, remoteRaw = {}, merged) {
  if (!previous) return merged;
  const remoteGroup = normalizeString(remoteRaw.group);
  const remoteCourse = normalizeString(remoteRaw.course || remoteRaw.degree);
  if (['pi', 'researchProfessor', 'studentResearcher'].includes(previous.group)) {
    const weakGroup = !remoteGroup || remoteGroup === 'graduatestudent' || remoteGroup === 'graduate student';
    const weakCourse = !remoteCourse || ['ms', 'm.s', 'm.s.', 'master'].includes(remoteCourse);
    if (weakGroup) merged.group = previous.group;
    if (weakCourse) merged.course = previous.course;
    if (!hasExplicitKey(remoteRaw, 'track')) merged.track = previous.track;
  }
  if (!hasMeaningfulValue(remoteRaw.photoUrl) && !hasMeaningfulValue(remoteRaw.image)) merged.photoUrl = previous.photoUrl;
  return merged;
}

function mergeBySemanticKey(fallbackItems = [], remoteItems = [], normalizer, keyGetter, mergeResolver) {
  const map = new Map();
  fallbackItems.map((item) => normalizer(item)).forEach((item) => {
    const key = keyGetter(item);
    if (key) map.set(key, item);
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

export function mergeBoardPosts(fallbackItems = [], remoteItems = []) {
  return mergeBySemanticKey(fallbackItems, remoteItems, normalizeBoardPost, boardSemanticKey);
}

const GROUP_ORDER = { pi: 0, researchProfessor: 1, graduateStudent: 2, studentResearcher: 3, alumni: 4 };
const TRACK_ORDER = { fullTime: 0, partTime: 1, none: 2 };
const COURSE_ORDER = { professor: 0, postdoc: 1, phd: 2, ms: 3, undergrad: 4, alumni: 5 };

function yearValue(value = '') {
  const match = String(value).match(/(?:19|20)\d{2}/);
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
      const byCourse = (COURSE_ORDER[a.course] ?? 99) - (COURSE_ORDER[b.course] ?? 99);
      if (byCourse) return byCourse;
      const byTrack = (TRACK_ORDER[a.track] ?? 99) - (TRACK_ORDER[b.track] ?? 99);
      if (byTrack) return byTrack;
      const bySort = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (bySort) return bySort;
      const byStart = yearValue(a.startYear) - yearValue(b.startYear);
      if (byStart) return byStart;
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
      const byMonth = Number(b.month || 0) - Number(a.month || 0);
      if (byMonth) return byMonth;
      const byAuthors = String(a.authors || '').localeCompare(String(b.authors || ''), 'en', { sensitivity: 'base' });
      if (byAuthors) return byAuthors;
      return String(a.title || '').localeCompare(String(b.title || ''), 'en', { sensitivity: 'base' });
    });
}

export function sortBoardPosts(items = []) {
  return [...items]
    .map((item) => normalizeBoardPost(item))
    .sort((a, b) => {
      const byDate = yearValue(b.date) - yearValue(a.date);
      if (byDate) return byDate;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
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
    pi: { kr: '연구책임자 / 교수', en: 'Principal Investigator / Professor' },
    researchProfessor: { kr: '연구교수 / 박사후연구원', en: 'Research Professor / Postdoc' },
    graduateStudent: { kr: '대학원생', en: 'Graduate Student' },
    studentResearcher: { kr: '학부연구생', en: 'Undergraduate Researcher' },
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
    undergrad: { kr: '학부연구생', en: 'Undergraduate Researcher' },
    alumni: { kr: '졸업생', en: 'Alumni' }
  };
  return map[course]?.[lang] || course;
}

export function projectStatusLabel(status, lang = 'kr') {
  if (lang === 'en') return status === 'completed' ? 'Archived' : 'In progress';
  return status === 'completed' ? '종료' : '진행중';
}

export function publicationIndexingLabel(indexing = '', lang = 'kr') {
  const normalized = normalizeString(indexing).toUpperCase();
  if (!normalized) return '';
  return normalized;
}


export function leadRoleLabel(role = 'principal', lang = 'kr') {
  const map = {
    principal: { kr: '연구책임자', en: 'Principal investigator' },
    co: { kr: '공동연구책임자', en: 'Co-principal investigator' },
    host: { kr: '주관책임자', en: 'Lead investigator' }
  };
  return map[role]?.[lang] || map.principal[lang];
}

export function journalToneClass(journal = '') {
  const key = semanticKey(journal);
  const map = {
    'thekoreansocietyforbioenvironmentcontrol': 'journal-tone-red',
    'journalofbioenvironmentcontrol': 'journal-tone-red',
    'horticulturalscienceandtechnology': 'journal-tone-purple',
    'frontiersinplantscience': 'journal-tone-blue',
    'plants': 'journal-tone-green',
    'agronomy': 'journal-tone-orange',
    'agriculture': 'journal-tone-orange',
    'horticulturae': 'journal-tone-teal',
    'horticultureenvironmentandbiotechnology': 'journal-tone-indigo',
    'ozonescienceengineering': 'journal-tone-sky',
    'plosone': 'journal-tone-rose',
    'canadianjournalofplantscience': 'journal-tone-amber',
    'plantgrowthregulation': 'journal-tone-emerald',
    'foods': 'journal-tone-lime',
    'heliyon': 'journal-tone-pink',
    'chemicalandbiologicaltechnologiesinagriculture': 'journal-tone-cyan',
    'phyton': 'journal-tone-violet',
    'australianjournalofcropscience': 'journal-tone-fuchsia',
    'journalofphytology': 'journal-tone-brown',
    'horticulturejournal': 'journal-tone-slate'
  };
  return map[key] || 'journal-tone-default';
}

export function memberYearLabel(member = {}, lang = 'kr') {
  const year = Number(String(member.startYear || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
  if (!year) return '';
  const current = new Date().getFullYear();
  const diff = current - year + 1;
  if (diff < 1) return '';
  return lang === 'en' ? `Year ${diff}` : `${diff}년차`;
}
