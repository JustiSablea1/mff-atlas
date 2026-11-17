export const LEGACY = 'mff-atlas-v12';
export const TIERS = ['', 'I', 'II', 'III', 'IV', 'Awakened', 'Transcended'];
export const CTP = ['Ascent', 'Authority', 'Competition', 'Conquest', 'Destruction', 'Energy', 'Greed', 'Insight', 'Judgment', 'Liberation', 'Patience', 'Rage', 'Refinement', 'Regeneration', 'Transcendence', 'Veteran'];
export const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clean = (value, size = 200) => typeof value === 'string' ? value.trim().slice(0, size) : '';
const number = (value, max) => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim())))
  && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= max ? Number(value) : null;
const list = value => Array.isArray(value) ? value : [];

export function catalogIndex(data) {
  const byName = new Map();
  const heroes = data.characters.map(([id, name, type, native, advance, t4, base, uniforms, aliases]) => ({
    id, name, type, native, advance, t4, base, uniforms, aliases
  }));
  for (const hero of heroes) {
    for (const label of [hero.name, ...hero.aliases]) byName.set(normalize(label), hero);
  }
  return { heroes, byName, byId: new Map(heroes.map(hero => [hero.id, hero])) };
}

export const emptyProfile = () => ({ version: 2, player: '', characters: [], inventory: [], cards: [], resources: [], preferences: {} });

export function parseProfile(raw, catalog) {
  if (!raw || !Array.isArray(raw.characters) || raw.characters.length > 1500
      || (raw.version != null && ![1, 2, '1', '2'].includes(raw.version))) {
    throw new Error('Ожидается резервная копия MFF Atlas версии 1 или 2 с массивом characters.');
  }
  const result = { ...raw, ...emptyProfile(), player: clean(raw.player) };
  const warnings = [];
  const chars = new Map();
  for (const [i, source] of raw.characters.entries()) {
    if (!source || typeof source !== 'object' || !clean(source.name)) {
      warnings.push('Строка ' + (i + 1) + ' пропущена: нет имени.');
      continue;
    }
    const hero = catalog.byName.get(normalize(source.name));
    const id = hero?.id ?? 'custom:' + normalize(source.name);
    const rawTier = clean(String(source.tier ?? '')).replace(/^tier\s*/i, '');
    const roman = ['', 'I', 'II', 'III', 'IV'];
    const tier = roman[Number(rawTier)] || TIERS.find(t => t.toLowerCase() === rawTier.toLowerCase()) || '';
    const level = number(source.level, 80);
    if ((!tier && rawTier && rawTier !== '?') || (!level && source.level && source.level !== '?')) {
      warnings.push(source.name + ' — уровень или Tier требует проверки.');
    }
    const character = {
      ...source, id, name: hero?.name ?? clean(source.name), tier, level,
      owned: source.owned === true || source.owned === 1,
      reviewed: source.reviewed === true, uniform: clean(source.uniform), ctp: clean(source.ctp),
      artifact: clean(source.artifact), notes: clean(source.notes, 4000),
      ownedUniforms: [...new Set([...list(source.ownedUniforms), source.uniform].map(x => clean(x)).filter(Boolean))]
    };
    if (chars.has(id)) warnings.push(character.name + ' — дубликат, сохранена первая запись и заполнены её пропуски.');
    chars.set(id, chars.has(id) ? fillMissing(chars.get(id), character) : character);
  }
  result.characters = [...chars.values()];
  if (raw.characters.length && !result.characters.length) throw new Error('Файл не содержит читаемых записей.');
  result.inventory = list(raw.inventory).filter(x => x && clean(x.name)).map(x => ({
    ...x, name: clean(x.name), grade: clean(x.grade), count: number(x.count, 9999) ?? 0
  }));
  result.cards = list(raw.cards).filter(x => x && clean(x.name)).map(x => ({
    ...x, name: clean(x.name), quality: number(x.quality, 7), pierce: Math.min(25, Math.max(0, Number(x.pierce) || 0)), equipped: x.equipped === true
  }));
  result.resources = list(raw.resources).filter(x => x && clean(x.name)).map(x => ({
    ...x, name: clean(x.name), count: number(x.count, Number.MAX_SAFE_INTEGER) ?? 0
  }));
  result.preferences = {
    pve: ['wbl', 'abx'].includes(raw.preferences?.pve) ? raw.preferences.pve : 'wbl',
    pvp: ['timeline', 'otherworld'].includes(raw.preferences?.pvp) ? raw.preferences.pvp : 'timeline'
  };
  return { profile: result, warnings };
}

function fillMissing(existing, incoming, conflicts) {
  const merged = { ...existing };
  for (const [field, value] of Object.entries(incoming)) {
    if (['id', 'name', 'reviewed', 'owned', 'ownedUniforms'].includes(field) || ['', '?', null, undefined, 'Unknown', 'Не указана'].includes(value)) continue;
    if (['', '?', null, undefined, 'Unknown', 'Не указана'].includes(existing[field])) merged[field] = value;
    else if (conflicts && ['tier', 'level', 'uniform', 'ctp', 'artifact'].includes(field) && String(existing[field]) !== String(value)) {
      conflicts.push({ id: existing.id, name: existing.name, field, current: existing[field], incoming: value });
    }
  }
  merged.owned = existing.owned || incoming.owned;
  merged.ownedUniforms = [...new Set([...list(existing.ownedUniforms), ...list(incoming.ownedUniforms)])];
  return merged;
}

export function mergeProfile(current, incoming) {
  const conflicts = [];
  const characters = new Map(current.characters.map(hero => [hero.id, hero]));
  for (const hero of incoming.characters) {
    const previous = characters.get(hero.id);
    characters.set(hero.id, previous ? fillMissing(previous, hero, conflicts) : hero);
  }
  const mergeLists = (a, b, key) => [...a, ...b.filter(x => !a.some(y => key(x) === key(y)))];
  return {
    profile: {
      ...incoming, ...current, player: current.player || incoming.player,
      characters: [...characters.values()],
      inventory: mergeLists(current.inventory, incoming.inventory, x => normalize(x.name + ' ' + x.grade)),
      cards: mergeLists(current.cards, incoming.cards, x => normalize(x.name)),
      resources: mergeLists(current.resources, incoming.resources, x => normalize(x.name))
    }, conflicts
  };
}

export function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mff-atlas-profile', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закрой другие вкладки Atlas и попробуй снова.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      const get = (store, key) => new Promise((done, fail) => {
        const target = db.transaction(store).objectStore(store);
        const read = key == null ? target.getAll() : target.get(key);
        read.onsuccess = () => done(read.result);
        read.onerror = () => fail(read.error);
      });
      const write = (expected, profile, reason, original) => new Promise((done, fail) => {
        const tx = db.transaction(['state', 'history'], 'readwrite');
        const state = tx.objectStore('state');
        const history = tx.objectStore('history');
        let next, conflict;
        const read = state.get('profile');
        read.onsuccess = () => {
          const before = read.result;
          if ((before?.revision ?? 0) !== expected) {
            conflict = new Error('Данные уже изменились в другой вкладке. Обнови страницу, затем повтори действие.');
            tx.abort();
            return;
          }
          if (before || original) history.add({ at: new Date().toISOString(), reason, profile: before?.profile ?? original });
          next = { revision: expected + 1, profile };
          state.put(next, 'profile');
        };
        tx.oncomplete = () => done(next);
        tx.onabort = () => fail(conflict ?? tx.error ?? new Error('Запись отменена.'));
        tx.onerror = () => {};
      });
      resolve({ read: () => get('state', 'profile'), history: () => get('history'), write });
    };
  });
}
