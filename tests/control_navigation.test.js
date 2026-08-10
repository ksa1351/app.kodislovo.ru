"use strict";

const assert = require("node:assert/strict");
const navigation = require("../control/control_navigation.js");

const tasks = [
  { id: 1, kimNumber: 2 },
  { id: 2, kimNumber: 3 },
  { id: 3, kimNumber: 2 },
  { id: 4, kimNumber: 3 },
];
const meta = {
  examFormat: "",
  texts: {
    T1: { title: "Текст 1", range: [1, 2], rangeKim: [2, 3], html: "<p>Первый</p>" },
    T2: { title: "Текст 2", range: [3, 4], rangeKim: [2, 3], html: "<p>Второй</p>" },
  },
};

const blocks = navigation.getTextRanges(meta);
assert.equal(navigation.findBlockForTask(blocks, tasks[0]).key, "T1");
assert.equal(navigation.findBlockForTask(blocks, tasks[3]).key, "T2");

assert.equal(navigation.isTextPracticeMode({ kind: "trainer" }, meta, blocks, tasks), true);
assert.equal(navigation.isTextPracticeMode({}, { ...meta, composed: true }, blocks, tasks), true);
assert.equal(
  navigation.isTextPracticeMode({ kind: "trainer" }, { ...meta, examFormat: "oge" }, blocks, tasks),
  false
);

const units = navigation.buildNavigationUnits(tasks, blocks, true);
assert.equal(units.length, 2);
assert.deepEqual(units.map((unit) => unit.label), ["1", "2"]);
assert.deepEqual(units[0].taskIndices, [0, 1]);
assert.deepEqual(units[1].taskIndices, [2, 3]);
assert.equal(units[0].ariaLabel, "Текст 1, задания 2 и 3");
assert.equal(navigation.findUnitIndex(units, 3), 1);

assert.equal(navigation.getUnitAnswerState(units[0], tasks, {}), "empty");
assert.equal(navigation.getUnitAnswerState(units[0], tasks, { "1": "ответ" }), "partial");
assert.equal(
  navigation.getUnitAnswerState(units[0], tasks, { "1": "ответ", "2": "ответ" }),
  "answered"
);

console.log("control_navigation: ok");
