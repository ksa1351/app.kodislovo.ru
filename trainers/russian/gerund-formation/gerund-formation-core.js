(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.KodislovoGerundFormation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeAnswer(value) {
    return (value ?? "")
      .toString()
      .trim()
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ");
  }

  function checkAnswer(task, value) {
    const normalized = normalizeAnswer(value);
    if (!normalized || !Array.isArray(task?.answers)) return false;
    return task.answers.some((answer) => normalizeAnswer(answer) === normalized);
  }

  function shuffle(items, random) {
    const result = items.slice();
    const rng = typeof random === "function" ? random : Math.random;
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(rng() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function createSession(tasks, perLevel, random) {
    const limit = Number.isFinite(perLevel) ? Math.max(1, perLevel) : 4;
    const levels = [...new Set(tasks.map((task) => Number(task.level)))].sort((a, b) => a - b);
    return levels.flatMap((level) => {
      const group = tasks.filter((task) => Number(task.level) === level);
      return shuffle(group, random).slice(0, Math.min(limit, group.length));
    });
  }

  function calculateSummary(taskIds, results) {
    const total = Array.isArray(taskIds) ? taskIds.length : 0;
    const values = taskIds.map((id) => results?.[id]).filter(Boolean);
    const answered = values.length;
    const correct = values.filter((item) => item.correct).length;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    return { total, answered, correct, incorrect: Math.max(0, answered - correct), percent };
  }

  return {
    normalizeAnswer,
    checkAnswer,
    createSession,
    calculateSummary,
  };
});
