export const GROUP_ORDER = {
  'Principal Investigator': 1,
  'Postdoctoral Researcher': 2,
  'Graduate Students': 3,
  Alumni: 4
};

export const TRACK_ORDER = {
  Faculty: 1,
  Researcher: 2,
  'Full-time Students': 3,
  'Part-time Students': 4,
  Alumni: 5
};

export const COURSE_ORDER = {
  Professor: 1,
  Postdoc: 2,
  'Ph.D. Course': 3,
  'M.S. Course': 4
};

export function slugify(value = '') {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function escapeHTML(value = '') {
  return value
    .toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

export function getInitials(name = '') {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) return 'GEH';

  return words
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function resolveLink(item = {}) {
  if (item.url) return item.url;
  if (item.doi) return `https://doi.org/${item.doi}`;
  return '';
}

export function parseTags(value = '') {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeMember(item = {}) {
  return {
    id: item.id || slugify(`${item.name || 'member'}-${item.email || Math.random().toString(36).slice(2, 8)}`),
    name: item.name || '',
    group: item.group || 'Graduate Students',
    track: item.track || '',
    course: item.course || '',
    email: item.email || '',
    bio: item.bio || '',
    education: item.education || '',
    experience: item.experience || '',
    researchInterest: item.researchInterest || '',
    currentPosition: item.currentPosition || '',
    status: item.status || 'active',
    graduationYear: item.graduationYear || '',
    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 999,
    photoUrl: item.photoUrl || '',
    photoPath: item.photoPath || '',
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

export function normalizeProject(item = {}) {
  return {
    id: item.id || slugify(item.title || 'project'),
    title: item.title || '',
    description: item.description || '',
    status: item.status || 'ongoing',
    period: item.period || '',
    year: item.year || '',
    tags: Array.isArray(item.tags) ? item.tags : parseTags(item.tags || ''),
    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 999,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

export function normalizePublication(item = {}) {
  return {
    id: item.id || slugify(`${item.year || ''}-${item.title || 'publication'}`),
    title: item.title || '',
    authors: item.authors || '',
    journal: item.journal || '',
    year: item.year || '',
    doi: item.doi || '',
    url: item.url || '',
    abstract: item.abstract || '',
    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 999,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

function yearPriority(value) {
  if (!value) return 0;
  if (/^\d{4}$/.test(String(value).trim())) return Number(value);
  if (String(value).includes('Earlier')) return 1;
  return 2;
}

export function sortMembers(items = []) {
  return [...items]
    .map(normalizeMember)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      const groupCompare = (GROUP_ORDER[a.group] || 99) - (GROUP_ORDER[b.group] || 99);
      if (groupCompare !== 0) return groupCompare;
      const trackCompare = (TRACK_ORDER[a.track] || 99) - (TRACK_ORDER[b.track] || 99);
      if (trackCompare !== 0) return trackCompare;
      const courseCompare = (COURSE_ORDER[a.course] || 99) - (COURSE_ORDER[b.course] || 99);
      if (courseCompare !== 0) return courseCompare;
      if (a.status === 'alumni') {
        const yearCompare = yearPriority(b.graduationYear) - yearPriority(a.graduationYear);
        if (yearCompare !== 0) return yearCompare;
      }
      const sortCompare = (a.sortOrder || 999) - (b.sortOrder || 999);
      if (sortCompare !== 0) return sortCompare;
      return (a.name || '').localeCompare(b.name || '', 'en');
    });
}

export function sortProjects(items = []) {
  return [...items]
    .map(normalizeProject)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ongoing' ? -1 : 1;
      const yearCompare = yearPriority(b.year || b.period) - yearPriority(a.year || a.period);
      if (yearCompare !== 0) return yearCompare;
      const sortCompare = (a.sortOrder || 999) - (b.sortOrder || 999);
      if (sortCompare !== 0) return sortCompare;
      return (a.title || '').localeCompare(b.title || '', 'en');
    });
}

export function sortPublications(items = []) {
  return [...items]
    .map(normalizePublication)
    .sort((a, b) => {
      const yearCompare = yearPriority(b.year) - yearPriority(a.year);
      if (yearCompare !== 0) return yearCompare;
      const sortCompare = (a.sortOrder || 999) - (b.sortOrder || 999);
      if (sortCompare !== 0) return sortCompare;
      return (a.title || '').localeCompare(b.title || '', 'en');
    });
}

export function groupBy(items = [], keyGetter) {
  return items.reduce((accumulator, item) => {
    const key = keyGetter(item);
    if (!accumulator[key]) accumulator[key] = [];
    accumulator[key].push(item);
    return accumulator;
  }, {});
}

export function formatMemberMeta(member = {}) {
  return [member.group, member.track, member.course].filter(Boolean).join(' · ');
}

export function formatProjectMeta(project = {}) {
  return [project.status === 'ongoing' ? 'In progress' : 'Completed', project.period || project.year]
    .filter(Boolean)
    .join(' · ');
}

export function formatPublicationMeta(publication = {}) {
  return [publication.year, publication.journal].filter(Boolean).join(' · ');
}
