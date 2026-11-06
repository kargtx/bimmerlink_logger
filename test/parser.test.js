const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseBimmerlinkCsv, recordedAtFromFilename, detectDelimiter } = require('../src/parser');

const FIXTURE = path.join(__dirname, '..', 'fixtures', '2026-05-09_23-32-53.csv');

test('разбирает реальный лог BimmerLink', () => {
  const p = parseBimmerlinkCsv(fs.readFileSync(FIXTURE), { filename: path.basename(FIXTURE) });
  assert.equal(p.rowCount, 111);
  assert.equal(p.channels.length, 16);
  assert.equal(p.recordedAt, '2026-05-09T23:32:53');
  assert.ok(Math.abs(p.duration - 14.926) < 1e-9);
  const coolant = p.channels.find((c) => c.sourceName === 'Coolant temperature');
  assert.equal(coolant.name, 'Температура ОЖ');
  assert.equal(coolant.unit, '°C');
  assert.equal(coolant.min, 78, 'ведущие нули не попадают в минимум');
  assert.equal(coolant.max, 87);
  const rpm = p.channels.find((c) => c.sourceName === 'Engine speed');
  assert.equal(rpm.max, 5801.5);
});

test('ведущие «0» до первого опроса — пропуски, а «0.00» — настоящий ноль', () => {
  const csv = 'Time,"A","B"\n0.0,0,0\n0.1,0,0.00\n0.2,5.00,0.00\n0.3,5.00,3.00\n';
  const p = parseBimmerlinkCsv(csv);
  assert.deepEqual(p.series[0], [null, null, 5, 5]);
  assert.deepEqual(p.series[1], [null, 0, 0, 3]);
});

test('колонка без дробных чисел: пропусками считаются ведущие нули', () => {
  const p = parseBimmerlinkCsv('Time,A\n0,0\n1,0\n2,7\n3,0\n');
  assert.deepEqual(p.series[0], [null, null, 7, 0]);
});

test('кавычки с запятой, BOM и CRLF', () => {
  const csv = '﻿Time,"Pressure, rail","B"\r\n0.0,1.50,2.00\r\n0.1,1.60,2.10\r\n';
  const p = parseBimmerlinkCsv(csv);
  assert.equal(p.channels[0].sourceName, 'Pressure, rail');
  assert.deepEqual(p.series[0], [1.5, 1.6]);
});

test('разделитель «;» и десятичная запятая', () => {
  const p = parseBimmerlinkCsv('Time;A\n0,0;1,50\n0,5;2,25\n');
  assert.deepEqual(p.time, [0, 0.5]);
  assert.deepEqual(p.series[0], [1.5, 2.25]);
});

test('битые строки пропускаются с предупреждением', () => {
  const p = parseBimmerlinkCsv('Time,A\n0,1.0\nabc,2.0\n1,3.0\n');
  assert.equal(p.rowCount, 2);
  assert.match(p.warnings[0], /Пропущено строк/);
});

test('ошибки на пустом и неподходящем файле', () => {
  assert.throws(() => parseBimmerlinkCsv(''), /пустой/);
  assert.throws(() => parseBimmerlinkCsv('Time,A\n'), /нет строк/);
  assert.throws(() => parseBimmerlinkCsv('just text\nmore'), /меньше двух колонок/);
});

test('вспомогательные функции', () => {
  assert.equal(recordedAtFromFilename('log.csv'), null);
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('a\tb'), '\t');
});
