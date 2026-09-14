import { sortPatents } from './patents.js';

const text = (value) => String(value ?? '').trim();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const nameKey = (value) => text(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
const uniqueIds = (values) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];

function snapshot(member = {}, id = '') {
  const fallback = text(member.name);
  return {
    memberId: text(id || member.memberId || member.id),
    nameKr: text(member.nameKr) || fallback || text(member.nameEn),
    nameEn: text(member.nameEn) || fallback || text(member.nameKr)
  };
}

function memberIndex(members = []) {
  const byId = new Map();
  const aliases = new Map();
  for (const member of members) {
    const id = text(member.id || member.memberId);
    if (!id || member.deleted === true) continue;
    byId.set(id, member);
    for (const name of [member.nameKr, member.nameEn, member.name]) {
      const key = nameKey(name);
      if (!key) continue;
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key).add(id);
    }
  }
  return { byId, aliases };
}

// Preserve a known comma-formatted name ("Park, Jongseok") as one inventor.
// Unknown text remains in the external field; a surname or substring never links.
function nameParts(value, aliases = new Map()) {
  const result = [];
  for (const group of text(value).split(/[;\r\n、·]+/)) {
    const parts = group.split(',').map(text).filter(Boolean);
    for (let index = 0; index < parts.length;) {
      let end = parts.length;
      while (end > index + 1 && !aliases.has(nameKey(parts.slice(index, end).join(', ')))) end -= 1;
      result.push(parts.slice(index, end).join(', '));
      index = end;
    }
  }
  return result;
}

function aliasesForSnapshots(snapshots, byId) {
  const aliases = new Map();
  for (const item of snapshots) {
    const member = byId.get(item.memberId) || {};
    for (const name of [item.nameKr, item.nameEn, member.nameKr, member.nameEn, member.name]) {
      if (nameKey(name)) aliases.set(nameKey(name), true);
    }
  }
  return aliases;
}

function unmatchedText(value, aliases) {
  return nameParts(value, aliases).filter((part) => !aliases.has(nameKey(part))).join(', ');
}

export function resolvePatentInventors(patent = {}, members = []) {
  const { byId, aliases } = memberIndex(members);
  const structured = ['inventorMemberIds', 'inventorMembers', 'externalInventorsKr', 'externalInventorsEn']
    .some((key) => own(patent, key));

  if (structured) {
    const saved = new Map((Array.isArray(patent.inventorMembers) ? patent.inventorMembers : [])
      .map((item) => snapshot(item)).filter((item) => item.memberId).map((item) => [item.memberId, item]));
    // An explicit empty ID list records an intentional unlink, even if old names remain.
    const memberIds = own(patent, 'inventorMemberIds')
      ? uniqueIds(patent.inventorMemberIds) : [...saved.keys()];
    const memberSnapshots = memberIds.map((id) => saved.get(id) || snapshot(byId.get(id), id));
    const selectedAliases = aliasesForSnapshots(memberSnapshots, byId);
    return {
      memberIds,
      memberSnapshots,
      externalInventorsKr: own(patent, 'externalInventorsKr') ? text(patent.externalInventorsKr)
        : unmatchedText(patent.inventorsKr || patent.inventors, selectedAliases),
      externalInventorsEn: own(patent, 'externalInventorsEn') ? text(patent.externalInventorsEn)
        : unmatchedText(patent.inventorsEn, selectedAliases),
      legacy: false
    };
  }

  const memberIds = [];
  const remaining = (value) => nameParts(value, aliases).filter((part) => {
    const ids = aliases.get(nameKey(part));
    if (ids?.size !== 1) return true;
    const id = [...ids][0];
    if (!memberIds.includes(id)) memberIds.push(id);
    return false;
  }).join(', ');
  const externalInventorsKr = remaining(patent.inventorsKr || patent.inventors);
  const externalInventorsEn = remaining(patent.inventorsEn);
  return {
    memberIds,
    memberSnapshots: memberIds.map((id) => snapshot(byId.get(id), id)),
    externalInventorsKr,
    externalInventorsEn,
    legacy: true
  };
}

function composeNames(snapshots, external, language, selectedAliases) {
  const values = snapshots.map((item) => text(item[language]) || text(item.nameKr) || text(item.nameEn)).filter(Boolean);
  const known = new Set(values.map(nameKey));
  for (const part of nameParts(external, selectedAliases)) {
    const key = nameKey(part);
    // A repeated Latin fragment may be a surname in "Doe, Jane, Doe, John".
    // Preserve it when the free text does not establish whole-name boundaries.
    const wholeName = /\s|\p{Script=Hangul}/u.test(part) || selectedAliases.has(key);
    if (selectedAliases.has(key) || (wholeName && known.has(key))) continue;
    values.push(part);
    known.add(key);
  }
  return values.join(', ');
}

export function buildPatentInventorFields(input = {}, members = [], previous = {}) {
  const { byId } = memberIndex(members);
  const resolved = resolvePatentInventors(previous, members);
  const memberIds = own(input, 'memberIds') ? uniqueIds(input.memberIds) : resolved.memberIds;
  const saved = new Map(resolved.memberSnapshots.map((item) => [item.memberId, item]));
  const inventorMembers = memberIds.map((id) => byId.has(id)
    ? snapshot(byId.get(id), id) : saved.get(id) || snapshot({}, id));
  // Include prior spellings when removing a selected member duplicated in free text.
  const selectedAliases = aliasesForSnapshots([
    ...inventorMembers, ...resolved.memberSnapshots.filter((item) => memberIds.includes(item.memberId))
  ], byId);
  const externalInventorsKr = own(input, 'externalInventorsKr') ? text(input.externalInventorsKr) : resolved.externalInventorsKr;
  const externalInventorsEn = own(input, 'externalInventorsEn') ? text(input.externalInventorsEn) : resolved.externalInventorsEn;
  return {
    inventorMemberIds: memberIds,
    inventorMembers,
    externalInventorsKr,
    externalInventorsEn,
    inventorsKr: composeNames(inventorMembers, externalInventorsKr, 'nameKr', selectedAliases),
    inventorsEn: composeNames(inventorMembers, externalInventorsEn || externalInventorsKr, 'nameEn', selectedAliases)
  };
}

export function patentsForMember(patents = [], member = {}, members = []) {
  const id = text(member.id || member.memberId);
  if (!id || member.deleted === true) return [];
  const roster = members.some((item) => text(item.id || item.memberId) === id) ? members : [...members, member];
  const seenIds = new Set();
  const seenApplications = new Set();
  const seenUnnamed = new Set();
  return sortPatents(patents.filter((patent) => patent.deleted !== true
    && resolvePatentInventors(patent, roster).memberIds.includes(id))).filter((patent) => {
    const application = text(patent.applicationNumber).replace(/[\s-]/g, '');
    const id = text(patent.id);
    const applicationKey = application ? `${nameKey(patent.countryKr || patent.countryEn)}:${application}` : '';
    const unnamedKey = !id && !application ? JSON.stringify([patent.titleKr, patent.titleEn, patent.applicationDate, patent.registrationNumber]) : '';
    if ((id && seenIds.has(id)) || (applicationKey && seenApplications.has(applicationKey)) || (unnamedKey && seenUnnamed.has(unnamedKey))) return false;
    if (id) seenIds.add(id);
    if (applicationKey) seenApplications.add(applicationKey);
    if (unnamedKey) seenUnnamed.add(unnamedKey);
    return true;
  });
}
