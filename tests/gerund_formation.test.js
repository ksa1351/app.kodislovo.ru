"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../trainers/russian/gerund-formation/gerund-formation-core.js");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const bank = JSON.parse(read("trainers/russian/gerund-formation/tasks.json"));
const tasks = bank.tasks;

assert.equal(bank.schema, "kodislovo.gerund-formation.tasks.v1");
assert.ok(Array.isArray(tasks));
assert.ok(tasks.length >= 24, "В банке должно быть не менее 24 заданий");

const ids = new Set();
for (const task of tasks) {
  assert.ok(task.id && !ids.has(task.id), `Повторяющийся или пустой id: ${task.id}`);
  ids.add(task.id);
  assert.ok([1, 2, 3, 4].includes(task.level), `${task.id}: неизвестный уровень`);
  assert.ok(task.verb && task.aspect, `${task.id}: не заполнены данные глагола`);
  assert.ok(Array.isArray(task.answers) && task.answers.length, `${task.id}: нет ответа`);
  assert.ok(task.rule && task.explanation, `${task.id}: нет объяснения`);
  assert.equal(core.checkAnswer(task, task.answers[0]), true, `${task.id}: эталон не проходит проверку`);
}

assert.equal(core.normalizeAnswer("  РЕШИВ  "), "решив");
assert.equal(core.checkAnswer({ answers: ["лёжа"] }, "ЛЕЖА"), true);
assert.equal(core.checkAnswer({ answers: ["придя"] }, "прийдя"), false);

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
const sharedUi = read("assets/css/ui.css");
assert.ok(home.includes('href="./trainers/russian/gerund-formation/"'));
assert.ok(russianIndex.includes('href="./gerund-formation/"'));
assert.ok(sectionPage.includes('id="gerundFormationLink"'));
assert.ok(sectionScript.includes('key === "grade-7"'));
assert.ok(sharedUi.includes("[hidden] { display: none !important; }"));

console.log("gerund_formation: ok");
