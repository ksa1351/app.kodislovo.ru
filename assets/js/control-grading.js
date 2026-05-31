/**
 * Kodislovo control grading — ОГЭ (9 класс) и ЕГЭ (11 класс).
 * Подключать до control_core.js и в учительской панели.
 */
(function (global) {
  "use strict";

  const PRESETS = {
    oge: {
      examFormat: "oge",
      gradeLevel: 9,
      label: "ОГЭ",
      grading: {
        type: "points",
        scale: [
          { from: 8, to: 9, mark: 5 },
          { from: 6, to: 7, mark: 4 },
          { from: 4, to: 5, mark: 3 },
          { from: 0, to: 3, mark: 2 },
        ],
      },
      hint: "ОГЭ 2026: часть 2 КИМ · тренажёр · перевод по сумме баллов",
    },
    ege: {
      examFormat: "ege",
      gradeLevel: 11,
      label: "ЕГЭ",
      grading: {
        type: "percent",
        scale: { 5: 87, 4: 67, 3: 42, 2: 0 },
      },
      hint: "ЕГЭ 2026: выборка части 1 · перевод по процентам",
    },
  };

  function normalizeGrading(meta, entry) {
    const fromMeta = meta?.grading;
    if (fromMeta && typeof fromMeta === "object") {
      if (fromMeta.type === "points" && Array.isArray(fromMeta.scale)) {
        return { type: "points", scale: fromMeta.scale.slice() };
      }
      if (fromMeta.type === "percent" || (!fromMeta.type && !Array.isArray(fromMeta.scale))) {
        const scale = fromMeta.scale && typeof fromMeta.scale === "object" && !Array.isArray(fromMeta.scale)
          ? { ...fromMeta.scale }
          : { ...(fromMeta["5"] != null ? fromMeta : { 5: 87, 4: 67, 3: 42, 2: 0 }) };
        return { type: "percent", scale };
      }
    }

    const format = safeText(meta?.examFormat || entry?.examFormat).toLowerCase();
    if (format === "oge" || format === "ege") {
      return deepClone(PRESETS[format].grading);
    }

    return deepClone(PRESETS.ege.grading);
  }

  function safeText(value) {
    return (value ?? "").toString().trim();
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function markFromScore(earned, maxPoints, meta, entry) {
    const grading = normalizeGrading(meta, entry);
    const earnedPts = Math.max(0, Number(earned) || 0);
    const maxPts = Math.max(0, Number(maxPoints) || 0);

    if (grading.type === "points") {
      const rows = grading.scale
        .map((row) => ({
          from: Number(row.from),
          to: Number(row.to),
          mark: Number(row.mark),
        }))
        .filter((row) => Number.isFinite(row.from) && Number.isFinite(row.to) && Number.isFinite(row.mark))
        .sort((a, b) => b.from - a.from);

      for (const row of rows) {
        if (earnedPts >= row.from && earnedPts <= row.to) return row.mark;
      }
      return 2;
    }

    const percent = maxPts > 0 ? Math.round((earnedPts / maxPts) * 100) : 0;
    const scale = grading.scale || {};
    const thresholds = [5, 4, 3, 2]
      .filter((mark) => scale[String(mark)] != null || scale[mark] != null)
      .sort((a, b) => b - a);

    for (const mark of thresholds) {
      const threshold = Number(scale[String(mark)] ?? scale[mark]);
      if (percent >= threshold) return mark;
    }
    return 2;
  }

  function formatGradingHint(meta, entry) {
    const grading = normalizeGrading(meta, entry);
    if (grading.type === "points") {
      const parts = grading.scale
        .slice()
        .sort((a, b) => Number(b.mark) - Number(a.mark))
        .map((row) => `${row.mark} — ${row.from}–${row.to} б.`);
      return `Оценивание: ${parts.join("; ")}`;
    }
    const s = grading.scale;
    return `Оценивание: 5 от ${s[5] ?? s["5"]}%, 4 от ${s[4] ?? s["4"]}%, 3 от ${s[3] ?? s["3"]}%`;
  }

  function getPreset(format) {
    const key = safeText(format).toLowerCase();
    return PRESETS[key] ? deepClone(PRESETS[key]) : null;
  }

  global.KodislovoControlGrading = {
    PRESETS,
    normalizeGrading,
    markFromScore,
    formatGradingHint,
    getPreset,
  };
})(typeof window !== "undefined" ? window : globalThis);
