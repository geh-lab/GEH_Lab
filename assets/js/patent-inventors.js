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
  const structured = ['inventorMemberIds', 'inventorMembers', 'externalInventorsKr', 'externalInventorsEn', 'inventorOrder']
    .some((key) => own(patent, key));

  if (structured) {
    const saved = new Map([...(Array.isArray(patent.inventorOrder) ? patent.inventorOrder : []),
      ...(Array.isArray(patent.inventorMembers) ? patent.inventorMembers : [])]
      .filter((item) => item && typeof item === 'object').map((item) => snapshot(item)).filter((item) => item.memberId).map((item) => [item.memberId, item]));
    // An explicit empty ID list records an intentional unlink, even if old names remain.
    const selectedIds = own(patent, 'inventorMemberIds')
      ? uniqueIds(patent.inventorMemberIds) : [...saved.keys()];
    const memberIds = uniqueIds([...(Array.isArray(patent.inventorOrder) ? patent.inventorOrder : [])
      .map((item) => item?.memberId).filter((id) => selectedIds.includes(text(id))), ...selectedIds]);
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
  let externalInventorsEn = remaining(patent.inventorsEn);
  const koreanParts = nameParts(patent.inventorsKr || patent.inventors, aliases);
  const englishParts = nameParts(patent.inventorsEn, aliases);
  // A complete old initials-only English credit is not an outside-inventor list.
  if (koreanParts.length && !externalInventorsKr && englishParts.length === koreanParts.length
    && englishParts.every((part) => !aliases.has(nameKey(part)) && /\b[A-Za-z]\./.test(part))) externalInventorsEn = '';
  return {
    memberIds,
    memberSnapshots: memberIds.map((id) => snapshot(byId.get(id), id)),
    externalInventorsKr,
    externalInventorsEn,
    legacy: true
  };
}

// Semicolons/newlines establish whole-name boundaries, including "Doe, Jane".
// When the two languages cannot be paired safely, keep the outside credit as a
// single movable group instead of guessing which English name belongs to whom.
function externalOrderEntries(kr, en, selectedAliases, knownOutside = []) {
  const boundaries = new Map(selectedAliases);
  for (const item of knownOutside) {
    for (const value of [item.nameKr, item.nameEn]) {
      if (nameKey(value)) boundaries.set(nameKey(value), true);
    }
  }
  const parts = (value) => {
    const explicit = /[;\r\n、·]/.test(value);
    const values = explicit ? text(value).split(/[;\r\n、·]+/).map(text).filter(Boolean)
      : nameParts(value, boundaries);
    const seen = new Set();
    return values.filter((part) => {
      const key = nameKey(part);
      const wholeName = explicit || /\s|\p{Script=Hangul}/u.test(part);
      if (selectedAliases.has(key) || (wholeName && seen.has(key))) return false;
      seen.add(key);
      return true;
    });
  };
  const korean = parts(kr);
  const english = parts(en);
  if (!korean.length && !english.length) return [];
  const ambiguous = (values, raw) => !/[;\r\n、·]/.test(raw)
    && values.length > 1 && values.some((value) => /^[A-Za-z'-]+$/.test(value));
  if ((korean.length && english.length && korean.length !== english.length)
    || ambiguous(korean, kr) || ambiguous(english, en)) {
    return [{ memberId: '', nameKr: korean.join(', '), nameEn: english.join(', ') }];
  }
  return Array.from({ length: Math.max(korean.length, english.length) }, (_, index) => ({
    memberId: '', nameKr: korean[index] || '', nameEn: english[index] || ''
  }));
}

const sameExternal = (a, b) => !!a && !!b && !a.memberId && !b.memberId
  && ((text(a.nameKr) && nameKey(a.nameKr) === nameKey(b.nameKr))
    || (text(a.nameEn) && nameKey(a.nameEn) === nameKey(b.nameEn)));

// Relate editable free-text names by their original input position, independently
// of their display position. This keeps a moved inventor in place while typing.
function externalChanges(before, after) {
  const matched = new Map();
  const taken = new Set();
  for (let index = 0; index < before.length; index += 1) {
    const next = after.findIndex((item, candidate) => !taken.has(candidate) && sameExternal(before[index], item));
    if (next >= 0) { matched.set(index, next); taken.add(next); }
  }
  // Equal list lengths and a remaining slot at the same index identify an
  // in-place name edit. With additions/removals, only exact names are retained.
  if (before.length === after.length) {
    for (let index = 0; index < before.length; index += 1) {
      if (!matched.has(index) && !taken.has(index)) { matched.set(index, index); taken.add(index); }
    }
  }
  return matched;
}

// Matching lab-member anchors in both full credits establish the boundaries of
// an outside credit ("Doe, Jane") without interpreting its internal commas.
function anchoredOutsideEntries(previous, aliases) {
  const split = (value) => {
    const ids = [];
    const groups = [[]];
    for (const part of nameParts(value, aliases)) {
      const matches = aliases.get(nameKey(part));
      if (matches?.size === 1) { ids.push([...matches][0]); groups.push([]); }
      else groups[groups.length - 1].push(part);
    }
    return { ids, groups };
  };
  const kr = split(previous.inventorsKr || previous.inventors);
  const en = split(previous.inventorsEn);
  if (!kr.ids.length || JSON.stringify(kr.ids) !== JSON.stringify(en.ids)
    || kr.groups.some((group, index) => Boolean(group.length) !== Boolean(en.groups[index].length))) return [];
  return kr.groups.flatMap((group, index) => group.length ? [{
    memberId: '', nameKr: group.join(', '), nameEn: en.groups[index].join(', ')
  }] : []);
}

function originalInventorOrder(previous, memberEntries, outside, aliases) {
  const entries = [...memberEntries, ...outside];
  const matches = new Map();
  for (const item of memberEntries) {
    for (const [alias, ids] of aliases) {
      if (ids.size === 1 && ids.has(item.memberId)) matches.set(alias, item);
    }
  }
  for (const item of outside) {
    for (const value of [item.nameKr, item.nameEn]) {
      for (const part of [value, ...nameParts(value, aliases)]) {
        const key = nameKey(part);
        if (key && !matches.has(key)) matches.set(key, item);
      }
    }
  }
  const kr = nameParts(previous.inventorsKr || previous.inventors, aliases);
  const en = nameParts(previous.inventorsEn, aliases);
  const linked = (parts) => new Set(parts.map((part) => matches.get(nameKey(part))?.memberId).filter(Boolean)).size;
  const source = linked(en) > linked(kr) ? en : kr.length ? kr : en;
  const ordered = [];
  for (const part of source) {
    const item = matches.get(nameKey(part));
    if (item && !ordered.includes(item)) ordered.push(item);
  }
  return [...ordered, ...entries.filter((item) => !ordered.includes(item))];
}

function composeOrderedInventors(order, language) {
  return order.map((item) => text(item[language]) || text(item.nameKr) || text(item.nameEn)).filter(Boolean).join(', ');
}

export function buildPatentInventorFields(input = {}, members = [], previous = {}) {
  const { byId } = memberIndex(members);
  const resolved = resolvePatentInventors(previous, members);
  const memberIds = own(input, 'memberIds') ? uniqueIds(input.memberIds) : resolved.memberIds;
  const saved = new Map(resolved.memberSnapshots.map((item) => [item.memberId, item]));
  const memberEntries = memberIds.map((id) => byId.has(id)
    ? snapshot(byId.get(id), id) : saved.get(id) || snapshot({}, id));
  const selectedAliases = aliasesForSnapshots([
    ...memberEntries, ...resolved.memberSnapshots.filter((item) => memberIds.includes(item.memberId))
  ], byId);
  const externalInventorsKr = own(input, 'externalInventorsKr') ? text(input.externalInventorsKr) : resolved.externalInventorsKr;
  const externalInventorsEn = own(input, 'externalInventorsEn') ? text(input.externalInventorsEn) : resolved.externalInventorsEn;
  const memberAliases = new Map();
  for (const item of [...memberEntries, ...resolved.memberSnapshots]) {
    for (const value of [item.nameKr, item.nameEn]) {
      const key = nameKey(value);
      if (!key) continue;
      if (!memberAliases.has(key)) memberAliases.set(key, new Set());
      memberAliases.get(key).add(item.memberId);
    }
  }
  const explicitOrder = Array.isArray(input.inventorOrder) ? input.inventorOrder
    : Array.isArray(previous.inventorOrder) ? previous.inventorOrder : null;
  const knownOutside = explicitOrder?.filter((item) => item && !item.memberId)
    || anchoredOutsideEntries(previous, memberAliases);
  const outside = externalOrderEntries(externalInventorsKr, externalInventorsEn, selectedAliases, knownOutside);
  const priorOutside = externalOrderEntries(resolved.externalInventorsKr, resolved.externalInventorsEn, selectedAliases, knownOutside);
  const changed = externalChanges(priorOutside, outside);
  const priorOrder = explicitOrder || originalInventorOrder(previous, resolved.memberSnapshots, priorOutside, memberAliases);
  const inventorOrder = [];
  const emittedMembers = new Set();
  const emittedOutside = new Set();
  for (const item of priorOrder) {
    if (!item || typeof item !== 'object') continue;
    const id = text(item.memberId);
    if (id) {
      const current = memberEntries.find((member) => member.memberId === id);
      if (current && !emittedMembers.has(id)) { inventorOrder.push(current); emittedMembers.add(id); }
    } else {
      const priorIndex = priorOutside.findIndex((candidate) => sameExternal(item, candidate));
      let index = priorIndex >= 0 ? changed.get(priorIndex) : undefined;
      if (index === undefined) index = outside.findIndex((candidate) => sameExternal(item, candidate));
      if (index >= 0 && !emittedOutside.has(index)) { inventorOrder.push(outside[index]); emittedOutside.add(index); }
    }
  }
  for (const item of memberEntries) {
    if (!emittedMembers.has(item.memberId)) inventorOrder.push(item);
  }
  outside.forEach((item, index) => { if (!emittedOutside.has(index)) inventorOrder.push(item); });
  const inventorMembers = inventorOrder.filter((item) => item.memberId);
  return {
    inventorMemberIds: inventorMembers.map((item) => item.memberId), inventorMembers,
    externalInventorsKr, externalInventorsEn, inventorOrder,
    inventorsKr: composeOrderedInventors(inventorOrder, 'nameKr'),
    inventorsEn: composeOrderedInventors(inventorOrder, 'nameEn')
  };
}

// Display linked names from the current roster without rewriting saved patent data.
// The full inventor fields provide the ordering; external bilingual fields remain
// the authority for names that were entered manually.
export function patentInventorDisplay(patent = {}, members = [], lang = 'kr') {
  const english = lang === 'en';
  if (Array.isArray(patent.inventorOrder)) {
    const fields = buildPatentInventorFields({}, members, patent);
    return english ? fields.inventorsEn : fields.inventorsKr;
  }
  const resolved = resolvePatentInventors(patent, members);
  const { byId, aliases: rosterAliases } = memberIndex(members);
  const saved = new Map(resolved.memberSnapshots.map((item) => [item.memberId, item]));
  const labels = new Map(resolved.memberIds.map((id) => {
    const member = byId.has(id) ? snapshot(byId.get(id), id) : saved.get(id) || {};
    return [id, text(english ? member.nameEn : member.nameKr) || text(member.nameKr) || text(member.nameEn)];
  }));
  const aliases = new Map();
  for (const id of resolved.memberIds) {
    const prior = saved.get(id) || {};
    const current = byId.get(id) || {};
    for (const value of [prior.nameKr, prior.nameEn, current.nameKr, current.nameEn, current.name]) {
      const key = nameKey(value);
      if (!key || (resolved.legacy && rosterAliases.get(key)?.size > 1)) continue;
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key).add(id);
    }
  }
  const memberIdFor = (part) => {
    const ids = aliases.get(nameKey(part));
    return ids?.size === 1 ? [...ids][0] : '';
  };
  const kr = text(patent.inventorsKr || patent.inventors);
  const en = text(patent.inventorsEn);
  const koreanParts = nameParts(kr, aliases);
  const englishParts = nameParts(en, aliases);
  const koreanIds = new Set(koreanParts.map(memberIdFor).filter(Boolean));
  // A complete old English credit may use initials that the roster does not
  // store. Keep that credit intact rather than guessing identities or adding
  // a second copy of every inventor. Explicit outside-name fields always win.
  if (en && !own(patent, 'externalInventorsKr') && !own(patent, 'externalInventorsEn')
    && !/\p{Script=Hangul}/u.test(en)
    && koreanIds.size === resolved.memberIds.length && koreanIds.size === koreanParts.length
    && englishParts.length === koreanParts.length
    && englishParts.every((part) => !memberIdFor(part) && /\b[A-Za-z]\./.test(part))) {
    return english ? en : koreanParts.map((part) => labels.get(memberIdFor(part)) || part).join(', ');
  }
  const external = english
    ? resolved.externalInventorsEn || resolved.externalInventorsKr
    : resolved.externalInventorsKr || resolved.externalInventorsEn;
  const externalParts = nameParts(external, aliases).filter((part) => !memberIdFor(part));
  let parts = english ? (en ? englishParts : koreanParts) : (kr ? koreanParts : englishParts);
  const alternate = english ? koreanParts : englishParts;
  const linkedCount = (values) => new Set(values.map(memberIdFor).filter(Boolean)).size;
  // Some old English fields contain only the outside inventors. Use the fuller
  // field to retain the interleaving of lab and outside inventors in that case.
  if (linkedCount(alternate) > linkedCount(parts)) parts = alternate;
  const outsideCount = parts.filter((part) => !memberIdFor(part)).length;
  const values = [];
  const emitted = new Set();
  let outsideIndex = 0;
  for (const part of parts) {
    const id = memberIdFor(part);
    if (id) {
      if (!emitted.has(id)) values.push(labels.get(id) || part);
      emitted.add(id);
    } else if (outsideCount === externalParts.length) {
      values.push(externalParts[outsideIndex++]);
    } else if (outsideIndex++ === 0) {
      values.push(...externalParts);
    }
  }
  for (const [id, label] of labels) {
    if (!emitted.has(id) && label) values.push(label);
  }
  if (!outsideCount) values.push(...externalParts);
  // A record with IDs but no available roster or snapshots can still display
  // its saved names. Explicitly unlinked, empty external fields stay empty.
  if (!values.some(Boolean) && resolved.memberIds.length) return english ? en || kr : kr || en;
  return values.filter(Boolean).join(', ');
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
