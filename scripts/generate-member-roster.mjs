import { memberSummaryMarkup } from '../assets/js/member-summary.js';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portraitMarkup } from '../assets/js/portraits.js';
import {
  escapeHTML,
  formatEnglishName,
  groupBy,
  isActiveItem,
  memberCourseLabel,
  memberTrackLabel,
  memberYearLabel,
  rootAsset,
  sortMembers
} from '../assets/js/utils.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = resolve(projectRoot, 'assets/data/profile-source.json');
const indexPath = resolve(projectRoot, 'assets/data/member-profile-index.json');
const sitemapPath = resolve(projectRoot, 'sitemap.xml');
const generatedImageDir = resolve(projectRoot, 'assets/images/generated-roster');
const siteUrl = 'https://geh-lab.vercel.app';

const pages = {
  kr: resolve(projectRoot, 'members.html'),
  en: resolve(projectRoot, 'en/members.html')
};

const copy = {
  kr: {
    current: '재학 구성원', alumni: '졸업생', pi: '지도교수', research: '연구교수 / 박사후연구원',
    graduate: '대학원생', undergrad: '학부연구생', education: '학력', experience: '경력', interest: '연구 관심 분야',
    contact: '이메일', currentPosition: '현재 소속', noMembers: '표시할 멤버가 없습니다.', items: '건',
    phdFull: '박사과정 · 풀타임', phdPart: '박사과정 · 파트타임', phdCompleted: '박사수료 후 연구생', msFull: '석사과정 · 풀타임', msPart: '석사과정 · 파트타임',
    professorBio: '충남대학교 교수', phd: '박사', ms: '석사', courseSchedule: '수업 시간표'
  },
  en: {
    current: 'Current members', alumni: 'Alumni', pi: 'Principal Investigator', research: 'Research Professors / Postdocs',
    graduate: 'Graduate Students', undergrad: 'Undergraduate Researchers', education: 'Education', experience: 'Experience', interest: 'Research interests',
    contact: 'Email', currentPosition: 'Current affiliation', noMembers: 'No members to display.', items: 'items',
    phdFull: 'Ph.D. · Full-time', phdPart: 'Ph.D. · Part-time', phdCompleted: 'Ph.D. Completion Research Students', msFull: 'M.S. · Full-time', msPart: 'M.S. · Part-time',
    professorBio: 'Professor, Chungnam National University', phd: 'Ph.D.', ms: 'M.S.', courseSchedule: 'Course schedule'
  }
};

const embeddedFields = [
  'id', 'documentId', 'name', 'nameKr', 'nameEn', 'group', 'track', 'course', 'email',
  'bio', 'bioKr', 'bioEn', 'education', 'educationKr', 'educationEn',
  'bachelorsSchool', 'bachelorsSchoolKr', 'bachelorsSchoolEn', 'bachelorsMajor', 'bachelorsMajorKr', 'bachelorsMajorEn',
  'mastersSchool', 'mastersSchoolKr', 'mastersSchoolEn', 'mastersMajor', 'mastersMajorKr', 'mastersMajorEn',
  'doctoralSchool', 'doctoralSchoolKr', 'doctoralSchoolEn', 'doctoralMajor', 'doctoralMajorKr', 'doctoralMajorEn',
  'experience', 'experienceKr', 'experienceEn', 'experienceEntries',
  'researchInterest', 'researchInterestKr', 'researchInterestEn',
  'currentPosition', 'currentPositionKr', 'currentPositionEn', 'status', 'graduationYear', 'startYear', 'startSemester',
  'enrolledGroup', 'enrolledCourse', 'enrolledTrack', 'sortOrder', 'photoUrl', 'photoPath', 'photoRemoved',
  'coursesInfo', 'courseSchedule', 'relatedProjects', 'projectLinks', 'publicationLinks', 'updatedAt', 'createdAt'
];

function replaceDash(value = '') {
  return String(value).replace(/[—–]/g, '-');
}

function firstFilled(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function safeJson(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
}

function memberIdentity(member = {}) {
  const rawName = String(member.name || '').trim();
  const englishName = String(member.nameEn || (/^[\x00-\x7F]+$/.test(rawName) ? rawName : ''))
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (englishName) return `name-en:${englishName}`;
  const email = String(member.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const names = [member.nameKr, member.nameEn, member.name]
    .map((value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ''))
    .filter(Boolean);
  return `name:${[...new Set(names)].sort().join('|')}`;
}

function completenessScore(member = {}) {
  const fields = Object.values(member).reduce((score, value) => {
    if (Array.isArray(value)) return score + value.length * 2;
    if (value === false || value === 0) return score + 1;
    return score + (value !== undefined && value !== null && String(value).trim() ? 1 : 0);
  }, 0);
  const coherent = member.group === 'alumni' ? member.status === 'alumni' : member.status !== 'alumni';
  return fields + (coherent ? 100 : 0) + (member.nameKr && member.nameEn ? 10 : 0);
}

function dedupe(items = []) {
  const selected = new Map();
  items.forEach((member) => {
    const key = memberIdentity(member);
    const current = selected.get(key);
    if (!current || completenessScore(member) > completenessScore(current)) selected.set(key, member);
  });
  return [...selected.values()];
}

function displayName(member, lang) {
  if (lang === 'en') return firstFilled(formatEnglishName(member.nameEn), formatEnglishName(member.name), member.nameKr);
  return firstFilled(member.nameKr, formatEnglishName(member.name), formatEnglishName(member.nameEn));
}

function localized(member, key, lang) {
  return replaceDash(lang === 'en'
    ? firstFilled(member[`${key}En`], member[key], member[`${key}Kr`])
    : firstFilled(member[`${key}Kr`], member[key], member[`${key}En`]));
}

function educationValue(member, baseKey, lang) {
  const primary = lang === 'en' ? 'En' : 'Kr';
  const secondary = lang === 'en' ? 'Kr' : 'En';
  return replaceDash(firstFilled(member[`${baseKey}${primary}`], member[baseKey], member[`${baseKey}${secondary}`]));
}

function educationEntries(member, lang) {
  const labels = lang === 'en' ? { bs: 'B.S.', ms: 'M.S.', phd: 'Ph.D.' } : { bs: '학사', ms: '석사', phd: '박사' };
  const specs = [
    ['bs', educationValue(member, 'bachelorsSchool', lang), educationValue(member, 'bachelorsMajor', lang)],
    ['ms', educationValue(member, 'mastersSchool', lang), educationValue(member, 'mastersMajor', lang)],
    ['phd', educationValue(member, 'doctoralSchool', lang), educationValue(member, 'doctoralMajor', lang)]
  ];
  const entries = specs
    .filter(([, school, major]) => school || major)
    .map(([degree, school, major]) => ({ degree: labels[degree], school, major }));
  if (entries.length) return entries;

  const fallback = [];
  localized(member, 'education', lang).split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const degreeMatch = line.match(/^(학사|석사|박사|B\.?S\.?|M\.?S\.?|Ph\.?D\.?)\s*(?:[·•|]\s*)?(.*)$/i);
    if (degreeMatch) {
      const details = String(degreeMatch[2] || '').split(/\s+[·•|]\s+/).map((part) => part.trim()).filter(Boolean);
      fallback.push({ degree: degreeMatch[1], school: details.shift() || '', major: details.join(' | ') });
      return;
    }
    const details = line.split(/\s+[·•|]\s+/).map((part) => part.trim()).filter(Boolean);
    if (fallback.length && !fallback[fallback.length - 1].major && details.length === 1) {
      fallback[fallback.length - 1].major = details[0];
      return;
    }
    fallback.push({ degree: '', school: details.shift() || '', major: details.join(' | ') });
  });
  return fallback;
}

function educationMarkup(member, lang, variant = 'compact') {
  const entries = educationEntries(member, lang);
  if (!entries.length) return '';
  return `<div class="member-education-lines member-education-lines--${escapeHTML(variant)}" role="list">${entries.map((entry) => `<div class="member-education-item${entry.degree ? '' : ' member-education-item--plain'}" role="listitem">${entry.degree ? `<span class="member-education-degree">${escapeHTML(entry.degree)}</span>` : ''}<span class="member-education-copy">${entry.school ? `<strong>${escapeHTML(entry.school)}</strong>` : ''}${entry.major ? `<small>${escapeHTML(entry.major)}</small>` : ''}</span></div>`).join('')}</div>`;
}

function experienceEntries(member, lang) {
  if (Array.isArray(member.experienceEntries) && member.experienceEntries.length) {
    return member.experienceEntries.map((entry) => ({
      period: replaceDash(entry.period || ''),
      detail: replaceDash(lang === 'en' ? firstFilled(entry.detailEn, entry.detail, entry.detailKr) : firstFilled(entry.detailKr, entry.detail, entry.detailEn))
    })).filter((entry) => entry.period || entry.detail);
  }
  return localized(member, 'experience', lang).split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const pipeMatch = line.match(/^([^|]+)\|\s*(.+)$/);
    return pipeMatch ? { period: pipeMatch[1].trim(), detail: pipeMatch[2].trim() } : { period: '', detail: line };
  });
}

function experienceMarkup(member, lang, variant = 'panel') {
  const entries = experienceEntries(member, lang).map((entry) => {
    const parts = String(entry.detail || '').split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
    return { period: entry.period, role: parts.shift() || '', organization: parts.join(' | ') };
  }).filter((entry) => entry.period || entry.role || entry.organization);
  if (!entries.length) return '';
  return `<div class="member-experience-lines member-experience-lines--${escapeHTML(variant)}" role="list">${entries.map((entry) => `<div class="member-experience-item${entry.period ? '' : ' member-experience-item--plain'}" role="listitem">${entry.period ? `<span class="member-experience-period">${escapeHTML(entry.period)}</span>` : ''}<span class="member-experience-copy">${entry.role ? `<strong>${escapeHTML(entry.role)}</strong>` : ''}${entry.organization ? `<small>${escapeHTML(entry.organization)}</small>` : ''}</span></div>`).join('')}</div>`;
}

function memberEmailLink(email = '', lang = 'kr', extraClass = '') {
  if (!email) return '';
  const label = lang === 'en' ? 'Send email' : '이메일 보내기';
  return `<a class="member-email${extraClass ? ` ${escapeHTML(extraClass)}` : ''}" href="mailto:${escapeHTML(email)}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"><i class="ph ph-envelope-simple" aria-hidden="true"></i></a>`;
}

function alumniCourseLabel(member, lang) {
  if (!(member.status === 'alumni' || member.group === 'alumni')) return '';
  const base = memberCourseLabel(member.course === 'phdCompleted' ? 'phd' : member.course, lang);
  if (!['phd', 'phdCompleted', 'ms'].includes(member.course) || !base) return '';
  return lang === 'en' ? `${base} alumni` : `${base} 졸업`;
}

function memberMetaChips(member, lang) {
  const chips = [];
  if (member.group === 'graduateStudent') {
    if (member.course) chips.push({ text: memberCourseLabel(member.course, lang) });
    if (member.course !== 'phdCompleted' && member.track && member.track !== 'none') chips.push({ text: memberTrackLabel(member.track, lang) });
  }
  if (member.group === 'studentResearcher') chips.push({ text: memberCourseLabel('undergrad', lang) });
  const years = memberYearLabel(member, lang);
  if (years) chips.push({ text: years, academic: true });
  return chips.map((chip) => `<span class="member-chip member-chip--soft${chip.academic ? ' member-chip--academic' : ''}">${escapeHTML(chip.text)}</span>`).join('');
}

function memberImage(member, lang, root, size) {
  const name = displayName(member, lang);
  return portraitMarkup({ source: member.photoUrl || member.photoPath || '', name, initialsName: displayName(member, 'en') || name, root, size, eager: member.group === 'pi' });
}

function memberPreview(member, lang, root, alumni = false) {
  const name = displayName(member, lang);
  const interest = !alumni && member.group === 'researchProfessor' ? localized(member, 'researchInterest', lang) : '';
  const chips = alumni
    ? [member.graduationYear, alumniCourseLabel(member, lang)].filter(Boolean).map(text => `<span class="member-chip">${escapeHTML(text)}</span>`).join('')
    : memberMetaChips(member, lang);
  const position = alumni ? localized(member, 'currentPosition', lang) : '';
  return `<article class="member-card${alumni ? ' member-card--alumni' : ''} reveal" data-member-id="${escapeHTML(member.id)}">
    <div class="profile-avatar"><button type="button" class="member-thumb" data-member-id="${escapeHTML(member.id)}" aria-label="${escapeHTML(name)} ${lang === 'en' ? 'details' : '상세 보기'}">${memberImage(member, lang, root, 128)}</button></div>
    <div class="member-preview-identity"><h3>${escapeHTML(name)}</h3>${chips ? `<div class="member-chip-row">${chips}</div>` : ''}${position ? `<p class="muted">${escapeHTML(position)}</p>` : ''}</div>
    ${interest ? `<div class="member-card-interest"><h4>${escapeHTML(copy[lang].interest)}</h4><p>${escapeHTML(interest)}</p></div>` : ''}
  </article>`;
}
function memberCard(member, lang, root) { return memberPreview(member, lang, root); }
function alumniCard(member, lang, root) { return memberPreview(member, lang, root, true); }

function scheduleMarkup(member, lang) {
  const rows = (Array.isArray(member.courseSchedule) ? member.courseSchedule : []).filter((entry) => ['time', 'courseName', 'credits', 'description'].some((key) => String(entry?.[key] || '').trim()));
  if (!rows.length) return '';
  const labels = lang === 'en' ? ['Day', 'Time', 'Course', 'Credits', 'Description'] : ['요일', '시간', '강의명', '학점', '강의 내용'];
  const dayMap = lang === 'en' ? { 월: 'Mon', 화: 'Tue', 수: 'Wed', 목: 'Thu', 금: 'Fri' } : {};
  return `<div class="schedule-table-wrap"><table class="schedule-table"><thead><tr>${labels.map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map((entry) => `<tr><td>${escapeHTML(dayMap[entry.day] || entry.day || '')}</td><td>${escapeHTML(entry.time || '')}</td><td>${escapeHTML(entry.courseName || '')}</td><td>${escapeHTML(entry.credits || '')}</td><td>${escapeHTML(entry.description || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

function piMarkup(pi, lang, root) {
  if (!pi) return `<div class="empty-state">${escapeHTML(copy[lang].noMembers)}</div>`;
  const interest = localized(pi, 'researchInterest', lang);
  return `<div class="pi-card-layout">
    <div class="profile-avatar profile-avatar--pi"><button type="button" class="pi-photo" data-member-id="${escapeHTML(pi.id)}" aria-label="${escapeHTML(displayName(pi, lang))} ${lang === 'en' ? 'details' : '상세 보기'}">${memberImage(pi, lang, root, 192)}</button></div>
    <div class="pi-card-main"><div class="pi-card-head"><span class="eyebrow">${escapeHTML(copy[lang].pi)}</span><div class="pi-name-row"><h2>${escapeHTML(displayName(pi, lang))}</h2>${memberEmailLink(pi.email, lang, 'pi-card-email')}</div><p class="pi-title">${escapeHTML(localized(pi, 'bio', lang) || copy[lang].professorBio)}</p></div>
    </div>
    ${interest ? `<div class="pi-card-focus"><h3>${escapeHTML(copy[lang].interest)}</h3><p class="pi-research-summary">${escapeHTML(interest)}</p></div>` : ''}
  </div>`;
}

function accordionMarkup(title, items, content, open, id) {
  const triggerId = `prerender-accordion-trigger-${id}`;
  const panelId = `prerender-accordion-panel-${id}`;
  return `<article class="accordion${open ? ' is-open' : ''}"><button class="accordion-trigger" id="${triggerId}" type="button" aria-expanded="${open}" aria-controls="${panelId}"><span class="accordion-copy"><span>${escapeHTML(title)}</span><span class="accordion-meta">${items.length} ${escapeHTML(content.itemsLabel)}</span></span><span class="accordion-icon" aria-hidden="true"></span></button><div class="accordion-panel" id="${panelId}" role="region" aria-labelledby="${triggerId}" aria-hidden="${!open}"${open ? '' : ' inert'}><div class="accordion-panel__inner">${content.html}</div></div></article>`;
}

function rosterSections(members, lang) {
  const root = lang === 'en' ? '..' : '.';
  const current = members.filter((member) => member.status !== 'alumni' && ['pi', 'researchProfessor', 'graduateStudent', 'studentResearcher'].includes(member.group));
  const piMembers = current.filter((member) => member.group === 'pi');
  const researchers = current.filter((member) => member.group === 'researchProfessor');
  const graduates = current.filter((member) => member.group === 'graduateStudent');
  const undergrads = current.filter((member) => member.group === 'studentResearcher');
  const alumni = members.filter((member) => member.status === 'alumni' || member.group === 'alumni');
  const stats = memberSummaryMarkup(members, lang);

  let accordionId = 0;
  const grid = (items, className = '') => items.length ? `<div class="member-grid${className ? ` ${className}` : ''}" data-count="${items.length}">${items.map((member) => memberCard(member, lang, root)).join('')}</div>` : `<div class="empty-state">${escapeHTML(copy[lang].noMembers)}</div>`;
  const graduateGroups = [
    [copy[lang].phdFull, graduates.filter((member) => member.course === 'phd' && member.track === 'fullTime')],
    [copy[lang].phdPart, graduates.filter((member) => member.course === 'phd' && member.track === 'partTime')],
    [copy[lang].phdCompleted, graduates.filter((member) => member.course === 'phdCompleted')],
    [copy[lang].msFull, graduates.filter((member) => member.course === 'ms' && member.track === 'fullTime')],
    [copy[lang].msPart, graduates.filter((member) => member.course === 'ms' && member.track === 'partTime')]
  ];
  const graduate = graduateGroups.map(([title, items], index) => accordionMarkup(title, items, { html: grid(items), itemsLabel: copy[lang].items }, index === 0, ++accordionId)).join('');
  const undergrad = undergrads.length ? accordionMarkup(copy[lang].undergrad, undergrads, { html: grid(undergrads, 'member-grid--wide'), itemsLabel: copy[lang].items }, true, ++accordionId) : '';
  const alumniGroups = Object.entries(groupBy(alumni, (member) => member.graduationYear || (lang === 'en' ? 'Unspecified' : '미정'))).sort((a, b) => Number(b[0]) - Number(a[0]));
  const alumniHtml = alumniGroups.map(([year, items], index) => accordionMarkup(year, items, { html: `<div class="member-grid member-grid--alumni" data-count="${items.length}">${items.map((member) => alumniCard(member, lang, root)).join('')}</div>`, itemsLabel: copy[lang].items }, index === 0, ++accordionId)).join('');
  return {
    stats,
    pi: piMarkup(piMembers[0], lang, root),
    research: researchers.length ? grid(researchers, 'member-grid--wide') : `<div class="empty-state">${escapeHTML(copy[lang].noMembers)}</div>`,
    graduate,
    undergrad,
    alumni: alumniHtml,
    current,
    alumniMembers: alumni
  };
}

function roleLabel(member, lang) {
  const labels = {
    pi: { kr: '지도교수', en: 'Principal Investigator' },
    researchProfessor: { kr: '연구교수 / 박사후연구원', en: 'Research Professor / Postdoc' },
    graduateStudent: { kr: '대학원생', en: 'Graduate Student' },
    studentResearcher: { kr: '학부연구생', en: 'Undergraduate Researcher' },
    alumni: { kr: '졸업생', en: 'Alumni' }
  };
  return labels[member.group]?.[lang] || (lang === 'en' ? 'Lab Member' : '연구실 멤버');
}

function personItem(member, lang, position, canonical) {
  const id = encodeURIComponent(String(member.id || member.documentId || member.email || displayName(member, lang)));
  const person = {
    '@type': 'Person', '@id': `${canonical}#member-${id}`, name: displayName(member, lang), url: canonical,
    jobTitle: roleLabel(member, lang), affiliation: { '@type': 'CollegeOrUniversity', name: lang === 'en' ? 'Chungnam National University' : '충남대학교', url: 'https://plus.cnu.ac.kr/' },
    memberOf: { '@id': `${siteUrl}/#organization` }
  };
  const alternate = displayName(member, lang === 'en' ? 'kr' : 'en');
  if (alternate && alternate !== person.name) person.alternateName = alternate;
  if (member.email) person.email = member.email;
  if (member.photoUrl) person.image = /^https?:/i.test(member.photoUrl) ? member.photoUrl : `${siteUrl}/${member.photoUrl.replace(/^\/+/, '')}`;
  const interest = localized(member, 'researchInterest', lang);
  if (interest) person.knowsAbout = interest.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  return { '@type': 'ListItem', position, item: person };
}

function structuredData(sections, lang) {
  const canonical = lang === 'en' ? `${siteUrl}/en/members.html` : `${siteUrl}/members.html`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: lang === 'en' ? 'Members | Greenhouse & Environmental Horticulture Lab' : '멤버 | 충남대학교 시설환경원예학연구실', inLanguage: lang === 'en' ? 'en' : 'ko', isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` } },
      { '@type': 'Organization', '@id': `${siteUrl}/#organization`, name: '충남대학교 시설환경원예학연구실', alternateName: ['GEH Lab', 'Greenhouse & Environmental Horticulture Lab', 'CNU GEH Lab'], url: `${siteUrl}/`, logo: `${siteUrl}/assets/images/logos/geh-logo.png`, parentOrganization: { '@type': 'CollegeOrUniversity', name: '충남대학교', alternateName: 'Chungnam National University' } },
      { '@type': 'ItemList', '@id': `${canonical}#current-members`, name: lang === 'en' ? 'Current GEH Lab members' : 'GEH Lab 현재 구성원', numberOfItems: sections.current.length, itemListElement: sections.current.map((member, index) => personItem(member, lang, index + 1, canonical)) },
      { '@type': 'ItemList', '@id': `${canonical}#alumni`, name: lang === 'en' ? 'GEH Lab alumni' : 'GEH Lab 졸업생', numberOfItems: sections.alumniMembers.length, itemListElement: sections.alumniMembers.map((member, index) => personItem(member, lang, index + 1, canonical)) }
    ]
  };
}

function replaceMarker(html, marker, content) {
  const start = `<!-- MEMBER_ROSTER_${marker}_START -->`;
  const end = `<!-- MEMBER_ROSTER_${marker}_END -->`;
  if (!html.includes(start) || !html.includes(end)) throw new Error(`멤버 명단 마커가 없습니다: ${marker}`);
  return html.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${content}\n${end}`);
}

// The loading shell belongs to the generated roster too. Repair older page
// templates on every build so a partial HTML upload cannot restore the flash.
export function ensureMemberLoadingMarkup(html, lang) {
  const configPattern = /\s*<script\b[^>]*\bsrc=["'][^"']*firebase-config\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/g;
  const configScripts = html.match(configPattern) || [];
  if (configScripts.length !== 1) throw new Error(`${lang}: expected one Firebase configuration script`);
  const configScript = configScripts[0].trim();
  html = html.replace(configPattern, '')
    .replace(/\s*<!-- Hide the build-time roster before the first paint; no-JS keeps the static roster\. -->/g, '')
    .replace(/\s*<script\b[^>]*>([\s\S]*?)<\/script>/g, (script, body) => body.includes('window.GEH_BOOT_TIMEOUT=') ? '' : script)
    .replace(/\s*<style id="member-roster-boot-style">[\s\S]*?<\/style>/g, '')
    .replace(/\s*<div class="member-roster-status" role="status">[\s\S]*?<\/div>/g, '');
  const charset = /<meta charset="UTF-8">/;
  const meta = /\s*<div class="page-hero-meta">/;
  if (!charset.test(html) || !meta.test(html)) throw new Error(`${lang}: member page loading anchors missing`);
  const boot = `
  <!-- Hide the build-time roster before the first paint; no-JS keeps the static roster. -->
  <script>document.documentElement.classList.add('js','member-roster-pending');window.GEH_BOOT_TIMEOUT=window.setTimeout(function(){document.documentElement.classList.add('js-fallback')},3000);</script>
  <style id="member-roster-boot-style">
    .member-roster-status, .member-roster-status__error { display: none; }
    .member-roster-pending #page-stat-grid, .member-roster-pending #page-updated,
    .member-roster-pending main > .page-section { visibility: hidden !important; }
    .member-roster-pending .member-roster-status { display: block; }
    .member-roster-pending.js-fallback .member-roster-status__loading { display: none; }
    .member-roster-pending.js-fallback .member-roster-status__error { display: inline; }
  </style>
  ${configScript}`;
  const loading = lang === 'en' ? 'Loading member information…' : '멤버 정보를 불러오는 중입니다…';
  const error = lang === 'en' ? 'The page is taking longer to load.' : '페이지를 불러오는 데 시간이 걸리고 있습니다.';
  const reload = lang === 'en' ? 'Reload' : '새로고침';
  const status = `<div class="member-roster-status" role="status"><span class="member-roster-status__loading">${loading}</span><span class="member-roster-status__error">${error} <a href="members.html">${reload}</a></span></div>`;
  return html.replace(charset, match => match + boot).replace(meta, match => `\n    ${status}\n    ${match.trim()}`);
}

async function materializePhoto(member) {
  const source = String(member.photoUrl || member.photoPath || '');
  const match = source.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/s);
  if (!match) return rootAsset(source, '.');
  const extension = match[1].toLowerCase().replace('jpeg', 'jpg');
  const safeId = String(member.id || member.documentId || memberIdentity(member)).replace(/[^a-z0-9가-힣_-]+/gi, '-');
  const relative = `assets/images/generated-roster/${safeId}.${extension}`;
  await writeFile(resolve(projectRoot, relative), Buffer.from(match[2], 'base64'));
  return relative;
}

function compactMember(member) {
  return Object.fromEntries(embeddedFields.filter((key) => member[key] !== undefined).map((key) => [key, member[key]]));
}

function buildSitemap(lastmod) {
  const urls = [
    '/', '/members.html', '/projects.html', '/publications.html', '/patents.html', '/news.html', '/contact.html',
    '/en/', '/en/members.html', '/en/projects.html', '/en/publications.html', '/en/patents.html', '/en/news.html', '/en/contact.html'
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>${siteUrl}${path}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const selected = dedupe(sortMembers((snapshot.members || []).filter(isActiveItem)));
  await rm(generatedImageDir, { recursive: true, force: true });
  await mkdir(generatedImageDir, { recursive: true });
  const members = [];
  for (const member of selected) members.push({ ...member, photoUrl: await materializePhoto(member), photoPath: '' });

  for (const lang of ['kr', 'en']) {
    const sections = rosterSections(members, lang);
    let html = ensureMemberLoadingMarkup(await readFile(pages[lang], 'utf8'), lang);
    html = replaceMarker(html, 'STRUCTURED_DATA', `<script id="member-roster-structured-data" type="application/ld+json">${safeJson(structuredData(sections, lang))}</script>`);
    html = replaceMarker(html, 'DATA', `<script id="member-roster-data" type="application/json">${safeJson(members.map(compactMember))}</script>`);
    html = replaceMarker(html, 'STATS', sections.stats);
    html = replaceMarker(html, 'PI', sections.pi);
    html = replaceMarker(html, 'RESEARCH', sections.research);
    html = replaceMarker(html, 'GRADUATE', sections.graduate);
    html = replaceMarker(html, 'UNDERGRAD', sections.undergrad);
    html = replaceMarker(html, 'ALUMNI', sections.alumni);
    await writeFile(pages[lang], html, 'utf8');
  }

  const generatedAt = snapshot.generatedAt || new Date().toISOString();
  const current = members.filter((member) => member.status !== 'alumni' && ['pi', 'researchProfessor', 'graduateStudent', 'studentResearcher'].includes(member.group));
  const alumni = members.filter((member) => member.status === 'alumni' || member.group === 'alumni');
  await Promise.all([
    rm(resolve(projectRoot, 'members'), { recursive: true, force: true }),
    rm(resolve(projectRoot, 'en/members'), { recursive: true, force: true }),
    rm(resolve(projectRoot, 'assets/images/generated-profiles'), { recursive: true, force: true }),
    writeFile(indexPath, `${JSON.stringify({ generatedAt, source: snapshot.source, canonicalPages: { ko: '/members.html', en: '/en/members.html' }, memberCount: members.length, currentCount: current.length, alumniCount: alumni.length, members: members.map((member) => ({ id: member.id, nameKr: member.nameKr || member.name || '', nameEn: member.nameEn || member.name || '', group: member.group, status: member.status })) }, null, 2)}\n`, 'utf8'),
    writeFile(sitemapPath, buildSitemap(String(generatedAt).slice(0, 10)), 'utf8')
  ]);
  console.log(`Member roster generated: ${members.length} people (${current.length} current, ${alumni.length} alumni) on the two canonical member pages.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
