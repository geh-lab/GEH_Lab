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
      result[key] = value;
      return;
    }
    if (key === 'photoRemoved' && value === true) {
      result.photoRemoved = true;
      result.photoUrl = '';
      result.photoPath = '';
      return;
    }
    if ((key === 'photoUrl' || key === 'photoPath' || key === 'figureUrl' || key === 'figurePath' || key === 'imageUrl' || key === 'imagePath') && value === '') {
      result[key] = '';
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
  return semanticKey(item.email || item.id || item.nameKr || item.nameEn || item.name || '');
}

export function projectSemanticKey(item = {}) {
  return semanticKey(item.id || item.titleKr || item.titleEn || item.title || '');
}

export function publicationSemanticKey(item = {}) {
  return semanticKey(item.doi || item.title || item.url || item.id || `${item.year || ''}-${item.title || ''}`);
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

function normalizeDoiValue(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const withoutLabel = text.replace(/^doi\s*:\s*/i, '').trim();
  const doiUrlMatch = withoutLabel.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
  if (doiUrlMatch?.[1]) return doiUrlMatch[1].trim();
  return withoutLabel;
}

function hasExplicitKey(item = {}, key) {
  return Object.prototype.hasOwnProperty.call(item, key) && String(item[key] ?? '').trim() !== '';
}

function extractYear(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const years = text.match(/(?:19|20)\d{2}/g);
  return years?.length ? years[years.length - 1] : '';
}

function extractMonth(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 12) {
    return String(numeric).padStart(2, '0');
  }
  const yearMonthMatch = text.match(/(?:19|20)\d{2}\s*(?:[.\-/]|년|\s)\s*(0?[1-9]|1[0-2])(?:(?:\s*(?:[.\-/]|월))|\b)/);
  if (yearMonthMatch?.[1]) return String(Number(yearMonthMatch[1])).padStart(2, '0');
  const monthMatch = text.match(/(?:^|[^\d])(0?[1-9]|1[0-2])\s*월/);
  if (monthMatch?.[1]) return String(Number(monthMatch[1])).padStart(2, '0');
  return '';
}

function extractMonthFromDateLike(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/(?:19|20)\d{2}\s*[-/.]\s*(0?[1-9]|1[0-2])\s*[-/.]\s*(0?[1-9]|[12]\d|3[01])/);
  return match?.[1] ? String(Number(match[1])).padStart(2, '0') : '';
}

function publicationYearSource(item = {}) {
  return [
    item.year,
    item.yearMonth,
    item.yearmonth,
    item.date,
    item.publicationDate,
    item.publishDate,
    item.publishedDate,
    item.publishedAt,
    item.acceptedDate,
    item.acceptedAt,
    item.issuedAt,
    item.issueDate,
    item.releaseDate,
    item.ym
  ];
}

function publicationMonthSource(item = {}) {
  return [
    item.month,
    item.publicationMonth,
    item.publishMonth,
    item.publishedMonth,
    item.acceptedMonth,
    item.yearMonth,
    item.yearmonth,
    item.date,
    item.publicationDate,
    item.publishDate,
    item.publishedDate,
    item.publishedAt,
    item.acceptedDate,
    item.acceptedAt,
    item.issuedAt,
    item.issueDate,
    item.releaseDate,
    item.ym
  ];
}

function derivePublicationYear(item = {}) {
  for (const value of publicationYearSource(item)) {
    const year = extractYear(value);
    if (year) return year;
  }
  return '';
}

function derivePublicationMonth(item = {}) {
  for (const value of publicationMonthSource(item)) {
    const month = extractMonth(value) || extractMonthFromDateLike(value);
    if (month) return month;
  }
  return '';
}

export function publicationYearMonthLabel(item = {}, options = {}) {
  const separator = options.separator ?? '.';
  const year = derivePublicationYear(item);
  const month = derivePublicationMonth(item);
  if (!year) return '';
  return month ? `${year}${separator}${month}` : String(year);
}

export function normalizeProjectPeriod(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text
    .replace(/\s*[~∼〜]\s*/g, '–')
    .replace(/\s*[-—–]\s*/g, '–')
    .replace(/\s*\/\s*/g, ' / ');
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
  if (['researchprofessor','research-professor','postdoc','postdoctoral'].includes(text) || text.includes('research professor') || text.includes('연구교수') || text.includes('박사후')) return 'researchProfessor';
  if (['studentresearcher','student-researcher','researchintern','undergraduateresearcher'].includes(text) || text.includes('research intern') || text.includes('intern') || text.includes('학부연구생') || text.includes('학생연구원')) return 'studentResearcher';
  if (text.includes('alumni') || text.includes('졸업')) return 'alumni';
  if (courseText.includes('professor') || courseText.includes('교수')) return 'pi';
  if (courseText.includes('postdoc') || courseText.includes('박사후')) return 'researchProfessor';
  if (courseText.includes('undergrad') || courseText.includes('intern') || courseText.includes('학부연구생') || courseText.includes('학생연구원')) return 'studentResearcher';
  return 'graduateStudent';
}



function mapProjectLeadRole(value = '') {
  const text = normalizeString(value);
  if (!text || text === 'principalinvestigator' || text === 'principal-investigator' || text === '연구책임자') return 'leadInstitutionInvestigator';
  if (text === 'leadinstitutioninvestigator' || text === 'lead-institution-investigator' || text === '주관책임자' || text === '주관연구책임자') return 'leadInstitutionInvestigator';
  if (text === 'coprincipalinvestigator' || text === 'co-principal-investigator' || text === '공동연구책임자') return 'coPrincipalInvestigator';
  return 'leadInstitutionInvestigator';
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
    name: item.name || item.nameEn || item.nameKr || '',
    nameKr: item.nameKr || '',
    nameEn: item.nameEn || '',
    group,
    track,
    course,
    email: item.email || '',
    bio: item.bio || '',
    education: item.education || '',
    experience: item.experience || '',
    researchInterest: item.researchInterest || '',
    bachelorsSchool: item.bachelorsSchool || '',
    bachelorsMajor: item.bachelorsMajor || '',
    mastersSchool: item.mastersSchool || '',
    mastersMajor: item.mastersMajor || '',
    doctoralSchool: item.doctoralSchool || '',
    doctoralMajor: item.doctoralMajor || '',
    coursesInfo: item.coursesInfo || item.courseInfo || '',
    relatedProjects: item.relatedProjects || '',
    authorshipNote: item.authorshipNote || '',
    publicationLinks: Array.isArray(item.publicationLinks) ? item.publicationLinks : (preserveMissing ? undefined : []),
    courseSchedule: Array.isArray(item.courseSchedule) ? item.courseSchedule.map((entry) => ({
      day: entry?.day || '',
      time: entry?.time || '',
      courseName: entry?.courseName || '',
      credits: entry?.credits || '',
      description: entry?.description || ''
    })) : (preserveMissing ? undefined : []),
    currentPosition: item.currentPosition || item.employment || '',
    status,
    graduationYear: item.graduationYear || '',
    startYear: item.startYear || item.admissionYear || '',
    enrolledGroup: item.enrolledGroup || group || '',
    enrolledCourse: item.enrolledCourse || course || '',
    enrolledTrack: item.enrolledTrack || track || '',
    sortOrder,
    photoUrl: item.photoUrl || item.image || '',
    photoPath: item.photoPath || '',
    photoRemoved: Boolean(item.photoRemoved),
    restoreGroup: item.restoreGroup || '',
    restoreCourse: item.restoreCourse || '',
    restoreTrack: item.restoreTrack || '',
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
      : (preserveMissing ? undefined : []);
  const period = normalizeProjectPeriod(item.period || '');
  const year = item.year || extractYear(period);
  const titleKr = item.titleKr || item.title || '';
  const titleEn = item.titleEn || item.title || '';
  const descriptionKr = item.descriptionKr || item.description || item.desc || '';
  const descriptionEn = item.descriptionEn || item.description || item.desc || '';
  const tagsKr = Array.isArray(item.tagsKr)
    ? item.tagsKr
    : hasExplicitKey(item, 'tagsKr')
      ? String(item.tagsKr || '').split(',').map((tag) => tag.trim()).filter(Boolean)
      : (preserveMissing ? undefined : []);
  const tagsEn = Array.isArray(item.tagsEn)
    ? item.tagsEn
    : hasExplicitKey(item, 'tagsEn')
      ? String(item.tagsEn || '').split(',').map((tag) => tag.trim()).filter(Boolean)
      : (preserveMissing ? undefined : []);
  const leadRole = hasExplicitKey(item, 'leadRole') ? mapProjectLeadRole(item.leadRole) : (preserveMissing ? undefined : 'leadInstitutionInvestigator');
  const figureAspect = hasExplicitKey(item, 'figureAspect') ? (item.figureAspect || '16:9') : (preserveMissing ? undefined : '16:9');
  return {
    id: item.id || (!preserveMissing ? slugify(titleKr || titleEn || item.title || crypto.randomUUID()) : undefined),
    title: item.title || titleKr || titleEn || '',
    titleKr,
    titleEn,
    description: item.description || item.desc || descriptionKr || descriptionEn || '',
    descriptionKr,
    descriptionEn,
    status: preserveMissing ? explicitStatus : (explicitStatus || 'ongoing'),
    period,
    year,
    leadRole,
    principalInvestigator: item.principalInvestigator || item.pi || '',
    figureUrl: item.figureUrl || item.imageUrl || '',
    figurePath: item.figurePath || '',
    figureAspect,
    tags,
    tagsKr,
    tagsEn,
    sortOrder,
    createdAt: item.createdAt || undefined,
    updatedAt: item.updatedAt || undefined
  };
}

export function normalizePublication(item = {}, options = {}) {
  const preserveMissing = Boolean(options.preserveMissing);
  const sortOrder = hasExplicitKey(item, 'sortOrder') ? Number(item.sortOrder) : (preserveMissing ? undefined : 999);
  const inferredIndexing = inferPublicationIndexing(item.journal || '');
  const year = derivePublicationYear(item);
  const month = derivePublicationMonth(item);
  const doi = normalizeDoiValue(item.doi || '');
  return {
    id: item.id || (!preserveMissing ? slugify(`${year || ''}-${item.title || crypto.randomUUID()}`) : undefined),
    title: item.title || '',
    authors: item.authors || '',
    journal: item.journal || '',
    year,
    month,
    doi,
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
  const explicitPhotoRemoval = remoteRaw.photoRemoved === true || (Object.prototype.hasOwnProperty.call(remoteRaw, 'photoUrl') && remoteRaw.photoUrl === '');
  if (explicitPhotoRemoval) {
    merged.photoUrl = '';
    merged.photoPath = '';
  } else if (!hasMeaningfulValue(remoteRaw.photoUrl) && !hasMeaningfulValue(remoteRaw.image)) {
    merged.photoUrl = previous.photoUrl;
  }
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
  const memberName = (item = {}) => String(item.nameKr || item.nameEn || item.name || '').trim();
  const memberYearValue = (item = {}) => {
    const year = yearValue(item.startYear);
    if (!year) return 0;
    const current = new Date().getFullYear();
    const diff = current - year + 1;
    return diff > 0 ? diff : 0;
  };

  return [...items]
    .map((item) => normalizeMember(item))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'enrolled' ? -1 : 1;
      if (a.status === 'alumni') {
        const byYear = yearValue(b.graduationYear) - yearValue(a.graduationYear);
        if (byYear) return byYear;
        return memberName(a).localeCompare(memberName(b), 'ko');
      }
      const byGroup = (GROUP_ORDER[a.group] ?? 99) - (GROUP_ORDER[b.group] ?? 99);
      if (byGroup) return byGroup;
      const byCourse = (COURSE_ORDER[a.course] ?? 99) - (COURSE_ORDER[b.course] ?? 99);
      if (byCourse) return byCourse;
      const byTrack = (TRACK_ORDER[a.track] ?? 99) - (TRACK_ORDER[b.track] ?? 99);
      if (byTrack) return byTrack;
      const byMemberYear = memberYearValue(b) - memberYearValue(a);
      if (byMemberYear) return byMemberYear;
      const byName = memberName(a).localeCompare(memberName(b), 'ko');
      if (byName) return byName;
      const bySort = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (bySort) return bySort;
      const byStart = yearValue(a.startYear) - yearValue(b.startYear);
      if (byStart) return byStart;
      return String(a.id || '').localeCompare(String(b.id || ''), 'en');
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
  const doi = normalizeDoiValue(item.doi || '');
  if (!doi) return '';
  return /^https?:/i.test(doi) ? doi : `https://doi.org/${doi}`;
}

export function memberStatusLabel(member, lang = 'kr') {
  if (lang === 'en') return member.status === 'alumni' ? 'Alumni' : 'Enrolled';
  return member.status === 'alumni' ? '졸업' : '재학중';
}

export function memberGroupLabel(group, lang = 'kr') {
  const map = {
    pi: { kr: '지도교수', en: 'Advisor / Professor' },
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

export function memberYearLabel(member = {}, lang = 'kr') {
  const year = Number(String(member.startYear || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
  if (!year) return '';
  const current = new Date().getFullYear();
  const diff = current - year + 1;
  if (diff < 1) return '';
  return lang === 'en' ? `Year ${diff}` : `${diff}년차`;
}
