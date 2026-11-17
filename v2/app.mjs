import { LEGACY, TIERS, CTP, normalize, catalogIndex, emptyProfile, parseProfile, mergeProfile, openStore } from './profile.mjs';
import { buildPlan } from './plan.mjs';
import { recognize, matchLines } from './scan.mjs';

const $ = id => document.getElementById(id);
const view = $('view');
const esc = input => String(input ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tierLabel = value => value && (value.length <= 3 ? 'Tier ' + value : value);
const typeNames = { Combat: 'Боевой', Blast: 'Энергетический', Speed: 'Скоростной', Universal: 'Универсальный' };
const modes = { pve: { wbl: 'World Boss Legend', abx: 'Alliance Battle Extreme / Legend' }, pvp: { timeline: 'Timeline Battle', otherworld: 'Otherworld Battle' } };
const empty = (heading, detail, button = '') => '<section class="panel empty"><h2>' + heading + '</h2><p>' + detail + '</p>' + button + '</section>';
const option = (value, title, chosen) => '<option value="' + esc(value) + '"' + (value === chosen ? ' selected' : '') + '>' + esc(title) + '</option>';
const input = (label, name, value = '', more = '') => '<label>' + label + '<input name="' + name + '" value="' + esc(value) + '" ' + more + '></label>';
const select = (label, name, choices, chosen) => '<label>' + label + '<select name="' + name + '">' + choices.map(([k, v]) => option(k, v, chosen)).join('') + '</select></label>';
const heading = (title, description = '') => '<div class="section-head"><h1>' + title + '</h1>' + (description ? '<p>' + description + '</p>' : '') + '</div>';
const sourceLink = key => {
  const [title, url] = evidence.sources[key];
  return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(title) + '</a>';
};
let catalog, evidence, store, state, startupWarning = '', pending, activeMode = 'pve', tab = '', saving = false;
let query = '', rosterFilter = 'all', rosterType = '', page = 1, scanResults = [], scanText = '', scanUrls = [], scanGeneration = 0;
let noticeTimer;
const profile = () => state.profile;
const ownedHeroes = () => profile().characters.filter(x => x.owned);
const show = (message, alert = false) => {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', alert);
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, alert ? 10000 : 4200);
};
const errorMessage = e => e?.name === 'QuotaExceededError'
  ? 'Хранилище заполнено. Скачай резервную копию. Текущий профиль сохранён.' : (e?.message || 'Действие не выполнено.');

async function save(next, reason) {
  if (saving) return false;
  saving = true;
  try {
    state = await store.write(state.revision, next, reason);
    show('Сохранено на этом устройстве');
    return true;
  } catch (error) {
    show(errorMessage(error), true);
    return false;
  } finally {
    saving = false;
  }
}

function route() {
  const next = location.hash.slice(1).split('/')[0];
  return ['plan', 'roster', 'hero', 'inventory', 'import', 'data'].includes(next) ? next : 'plan';
}

function go(name) {
  if (location.hash === '#' + name) render();
  else location.hash = name;
}

function render() {
  if (!state) return;
  tab = route();
  document.querySelectorAll('nav a').forEach(a => {
    if (a.hash === '#' + (tab === 'hero' ? 'roster' : tab)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  switch (tab) {
    case 'roster': renderRoster(); break;
    case 'hero': {
      let id;
      try { id = decodeURIComponent(location.hash.slice(6)); } catch { id = ''; }
      renderHero(id);
      break;
    }
    case 'inventory': renderInventory(); break;
    case 'import': renderImport(); break;
    case 'data': renderData(); break;
    default: renderPlan();
  }
}

function renderPlan() {
  const owned = ownedHeroes();
  const checked = owned.filter(x => x.reviewed).length;
  const geared = owned.filter(x => x.ctp && x.ctp !== 'Нет').length;
  const p = profile();
  const goal = p.preferences[activeMode] || Object.keys(modes[activeMode])[0];
  const plan = buildPlan(p, catalog, evidence, activeMode, goal);
  const count = new Intl.NumberFormat('ru-RU');
  const free = p.inventory.reduce((sum, x) => sum + x.count, 0);
  const materials = p.resources.filter(x => x.count > 0).map(x => x.name + ' ' + count.format(x.count)).slice(0, 4);
  const pierce = p.cards.filter(x => x.equipped).reduce((sum, x) => sum + x.pierce, 0);
  view.innerHTML = '<section class="hero"><div class="hero-content"><div class="kicker">MARVEL FUTURE FIGHT</div><h1>План развития</h1>' +
    '<p>' + esc(p.player || 'Твой аккаунт') + '</p><div class="hero-stats"><div><strong>' + owned.length + '</strong><span>В ростере</span></div><div><strong>' + checked + '</strong><span>Проверено</span></div><div><strong>' + geared + '</strong><span>С CTP</span></div></div></div></section>' +
    '<div class="switch" aria-label="Тип плана">' + ['pve', 'pvp'].map(m => '<button data-mode="' + m + '" aria-pressed="' + (m === activeMode) + '">' + (m === 'pve' ? 'PvE' : 'PvP') + '</button>').join('') + '</div>' +
    '<div class="plan-header">' + select('Режим', 'goal', Object.entries(modes[activeMode]), goal) + '</div>' +
    (!owned.length ? empty('Загрузи ростер', 'Импортируй JSON или скриншоты. Atlas подберёт первые шаги на основе доступных сборок.', '<a class="primary button" href="#import">Импортировать аккаунт</a>') :
      '<section class="panel summary"><div><strong>Перед вложениями</strong><p>' + (checked < owned.length ? 'Сверь костюм и CTP у приоритетных героев. ' : '') +
       (activeMode === 'pve' ? 'Сравни результат на одном боссе или при одинаковых ограничениях Alliance Battle.' : 'Проверь сезонные ограничения, доступность героев и результаты пробных боёв.') + '</p></div><a href="#roster">К героям</a></section>' +
       '<p class="small metainfo">' + (p.inventory.length ? 'Свободных CTP: ' + free : 'Запас CTP не указан') + ' · ' +
       (p.cards.some(x => x.equipped) ? 'Пробитие по введённым картам: ' + count.format(pierce) + '%' : 'Пробитие по картам не указано') + '</p>' +
       (materials.length ? '<p class="small metainfo">Записанные ресурсы: ' + esc(materials.join(' · ')) + '</p>' : '') +
       (plan.length ? '<div class="plan-list">' + plan.map((row, i) => renderRecommendation(row, i)).join('') + '</div>' :
          empty('Для твоего ростера мало проверенных сборок', 'Укажи экипировку героев и используй ссылки на гайды, чтобы выбрать сборку для пробного боя.'))) +
    '<details class="panel sources"><summary>На чём основан план</summary><p class="small">Проверка источников: ' + esc(evidence.checked.split('-').reverse().join('.')) + '</p><p>' + esc(evidence.scope) + '</p><p>Порядок зависит от прогресса героя, наличия костюма и подходящего CTP. Проверь условия режима, доступность сезонных костюмов и цену перед покупкой.</p><ul>' +
    Object.keys(evidence.sources).map(k => '<li>' + sourceLink(k) + '</li>').join('') + '</ul></details>';
  view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { activeMode = b.dataset.mode; renderPlan(); });
  view.querySelector('[name="goal"]').onchange = async e => {
    const saved = await save({ ...p, preferences: { ...p.preferences, [activeMode]: e.target.value } }, 'Выбор режима');
    if (saved && route() === 'plan') renderPlan();
    else if (!saved) e.target.value = goal;
  };
}

function renderRecommendation(row, i) {
  const badges = [row.role, tierLabel(row.current.tier), row.current.level && 'Ур. ' + row.current.level].filter(Boolean);
  return '<article class="panel recommendation"><div class="rec-head"><span class="rank">' + (i + 1) + '</span><div><h2>' + esc(row.hero.name) +
    '</h2><div class="chips">' + badges.map(x => '<span>' + esc(x) + '</span>').join('') + '</div></div><a class="button" href="#hero/' + encodeURIComponent(row.hero.id) + '">Сборка</a></div>' +
    '<p>' + esc(row.why) + '</p><ul class="steps">' + row.actions.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
    '<details><summary>Источники по сборке</summary><ul>' + row.sources.map(k => '<li>' + sourceLink(k) + '</li>').join('') + '</ul></details></article>';
}

function renderRoster() {
  view.innerHTML = heading('Герои', 'Ростер аккаунта и каталог Marvel Future Fight') +
    '<div class="panel controls"><label>Поиск<input id="search" type="search" placeholder="Имя или костюм" value="' + esc(query) + '"></label><div class="columns">' +
    select('Ростер', 'owned-filter', [['all', 'Весь каталог'], ['owned', 'В аккаунте'], ['review', 'Требуют проверки']], rosterFilter) +
    select('Тип', 'type-filter', [['', 'Все типы'], ...Object.entries(typeNames)], rosterType) + '</div></div><div id="roster-results"></div>';
  $('search').oninput = e => { query = e.target.value; page = 1; renderRosterResults(); };
  view.querySelector('[name="owned-filter"]').onchange = e => { rosterFilter = e.target.value; page = 1; renderRosterResults(); };
  view.querySelector('[name="type-filter"]').onchange = e => { rosterType = e.target.value; page = 1; renderRosterResults(); };
  renderRosterResults();
}

function renderRosterResults() {
  const known = new Map(profile().characters.map(x => [x.id, x]));
  const custom = profile().characters.filter(x => !catalog.byId.has(x.id)).map(x => ({ ...x, aliases: [], uniforms: [] }));
  const term = normalize(query);
  const result = [...catalog.heroes, ...custom].filter(hero => {
    const current = known.get(hero.id);
    return (rosterFilter === 'all' || (current?.owned && (rosterFilter !== 'review' || !current.reviewed))) &&
      (!rosterType || (hero.type || current?.type) === rosterType) &&
      (!term || [hero.name, ...hero.aliases, hero.base, ...hero.uniforms.map(x => x[0]), current?.uniform].some(x => normalize(x).includes(term)));
  });
  $('roster-results').innerHTML = '<p class="small">Найдено: ' + result.length + '</p>' + result.slice(0, page * 35).map(hero => {
    const current = known.get(hero.id);
    const facts = [typeNames[hero.type], tierLabel(current?.tier), current?.level && 'Ур. ' + current.level, current?.ctp].filter(Boolean);
    const initials = hero.name.split(/[ (]/).filter(Boolean).slice(0, 2).map(x => x[0]).join('');
    return '<a class="panel roster-item" href="#hero/' + encodeURIComponent(hero.id) + '"><span class="avatar ' + esc(hero.type) + '">' + esc(initials) + '</span><span class="roster-name"><strong>' + esc(hero.name) +
      '</strong><small>' + esc(facts.join(' · ') || 'Тип уточняется') + '</small></span><span class="indicator">' + (current?.owned ? 'В ростере' : '›') + '</span></a>';
  }).join('') + (result.length > page * 35 ? '<button id="more" class="wide">Показать ещё</button>' : '');
  if ($('more')) $('more').onclick = () => { page++; renderRosterResults(); };
}

function renderHero(id) {
  const saved = profile().characters.find(x => x.id === id);
  const hero = catalog.byId.get(id) ?? saved;
  if (!hero) { go('roster'); return; }
  const c = saved ?? { id: hero.id, name: hero.name, owned: false, ownedUniforms: [] };
  const uniforms = [['', 'Не указан'], ...new Set([hero.base, ...(hero.uniforms || []).map(x => x[0]), c.uniform].filter(Boolean))].map(x => Array.isArray(x) ? x : [x, x]);
  const ctpList = [['', 'Не указан'], ['Нет', 'Без CTP'], ...CTP.map(x => [x, x])];
  if (c.ctp && !ctpList.some(([key]) => key === c.ctp)) ctpList.push([c.ctp, c.ctp]);
  view.innerHTML = '<a class="back" href="#roster">‹ Все герои</a>' +
    heading(esc(hero.name), esc([typeNames[hero.type], hero.native, hero.t4 && 'Доступен Tier-4'].filter(Boolean).join(' · '))) +
    '<form id="edit-hero" class="panel form"><label class="tick"><input type="checkbox" name="owned" ' + (c.owned ? 'checked' : '') + '>Есть в аккаунте</label><div class="columns">' +
    input('Уровень', 'level', c.level, 'type="number" inputmode="numeric" min="1" max="80"') +
    select('Развитие', 'tier', TIERS.map(t => [t, tierLabel(t) || 'Не указано']), c.tier || '') + '</div>' +
    select('Активный костюм', 'uniform', uniforms, c.uniform || '') + input('Другой активный костюм', 'customUniform', '', 'placeholder="Если его нет в каталоге"') +
    '<details><summary>Костюмы в коллекции</summary><div class="uniform-list">' +
    [...new Set([...(hero.uniforms || []).map(x => x[0]), ...c.ownedUniforms])].map(u => {
      const cost = hero.uniforms?.find(x => x[0] === u)?.[2];
      return '<label class="tick"><input name="uniforms" type="checkbox" value="' + esc(u) + '" ' + (c.ownedUniforms.includes(u) ? 'checked' : '') + '><span>' + esc(u) +
        (cost ? '<small>' + esc(cost.replace('Crystals', 'кристаллов')) + '</small>' : '') + '</span></label>';
    }).join('') + '</div></details>' +
    '<div class="columns">' + select('Установленный CTP', 'ctp', ctpList, c.ctp || '') + input('Качество / перековка CTP', 'ctpGrade', c.ctpGrade, 'placeholder="Mighty, Brilliant…"') + '</div>' +
    '<div class="columns">' + input('Артефакт', 'artifact', c.artifact) + input('Звёзды артефакта', 'artifactStars', c.artifactStars, 'type="number" min="1" max="6"') + '</div>' +
    '<label>Заметки<textarea name="notes" rows="3" maxlength="4000">' + esc(c.notes) + '</textarea></label>' +
    '<label class="tick"><input type="checkbox" name="reviewed" ' + (c.reviewed ? 'checked' : '') + '>Сверено в игре</label><button class="primary">Сохранить героя</button></form>';
  $('edit-hero').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const uniform = f.get('customUniform').trim() || f.get('uniform');
    const nextCharacter = { ...c, name: hero.name, uniform, ctp: f.get('ctp'), ctpGrade: f.get('ctpGrade').trim(),
      owned: f.has('owned'), reviewed: f.has('reviewed'), tier: f.get('tier'), level: Number(f.get('level')) || null,
      artifact: f.get('artifact').trim(), artifactStars: Number(f.get('artifactStars')) || null,
      notes: f.get('notes').trim(), ownedUniforms: [...new Set([...f.getAll('uniforms'), uniform].filter(Boolean))] };
    if (saved && (saved.owned && !nextCharacter.owned || saved.ownedUniforms.some(x => !nextCharacter.ownedUniforms.includes(x)) ||
        ['level', 'tier', 'uniform', 'ctp', 'artifact', 'ctpGrade', 'artifactStars', 'notes'].some(k => saved[k] && saved[k] !== nextCharacter[k])) &&
        !confirm('Применить изменения? Текущая версия профиля будет сохранена в истории.')) return;
    const characters = profile().characters.filter(x => x.id !== id).concat(nextCharacter);
    if (await save({ ...profile(), characters }, 'Карточка героя: ' + hero.name)
        && location.hash === '#hero/' + encodeURIComponent(id)) renderHero(id);
  };
}

function renderInventory() {
  const models = [
    { key: 'inventory', title: 'Свободные CTP', fields: select('CTP', 'name', CTP.map(x => [x, x]), 'Rage') +
      select('Перековка', 'grade', ['', 'Mighty', 'Brilliant'].map(x => [x, x || 'Обычный']), '') +
      input('Количество', 'count', 1, 'type="number" min="0" max="9999" required') },
    { key: 'cards', title: 'Карты', fields: input('Название карты', 'name', '', 'required maxlength="160"') +
      input('Качество', 'quality', '', 'type="number" min="1" max="7"') + input('Пробитие, %', 'pierce', '', 'type="number" min="0" max="25" step="0.1"') +
      '<label class="tick"><input name="equipped" type="checkbox">Установлена</label>' },
    { key: 'resources', title: 'Ресурсы', fields: input('Название', 'name', '', 'required maxlength="160" list="materials"') +
      '<datalist id="materials">' + ['Кристаллы', 'Золото', 'Soul of the Faltine', 'Carbonadium', 'Life Seed', 'Book of Vishanti', 'Cosmic Cube Fragment', 'Titan Component Pack', 'Essence of Dimension', 'Titan’s Record', 'Mandalay Gem Fragment'].map(x => option(x, x)).join('') + '</datalist>' +
      input('Количество', 'count', '', 'type="number" min="0" max="9007199254740991" required') }
  ];
  view.innerHTML = heading('Запасы', 'Установленные CTP и артефакты редактируются в карточках героев.') +
    models.map(({ key, title, fields }) => '<section class="panel"><h2>' + title + '</h2><div class="asset-list">' + profile()[key].map((x, idx) => {
      const caption = key === 'cards' ? [x.equipped && 'Установлена', x.quality && 'Качество ' + x.quality, x.pierce + '% пробития'].filter(Boolean).join(' · ') : new Intl.NumberFormat('ru-RU').format(x.count);
      return '<div class="asset"><div><strong>' + esc([x.grade, x.name].filter(Boolean).join(' ')) + '</strong><small>' + esc(caption) + '</small></div>' +
        '<button type="button" data-remove="' + key + ':' + idx + '" aria-label="Удалить ' + esc(x.name) + '">Удалить</button></div>';
    }).join('') + '</div><details' + (profile()[key].length ? '' : ' open') + '><summary>Указать или обновить</summary><form class="form" data-inventory="' + key +
    '"><div class="columns">' + fields + '</div><button>Сохранить</button></form></details></section>').join('');
  view.querySelectorAll('[data-inventory]').forEach(form => form.onsubmit = async e => {
    e.preventDefault();
    const key = form.dataset.inventory, f = new FormData(form);
    const x = { name: f.get('name').trim() };
    if (!x.name) { show('Укажи название.', true); return; }
    if (key === 'cards') Object.assign(x, { quality: Number(f.get('quality')) || null, pierce: Number(f.get('pierce')) || 0, equipped: f.has('equipped') });
    else x.count = Number(f.get('count'));
    if (key === 'inventory') x.grade = f.get('grade');
    const matches = y => normalize(y.name) === normalize(x.name) && (y.grade || '') === (x.grade || '');
    const current = profile()[key];
    if (current.some(matches) && !confirm('Обновить запись? Текущая версия профиля будет сохранена в истории.')) return;
    if (await save({ ...profile(), [key]: [...current.filter(y => !matches(y)), x] }, 'Запасы: ' + x.name) && route() === 'inventory') renderInventory();
  });
  view.querySelectorAll('[data-remove]').forEach(button => button.onclick = async () => {
    const [key, index] = button.dataset.remove.split(':');
    if (!confirm('Удалить запись из профиля? Её можно восстановить из истории.')) return;
    if (await save({ ...profile(), [key]: profile()[key].filter((_, i) => i !== Number(index)) }, 'Удаление записи из запасов') && route() === 'inventory') renderInventory();
  });
}

const fieldNames = { tier: 'Tier', level: 'Уровень', uniform: 'Костюм', ctp: 'CTP', artifact: 'Артефакт' };
function stage(raw, label, screenshot) {
  const { profile: incoming, warnings } = parseProfile(raw, catalog);
  pending = { incoming, warnings, label, screenshot };
  renderImport();
  $('preview-import').scrollIntoView({ block: 'start' });
}

function scanPreview() {
  const byName = ownedHeroes().map(x => x.name);
  return (scanUrls.length ? '<div class="thumbs">' + scanUrls.map(url => '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="Скриншот для сверки"></a>').join('') + '</div>' : '') +
    (scanResults.length ? '<ul class="small">' + scanResults.map(x => '<li>' + esc(x.name) + ' · ' + esc(x.error || (x.matches?.length ? 'совпадений по портретам: ' + x.matches.length : x.text ? 'уверенность OCR ' + x.confidence + '%' : 'текст не найден')) + '</li>').join('') + '</ul>' : '') +
    '<label>Распознанный текст или список имён<textarea id="scan-text" rows="5" placeholder="Thor Lv. 80 Tier IV">' + esc(scanText) + '</textarea></label>' +
    '<button type="button" id="match">Сопоставить с каталогом</button>' +
    '<details><summary>Добавить героя по портрету</summary><p>Если совпадения нет, введи имя и уровень по скриншоту в список выше.</p><small>' +
    esc(byName.length ? 'Имена уже в ростере: ' + byName.slice(0, 6).join(', ') + '…' : 'Пример строки: Jean Grey Lv. 80 Tier III') + '</small></details>';
}

function renderImport() {
  const p = pending;
  view.innerHTML = heading('Импорт', 'Проверь найденное, затем примени изменения к профилю.') +
    '<section class="panel"><h2>Файл аккаунта</h2><label>JSON MFF Atlas<input id="json-file" type="file" accept=".json,application/json"></label></section>' +
    '<section class="panel"><h2>Скриншоты</h2><p>Atlas сверяет портреты на альбомных скриншотах ростера и читает подписи на PNG и JPEG. Обработка идёт на устройстве. Для первого запуска распознавания текста нужен интернет.</p><div class="form">' +
    '<label>Выбрать изображения<input id="screens" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>' +
    select('Язык игры', 'language', [['eng', 'Английский'], ['rus', 'Русский'], ['eng+rus', 'Английский и русский']], 'eng') +
    '<div class="actions"><button type="button" id="scan">Распознать ростер</button><button type="button" id="scan-text-only">Только текст</button></div><div id="scan-status" class="small" role="status"></div><div id="scan-preview">' + scanPreview() + '</div></div></section>' +
    (p ? importPanel(p) : '');
  $('json-file').onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Размер JSON превышает 5 МБ.');
      const raw = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (!e.target.isConnected) return;
      scanGeneration++;
      stage(raw, file.name, false);
    } catch (error) { show('Ошибка импорта. ' + errorMessage(error), true); }
    finally { e.target.value = ''; }
  };
  $('screens').onchange = e => {
    scanGeneration++;
    for (const url of scanUrls) URL.revokeObjectURL(url);
    scanUrls = [...e.target.files].slice(0, 12).map(file => URL.createObjectURL(file));
    scanResults = [];
    $('scan-status').textContent = '';
    $('scan-preview').innerHTML = scanPreview();
    bindScanText();
  };
  const scan = async e => {
    const button = e.currentTarget;
    const generation = ++scanGeneration;
    const files = [...$('screens').files];
    const status = $('scan-status');
    button.disabled = true;
    status.textContent = 'Подготовка словаря…';
    try {
      const results = await recognize(files, view.querySelector('[name="language"]').value, (index, percent) => {
        status.textContent = 'Фото ' + (index + 1) + '/' + files.length + ' · ' + Math.round(percent * 100) + '%';
      }, button.id === 'scan-text-only');
      if (generation !== scanGeneration || !status.isConnected) return;
      scanResults = results;
      scanText = results.map(x => x.text).filter(Boolean).join('\n');
      $('scan-preview').innerHTML = scanPreview();
      bindScanText();
      status.textContent = 'Распознавание завершено. Сверь текст со скриншотами.';
      const matched = new Map(matchLines(scanText, catalog).map(x => [x.name, x]));
      for (const result of results) {
        for (const candidate of result.matches || []) {
          const hero = catalog.byId.get(candidate.id);
          if (!hero || matched.has(hero.name)) continue;
          matched.set(hero.name, { name: hero.name, owned: true, scanUniform: candidate.uniform, scanHint: result.name + ' · ' + candidate.hint });
        }
      }
      if (matched.size) stage({ characters: [...matched.values()] }, 'Скриншоты', true);
    } catch (error) { if (status.isConnected) status.textContent = errorMessage(error); }
    finally { button.disabled = false; }
  };
  $('scan').onclick = scan;
  $('scan-text-only').onclick = scan;
  bindScanText();
  if (p) bindImport(p);
}

function bindScanText() {
  $('scan-text').oninput = e => { scanText = e.target.value; };
  $('match').onclick = () => {
    const matches = matchLines(scanText, catalog);
    if (matches.length) stage({ characters: matches }, 'Скриншоты и текст', true);
    else show('Совпадений нет. Проверь имя или раздели список на строки.', true);
  };
}

function importPanel(p) {
  const { conflicts } = mergeProfile(profile(), p.incoming);
  const existing = new Set(profile().characters.map(x => x.id));
  const names = p.screenshot ? p.incoming.characters : p.incoming.characters.filter(x => x.owned);
  return '<section id="preview-import" class="panel"><h2>Проверка импорта</h2><p>' + esc(p.label) + ' · ' + names.length + ' героев' +
    (p.incoming.player ? ' · ' + esc(p.incoming.player) : '') + '</p>' +
    (profile().player && p.incoming.player && normalize(profile().player) !== normalize(p.incoming.player)
      ? '<p class="warning">У файла другой ник: ' + esc(p.incoming.player) + '.</p>' : '') +
    (p.warnings.length ? '<details><summary>Замечания проверки (' + p.warnings.length + ')</summary><ul>' +
      p.warnings.slice(0, 100).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></details>' : '') +
    (p.screenshot ? '<p>Отметь только открытых героев. Серые портреты в ростере могут принадлежать неоткрытым героям. Костюм и ранг можно подтвердить для каждой записи.</p>' : '') +
    '<form id="confirm-import" class="form"><details ' + (p.screenshot ? 'open' : '') + '><summary>Записи ростера (' + names.length + ')</summary><div class="review-list">' +
    names.map((x, i) => p.screenshot ? '<div class="review-row"><label class="tick"><input type="checkbox" name="take" value="' + i + '">' + esc(x.name) + '</label><small>' + esc(x.scanHint || '') + '</small><div class="columns">' +
      input('Уровень', 'level-' + i, x.level, 'type="number" min="1" max="80"') + select('Tier', 'tier-' + i, TIERS.map(t => [t, tierLabel(t) || 'Не указан']), x.tier) + '</div>' +
      (x.scanUniform ? '<label class="tick"><input type="checkbox" name="costume-' + i + '">Активный костюм: ' + esc(x.scanUniform) + '</label>' : '') + '</div>' :
      '<p>' + esc([x.name, tierLabel(x.tier), x.level && 'ур. ' + x.level, x.uniform, x.ctp, existing.has(x.id) && 'уже есть'].filter(Boolean).join(' · ')) + '</p>').join('') + '</div></details>' +
    (conflicts.length ? '<details><summary>Различия с профилем (' + conflicts.length + ')</summary><p>При объединении текущие значения сохранятся.</p><ul>' +
      conflicts.slice(0, 100).map(x => '<li>' + esc(x.name + ' · ' + fieldNames[x.field] + ': ' + x.current + ' → ' + x.incoming) + '</li>').join('') + '</ul></details>' : '') +
    '<div class="actions"><button class="primary" value="merge">Объединить</button>' +
    (!p.screenshot && (profile().player || profile().characters.length || profile().inventory.length || profile().cards.length || profile().resources.length)
      ? '<button value="replace">Восстановить из файла</button>' : '') +
    '<button id="cancel-import" type="button">Отмена</button></div></form></section>';
}

function bindImport(p) {
  $('cancel-import').onclick = () => { pending = null; renderImport(); };
  $('confirm-import').onsubmit = async e => {
    e.preventDefault();
    const replace = e.submitter?.value === 'replace';
    let incoming = p.incoming;
    if (p.screenshot) {
      const f = new FormData(e.currentTarget);
      const characters = f.getAll('take').map(i => {
        const { scanUniform, scanHint, ...character } = incoming.characters[Number(i)];
        const uniform = f.has('costume-' + i) ? scanUniform : '';
        return { ...character, level: Number(f.get('level-' + i)) || null, tier: f.get('tier-' + i), uniform, ownedUniforms: uniform ? [uniform] : [] };
      });
      if (!characters.length) { show('Выбери хотя бы одного героя.', true); return; }
      incoming = { ...incoming, characters };
    }
    if (replace && !confirm('Заменить профиль содержимым файла? Текущая версия будет сохранена в локальной истории.')) return;
    if (!replace && !p.screenshot && incoming.player && profile().player && normalize(incoming.player) !== normalize(profile().player)
        && !confirm('Объединить два профиля с разными никами? Текущий ник сохранится.')) return;
    const next = replace ? incoming : mergeProfile(profile(), incoming).profile;
    if (await save(next, replace ? 'Восстановление файла' : 'Импорт: ' + p.label)) {
      pending = null;
      for (const url of scanUrls) URL.revokeObjectURL(url);
      scanUrls = [];
      scanText = '';
      scanResults = [];
      if (route() === 'import') go('plan');
    }
  };
}

function download(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'MFF-Atlas-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function renderData() {
  view.innerHTML = heading('Данные', 'Резервные копии и настройки профиля') +
    (startupWarning ? '<p class="warning">' + esc(startupWarning) + '</p>' : '') +
    '<form id="player-form" class="panel form"><h2>Аккаунт</h2>' + input('Игровой ник', 'player', profile().player, 'maxlength="60" required') + '<button>Сохранить ник</button></form>' +
    '<section class="panel"><h2>Резервная копия</h2><p>Сохрани JSON в «Файлы» или iCloud, чтобы перенести профиль между устройствами или восстановить его после очистки Safari.</p><div class="actions"><button id="export" class="primary">Скачать JSON</button><a class="button" href="#import">Восстановить</a></div></section>' +
    '<section class="panel"><h2>История изменений</h2><p>Перед каждой записью предыдущий профиль сохраняется локально.</p><div id="history" aria-live="polite"></div></section>' +
    '<section class="panel"><h2>Установка на iPhone</h2><p>В Safari открой меню «Поделиться» → «На экран Домой». Профили Safari и отдельного приложения могут храниться раздельно. Перенести профиль можно через JSON.</p><button id="check-update">Проверить обновление</button></section>';
  $('player-form').onsubmit = async e => {
    e.preventDefault();
    const player = new FormData(e.currentTarget).get('player').trim();
    if (!player || player === profile().player) return;
    if (profile().player && !confirm('Изменить ник? Предыдущий профиль сохранится в истории.')) return;
    if (await save({ ...profile(), player }, 'Изменение ника') && route() === 'data') renderData();
  };
  $('export').onclick = () => download(profile());
  $('check-update').onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error('Обновление доступно при открытии через Safari или другой браузер.');
      await reg.update();
      if (reg.waiting) offerUpdate(reg);
      else show('Проверка версии завершена');
    } catch (error) { show(errorMessage(error), true); }
  };
  try {
    const history = await store.history();
    if (tab !== 'data' || !$('history')) return;
    $('history').innerHTML = history.slice().reverse().map(entry =>
      '<div class="asset"><div><strong>' + esc(entry.reason) + '</strong><small>' + esc(new Date(entry.at).toLocaleString('ru-RU')) +
      '</small></div><button data-history="' + entry.id + '">Открыть</button></div>').join('') || '<p class="small">История пуста.</p>';
    view.querySelectorAll('[data-history]').forEach(b => b.onclick = () => {
      const item = history.find(x => x.id === Number(b.dataset.history));
      go('import');
      try {
        const { profile: incoming, warnings } = parseProfile(item.profile, catalog);
        pending = { incoming, warnings, label: 'Копия: ' + item.reason };
        if (route() === 'import') renderImport();
      } catch (error) { show(errorMessage(error), true); }
    });
  } catch (error) { show(errorMessage(error), true); }
}

function offerUpdate(reg) {
  $('update').hidden = false;
  $('apply-update').onclick = () => {
    if (saving) return;
    if (document.querySelector('form:focus-within') && !confirm('Обновить приложение? Сохрани изменения в открытой форме перед перезагрузкой.')) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    reg.waiting?.postMessage('ATLAS_UPDATE');
  };
}

async function installPwa() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  if (reg.waiting) offerUpdate(reg);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
    });
  });
}

async function boot() {
  try {
    const json = async path => {
      const response = await fetch(new URL(path, import.meta.url));
      if (!response.ok) throw new Error('Не удалось загрузить каталог или справочник сборок. Обнови страницу онлайн.');
      return response.json();
    };
    const [data, sources, db] = await Promise.all([json('./catalog.json'), json('./evidence.json'), openStore()]);
    catalog = catalogIndex(data);
    evidence = sources;
    store = db;
    state = await db.read();
    if (!state) {
      let legacy;
      try {
        const raw = localStorage.getItem(LEGACY);
        if (raw) legacy = JSON.parse(raw);
        if (legacy) {
          const migrated = parseProfile(legacy, catalog).profile;
          try { state = await db.write(0, migrated, 'Исходная копия Atlas 1.x', legacy); }
          catch (error) { state = await db.read(); if (!state) throw error; }
        }
      } catch (error) {
        startupWarning = 'Не удалось прочитать или перенести профиль 1.x. Исходные данные сохранены. ' + errorMessage(error);
      }
      state ??= { revision: 0, profile: emptyProfile() };
    }
    window.atlasStarted = true;
    addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
    render();
    if (startupWarning) show(startupWarning, true);
    installPwa().catch(() => show('Офлайн-режим пока недоступен.', true));
  } catch (error) {
    window.atlasStarted = true;
    view.innerHTML = empty('Профиль недоступен', esc(errorMessage(error)), '<button id="reload">Повторить</button>');
    $('reload').onclick = () => location.reload();
  }
}
boot();
