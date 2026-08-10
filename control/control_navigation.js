(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.KodislovoControlNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function safeText(value) {
    return (value ?? "").toString().trim();
  }

  function getTaskKimId(task) {
    const kim = Number(task?.kimNumber);
    if (Number.isFinite(kim)) return kim;
    const sourceTaskId = Number(task?.source?.taskId);
    if (Number.isFinite(sourceTaskId)) return sourceTaskId;
    return Number(task?.id);
  }

  function getTextRanges(meta) {
    const texts = meta?.texts || {};
    const blocks = Object.entries(texts)
      .map(([key, text]) => {
        const range = Array.isArray(text?.range) ? text.range : null;
        const from = range ? Number(range[0]) : NaN;
        const to = range ? Number(range[1]) : NaN;
        const rangeKim = Array.isArray(text?.rangeKim)
          ? text.rangeKim.map((value) => Number(value))
          : null;
        return {
          key,
          title: text?.title || "Текст",
          from,
          to,
          html: text?.html || "",
          rangeKim: rangeKim && rangeKim.length === 2 ? rangeKim : null,
        };
      })
      .filter((block) => Number.isFinite(block.from) && Number.isFinite(block.to) && block.html);

    blocks.sort((left, right) => left.from - right.from);
    return blocks;
  }

  function findBlockForTask(blocks, task) {
    if (!task) return null;
    const displayId = Number(task.id);

    // В составных тренажёрах у всех текстов может быть одинаковый rangeKim
    // (например, 2–3). Поэтому сначала сопоставляем фактический диапазон
    // заданий в собранной работе и лишь затем используем номер КИМ как fallback.
    if (Number.isFinite(displayId)) {
      const byDisplayRange = blocks.find(
        (block) => displayId >= block.from && displayId <= block.to
      );
      if (byDisplayRange) return byDisplayRange;
    }

    const kimId = getTaskKimId(task);
    return blocks.find((block) => {
      if (Number.isFinite(block.from) && Number.isFinite(block.to)) return false;
      const range = block.rangeKim;
      if (!Array.isArray(range) || range.length !== 2) return false;
      return kimId >= Number(range[0]) && kimId <= Number(range[1]);
    }) || null;
  }

  function isTextPracticeMode(variant, meta, blocks, tasks) {
    const explicitMode = safeText(
      meta?.navigationMode || meta?.presentationMode || variant?.navigationMode
    ).toLowerCase();
    if (["text", "texts", "text-groups", "text-practice"].includes(explicitMode)) return true;
    if (["task", "tasks", "exam", "exam-tasks"].includes(explicitMode)) return false;

    const examFormat = safeText(meta?.examFormat || variant?.examFormat).toLowerCase();
    if (examFormat === "oge" || examFormat === "ege") return false;
    const kind = safeText(variant?.kind).toLowerCase();
    if (kind && kind !== "trainer") return false;
    if (!kind && !meta?.composed) return false;
    if (!Array.isArray(tasks) || !tasks.length || !Array.isArray(blocks) || !blocks.length) return false;

    const coveredTasks = tasks.filter((task) => findBlockForTask(blocks, task)).length;
    const groupedBlocks = blocks.filter((block) => {
      const taskCount = tasks.filter((task) => findBlockForTask([block], task)).length;
      return taskCount > 1;
    }).length;
    return coveredTasks === tasks.length && groupedBlocks > 0;
  }

  function buildNavigationUnits(tasks, blocks, textPractice) {
    if (!textPractice) {
      return tasks.map((task, index) => ({
        key: `task:${task.id}`,
        label: String(task.id),
        ariaLabel: `Задание ${task.id}`,
        taskIndices: [index],
        block: findBlockForTask(blocks, task),
      }));
    }

    const units = [];
    const unitsByBlock = new Map();
    tasks.forEach((task, index) => {
      const block = findBlockForTask(blocks, task);
      const blockKey = block ? `text:${block.key || `${block.from}-${block.to}`}` : `task:${task.id}`;
      let unit = unitsByBlock.get(blockKey);
      if (!unit) {
        unit = {
          key: blockKey,
          label: String(units.length + 1),
          ariaLabel: "",
          taskIndices: [],
          block,
        };
        unitsByBlock.set(blockKey, unit);
        units.push(unit);
      }
      unit.taskIndices.push(index);
    });

    units.forEach((unit, index) => {
      const taskNumbers = unit.taskIndices
        .map((taskIndex) => getTaskKimId(tasks[taskIndex]))
        .filter((value, position, values) => Number.isFinite(value) && values.indexOf(value) === position);
      const suffix = taskNumbers.length ? `, задания ${taskNumbers.join(" и ")}` : "";
      unit.ariaLabel = `Текст ${index + 1}${suffix}`;
    });
    return units;
  }

  function findUnitIndex(units, taskIndex) {
    const index = units.findIndex((unit) => unit.taskIndices.includes(taskIndex));
    return index >= 0 ? index : 0;
  }

  function getUnitAnswerState(unit, tasks, answers) {
    const answered = unit.taskIndices.filter((taskIndex) => {
      const task = tasks[taskIndex];
      return safeText(answers?.[String(task?.id)]).length > 0;
    }).length;
    if (answered === 0) return "empty";
    if (answered === unit.taskIndices.length) return "answered";
    return "partial";
  }

  return {
    buildNavigationUnits,
    findBlockForTask,
    findUnitIndex,
    getTaskKimId,
    getTextRanges,
    getUnitAnswerState,
    isTextPracticeMode,
  };
});
