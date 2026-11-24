import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogIndex, parseProfile } from '../v2/profile.mjs';
import { buildPlan, investmentQueues } from '../v2/2.1/plan.mjs';

const data = name => JSON.parse(readFileSync(new URL('../v2/' + name, import.meta.url), 'utf8'));
const catalog = catalogIndex(data('catalog.json'));
const evidence = data('2.1/evidence.json');
function queues(heroes, goal, inventory = []) {
  const { profile } = parseProfile({
    characters: heroes.map(hero => ({ owned: true, ...hero })), inventory
  }, catalog);
  return investmentQueues(profile, buildPlan(profile, catalog, evidence, ['abx', 'wbl'].includes(goal) ? 'pve' : 'pvp', goal), evidence, goal);
}

test('purchases respect mode, existing costumes and seasonal availability', () => {
  const roster = [
    { name: 'Thor', tier: 'IV', level: 80, uniform: 'All-Father Reborn' },
    { name: 'Hulk', tier: 'IV', level: 80 },
    { name: 'Luna Snow', tier: 'III', level: 80 },
    { name: 'Jean Grey', tier: 'III', level: 80 },
    { name: 'Sentry', tier: 'III', level: 70 },
    { name: 'Hela', tier: 'III', level: 70 }
  ];
  assert.equal(queues(roster, 'wbl').costumes[0].row.hero.name, 'Hulk');
  assert.equal(queues(roster, 'abx').costumes[0].row.hero.name, 'Luna Snow');
  const pvp = queues(roster, 'timeline');
  assert.equal(pvp.costumes[0].row.hero.name, 'Sentry');
  assert.deepEqual(pvp.costumes.map(x => x.row.hero.name), ['Sentry', 'Hela']);
  assert.equal(pvp.seasonal[0].row.hero.name, 'Jean Grey');
});

test('one free CTP goes to a compatible hero with a known empty slot', () => {
  const roster = [
    { name: 'Thor', level: 80, tier: 'IV', uniform: 'All-Father Reborn' },
    { name: 'Hulk', level: 80, tier: 'IV', uniform: "Marvel Studios' Spider-Man: Brand New Day", ctp: 'Нет' }
  ];
  const pve = queues(roster, 'wbl', [{ name: 'Rage', grade: 'Mighty', count: 1 }]);
  assert.deepEqual(pve.gear.filter(x => x.available).map(x => x.title), ['Rage → Hulk']);
});

test('published build references exist in the catalog', () => {
  for (const [id, , uniform, , , , sources] of evidence.builds) {
    const hero = catalog.byId.get(id);
    assert.ok(hero && (hero.base === uniform || hero.uniforms.some(u => u[0] === uniform)), id);
    assert.ok(sources.every(key => evidence.sources[key]));
  }
});
