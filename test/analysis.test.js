const test = require('node:test');
const assert = require('node:assert/strict');
const { sliceAndDownsample } = require('../src/downsample');
const { findSprints, findAlarms } = require('../src/detect');

test('без прореживания возвращает срез с одной точкой запаса по краям', () => {
  const time = [0, 1, 2, 3, 4, 5, 6];
  const r = sliceAndDownsample(time, [[1, 2, 3, 4, 5, 6, 7]], { from: 2, to: 4, points: 1000 });
  assert.equal(r.downsampled, false);
  assert.deepEqual(r.time, [1, 2, 3, 4, 5]);
  assert.deepEqual(r.series[0], [2, 3, 4, 5, 6]);
});

test('прореживание сохраняет пики', () => {
  const n = 100000;
  const time = Array.from({ length: n }, (_, i) => i * 0.1);
  const values = Array.from({ length: n }, (_, i) => (i === 54321 ? 999 : Math.sin(i / 100)));
  const r = sliceAndDownsample(time, [values], { points: 1000 });
  assert.equal(r.downsampled, true);
  assert.ok(r.time.length <= 1000);
  assert.equal(Math.max(...r.series[0]), 999);
});

test('находит разгон 0–100 и 100–200', () => {
  const time = [];
  const speed = [];
  for (let i = 0; i <= 300; i++) {
    time.push(i * 0.1);
    speed.push(Math.min(210, i)); // 10 км/ч в секунду
  }
  const sprints = findSprints(time, speed);
  const s0 = sprints.find((s) => s.label === '0–100 км/ч');
  const s1 = sprints.find((s) => s.label === '100–200 км/ч');
  assert.ok(Math.abs(s0.value - 10) < 0.2);
  assert.ok(Math.abs(s1.value - 10) < 0.2);
});

test('разгон с отпущенным газом не засчитывается', () => {
  const time = [0, 1, 2, 3, 4, 5];
  const speed = [0, 40, 80, 50, 90, 110];
  const sprints = findSprints(time, speed).filter((s) => s.label === '0–100 км/ч');
  assert.equal(sprints.length, 0);
});

test('пороги тревоги', () => {
  const time = [0, 1, 2, 3, 4];
  const alarms = findAlarms(
    time,
    [{ idx: 0, name: 'Масло', unit: '°C', warn: 120, sourceName: 'oil' }],
    [[100, 121, 125, 110, 100]]
  );
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].value, 125);
  assert.equal(alarms[0].from, 1);
});
