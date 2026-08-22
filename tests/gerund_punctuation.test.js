"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../trainers/russian/gerund-punctuation/gerund-punctuation-core.js");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const bank = JSON.parse(read("trainers/russian/gerund-punctuation/tasks.json"));
const tasks = bank.tasks;

assert.equal(bank.schema, "kodislovo.gerund-punctuation.tasks.v1");
assert.ok(Array.isArray(tasks));
assert.ok(tasks.length >= 24, "В банке должно быть не менее 24 предложений");

const ids = new Set();
for (const task of tasks) {
  assert.ok(task.id && !ids.has(task.id), `Повторяющийся или пустой id: ${task.id}`);
  ids.add(task.id);
  assert.ok([1, 2, 3, 4].includes(task.level), `${task.id}: неизвестный уровень`);
  assert.ok(Array.isArray(task.words) && task.words.length >= 3, `${task.id}: нет предложения`);
  assert.ok(Array.isArray(task.commaAfter), `${task.id}: нет схемы запятых`);
  task.commaAfter.forEach((index) => {
    assert.ok(Number.isInteger(index) && index >= 0 && index < task.words.length - 1, `${task.id}: неверная позиция ${index}`);
  });
  assert.ok(task.rule && task.explanation, `${task.id}: нет объяснения`);
  assert.equal(core.checkSelection(task, task.commaAfter), true, `${task.id}: эталон не проходит проверку`);
  assert.equal(core.buildSentence(task, task.commaAfter), task.explanation, `${task.id}: объяснение не совпадает с эталоном`);
}

assert.deepEqual(core.normalizeSelection([3, 1, 3, "2"]), [1, 2, 3]);
assert.equal(core.checkSelection({ commaAfter: [0, 3] }, [3, 0]), true);
assert.equal(core.checkSelection({ commaAfter: [] }, []), true);
assert.equal(core.checkSelection({ commaAfter: [1] }, []), false);
assert.equal(
  core.buildSentence({ words: ["Мальчик", "улыбнувшись", "вошёл"] }, [0, 1]),
  "Мальчик, улыбнувшись, вошёл."
);

const session = core.createSession(tasks, 4, () => 0.5);
assert.equal(session.length, 16);
for (const level of [1, 2, 3, 4]) {
  assert.equal(session.filter((task) => task.level === level).length, 4);
}

const summary = core.calculateSummary(["a", "b", "c"], {
  a: { correct: true },
  b: { correct: false },
  c: { correct: true },
});
assert.deepEqual(summary, { total: 3, answered: 3, correct: 2, incorrect: 1, percent: 67 });

const home = read("index.html");
const russianIndex = read("trainers/russian/index.html");
const sectionPage = read("trainers/russian/trainer.html");
const sectionScript = read("trainers/russian/trainer.js");
assert.ok(home.includes('href="./trainers/russian/gerund-punctuation/"'));
assert.ok(russianIndex.includes('href="./gerund-punctuation/"'));
assert.ok(sectionPage.includes('id="gerundPunctuationLink"'));
assert.ok(sectionScript.includes("gerundPunctuationLink.hidden = false"));

console.log("gerund_punctuation: ok");
