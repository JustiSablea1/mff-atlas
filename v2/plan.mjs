import { normalize } from './profile.mjs';

const gearType = value => normalize(value)
  .replace(/^.*\b(?:ctp|c t p)(?: of)?\s*/, '').replace(/^(?:mighty|brilliant) /, '');

export function buildPlan(profile, catalog, evidence, mode, goal) {
  const owned = new Map(profile.characters.filter(x => x.owned).map(x => [x.id, x]));
  const stock = profile.inventory.map(x => ({ ...x }));
  const equipped = new Set(profile.characters.filter(x => x.owned && x.ctp).map(x => gearType(x.ctp)));
  const rows = evidence.builds.flatMap(([id, kind, uniform, options, role, why, sources]) => {
    const current = owned.get(id);
    const hero = catalog.byId.get(id);
    if (!current || !hero || kind !== mode) return [];
    const worn = normalize(current.uniform) === normalize(uniform);
    const hasUniform = worn || normalize(hero.base) === normalize(uniform)
      || current.ownedUniforms.some(x => normalize(x) === normalize(uniform));
    const support = role === 'Поддержка';
    const ready = support ? ['II', 'III', 'IV', 'Awakened', 'Transcended'].includes(current.tier) : current.tier === 'IV';
    const preferredMode = goal === 'abx' && id === 'lunasnow' ? 20 : goal === 'wbl' && id === 'thor' ? 20 : 0;
    const compatible = options.some(option => gearType(current.ctp) === normalize(option));
    const baselineSupport = support && ['valkyrie', 'shuri'].includes(id) && ready;
    const priority = (hasUniform ? 45 : baselineSupport ? 24 : 0) + (ready ? 28 : 0) + (current.level ?? 0) / 4
      + (compatible ? 15 : 0) + (current.reviewed ? 3 : 0) + preferredMode;
    const actions = [];
    if (!current.reviewed || !current.tier || !current.level) actions.push('Сверь уровень, Tier и экипировку в игре.');
    if (hasUniform && !worn) actions.push('Для теста выбери «' + uniform + '» в игре и в карточке Atlas.');
    if (baselineSupport && !hasUniform) actions.push('Используй уже доступный бонус поддержки. Сравни эффект костюма перед покупкой.');
    else if (!hasUniform) actions.push(current.uniform
      ? 'Текущий костюм: «' + current.uniform + '». Сравни с «' + uniform + '» перед тратой кристаллов.'
      : 'Уточни, есть ли «' + uniform + '». От покупки зависит применимость этой сборки.');
    if (ready) actions.push(support ? 'Проверь, допускают ли правила режима эту поддержку.' : 'Используй уже достигнутый Tier-4 для пробного боя.');
    else if (support && current.tier === 'I') actions.push('Проверь эффект пассивного навыка и требования режима перед переходом на Tier-2.');
    else if (!support && hero.t4) actions.push('Сравни результат на текущем Tier перед расходом материалов Tier-4.');
    if (current.artifact && mode === 'pvp') actions.push('Учтён артефакт: ' + current.artifact + '. Проверь условие активации его эффекта.');
    if (compatible) actions.push('Оставь установленный CTP для первого теста: ' + current.ctp + '.');
    const gear = options.filter(option => !support || !equipped.has(normalize(option))).map(option => ({ option, key: normalize(option) }));
    return [{ hero, current, uniform, role, why, sources, priority, gear, options, actions, compatible, hasUniform: hasUniform || baselineSupport, support }];
  });

  rows.sort((a, b) => b.priority - a.priority || a.hero.name.localeCompare(b.hero.name));
  let gaveSupport = false;
  for (const row of rows) {
    if (row.compatible || !row.options.length) continue;
    if (!row.hasUniform) {
      row.actions.push('Условный вариант CTP: ' + row.options.join(' / ') + '. Сначала проверь костюм.');
      continue;
    }
    const free = row.gear.map(x => stock.find(item => item.count > 0 && normalize(item.name) === x.key)).find(Boolean);
    if (free && (!row.support || !gaveSupport) && row.current.ctp === 'Нет') {
      row.actions.push('В запасе есть ' + [free.grade, free.name].filter(Boolean).join(' ') + '. Проверь результат сборки перед установкой.');
      free.count--;
      if (row.support) gaveSupport = true;
    } else if (row.current.ctp && row.current.ctp !== 'Нет') {
      row.actions.push('Установлен ' + row.current.ctp + '. Сравни с ' + row.options.join(' / ') + ' перед снятием CTP.');
    } else {
      row.actions.push('Вариант CTP из источника: ' + row.options.join(' / ') + '. Сверь свободные экземпляры и команду.');
    }
  }
  return rows;
}
