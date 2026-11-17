import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogIndex, parseProfile, emptyProfile, mergeProfile } from '../v2/profile.mjs';
import { buildPlan } from '../v2/plan.mjs';
import { matchLines } from '../v2/scan.mjs';
import { decodeFeatures } from '../v2/portraits.mjs';

const text = name => readFileSync(new URL('../v2/' + name, import.meta.url), 'utf8');
const catalog = catalogIndex(JSON.parse(text('catalog.json')));
const evidence = JSON.parse(text('evidence.json'));
const parse = raw => parseProfile(raw, catalog).profile;

test('catalogue and sourced builds reference canonical heroes and uniforms', () => {
  assert.equal(catalog.heroes.length, 294);
  assert.equal(catalog.byId.size, catalog.heroes.length);
  assert.equal(catalog.heroes.reduce((sum, x) => sum + x.uniforms.length, 0), 602);
  for (const [id, , uniform, , , , links] of evidence.builds) {
    const hero = catalog.byId.get(id);
    assert.ok(hero, id);
    assert.ok(hero.base === uniform || hero.uniforms.some(x => x[0] === uniform), id + ' · ' + uniform);
    assert.ok(links.every(key => evidence.sources[key]));
  }
  assert.ok(decodeFeatures(text('portraits.ndjson')).every(x => catalog.byId.has(x.id) && x.feature.length === 64));
});

test('old JSON aliases, invalid values and duplicate records', () => {
  const original = { player: 'Player', version: 1, characters: [
    { id: 'mordo', name: 'Mordo', owned: true, tier: 'III', level: '80' },
    { id: 'mordo2', name: 'Baron Mordo', owned: false, level: '70', ctp: 'Rage' },
    { name: 'Custom', level: '90', tier: 'unknown' }
  ] };
  const { profile, warnings } = parseProfile(original, catalog);
  assert.equal(profile.characters[0].id, 'baronmordo');
  assert.equal(profile.characters[0].level, 80);
  assert.equal(profile.characters[0].ctp, 'Rage');
  assert.equal(profile.characters[1].level, null);
  assert.equal(warnings.length, 2);
  assert.equal(original.characters[0].level, '80');
  assert.throws(() => parseProfile({ version: 9, characters: [] }, catalog));
});

test('merge fills missing values while preserving existing confirmed data', () => {
  const current = parse({ ...emptyProfile(), player: 'Local', characters: [
    { name: 'Thor', owned: true, level: 80, tier: 'IV', reviewed: true, uniform: 'Herald of Thunder' }
  ] });
  const incoming = parse({ player: 'Imported', characters: [
    { name: 'Thor', owned: false, level: 70, tier: 'III', uniform: 'All-Father Reborn', ctp: 'Rage' }
  ], resources: [{ name: 'Crystals', count: 123 }] });
  const result = mergeProfile(current, incoming);
  const hero = result.profile.characters[0];
  assert.equal(result.profile.player, 'Local');
  assert.equal(result.profile.resources[0].count, 123);
  assert.deepEqual([hero.owned, hero.reviewed, hero.tier, hero.level, hero.uniform, hero.ctp], [true, true, 'IV', 80, 'Herald of Thunder', 'Rage']);
  assert.deepEqual(hero.ownedUniforms, ['Herald of Thunder', 'All-Father Reborn']);
  assert.equal(result.conflicts.length, 3);
});

test('PvE and PvP use the owned roster, verified build, and free CTP availability', () => {
  const player = parse({ characters: [
    { name: 'Thor', owned: true, tier: 'IV', level: 80, uniform: 'All-Father Reborn', ctp: 'Нет' },
    { name: 'Sentry', owned: true, tier: 'III', level: 70 }
  ], inventory: [{ name: 'Rage', grade: 'Mighty', count: 1 }] });
  const pve = buildPlan(player, catalog, evidence, 'pve', 'wbl');
  const pvp = buildPlan(player, catalog, evidence, 'pvp', 'timeline');
  assert.deepEqual(pve.map(x => x.hero.id), ['thor']);
  assert.deepEqual(pvp.map(x => x.hero.id), ['sentry']);
  assert.match(pve[0].actions.join(' '), /В запасе есть Mighty Rage/);
  assert.match(pvp[0].actions.join(' '), /Уточни, есть ли/);
  assert.equal(player.inventory[0].count, 1);
});

test('OCR requires whole names and drops conflicting levels', () => {
  const matches = matchLines('Что-то про Thor\nТор Lv. 80 Tier 4\nThor Level 70\nДжин Грей  —  80', catalog);
  assert.deepEqual(matches.map(x => [x.name, x.level, x.tier]), [['Thor', null, 'IV'], ['Jean Grey', 80, '']]);
});
