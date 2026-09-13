const lookupKey = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

export function resolveProjectInvestigator(project = {}, members = []) {
  const byId = members.find((member) => member.id && member.id === project.principalInvestigatorId);
  if (byId) return byId;
  const names = [project.principalInvestigator, project.principalInvestigatorKr, project.principalInvestigatorEn]
    .map(lookupKey).filter(Boolean);
  return members.find((member) => [member.id, member.nameKr, member.nameEn, member.name]
    .some((name) => names.includes(lookupKey(name)))) || null;
}

export function localizedInvestigatorName(project = {}, members = [], locale = 'kr') {
  const member = resolveProjectInvestigator(project, members);
  const primary = locale === 'en' ? 'En' : 'Kr';
  const secondary = locale === 'en' ? 'Kr' : 'En';
  return member?.[`name${primary}`] || project[`principalInvestigator${primary}`]
    || member?.name || project.principalInvestigator || member?.[`name${secondary}`]
    || project[`principalInvestigator${secondary}`] || '';
}
