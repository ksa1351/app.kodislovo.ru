const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const controlIndex = read("control/index.html");
if (!controlIndex.includes('id="publishedControls"') || !controlIndex.includes("control_catalog.js?v=1")) {
  throw new Error("Раздел контрольных не подключает автоматический каталог");
}
if (/control\.html\?assignment=[a-z0-9]{20,}/i.test(controlIndex)) {
  throw new Error("Опубликованные работы не должны быть прописаны в HTML вручную");
}

const catalogScript = read("control/control_catalog.js");
if (!catalogScript.includes("/api/public/assignments")) {
  throw new Error("Каталог не загружает безопасный публичный список");
}
if (!catalogScript.includes('target.searchParams.set("assignment", id)')) {
  throw new Error("Карточки каталога не формируют assignment-ссылки");
}

const directoryLinks = [
  "trainers/russian/index.html",
  "trainers/russian/trainer.html",
  "trainers/informatics/index.html",
  "trainers/informatics/trainer.html",
];
for (const relativePath of directoryLinks) {
  const source = read(relativePath);
  if (!source.includes('href="../../control/"')) {
    throw new Error(`${relativePath}: ссылка должна вести в раздел опубликованных работ`);
  }
  if (/control\/control\.html\?subject=/.test(source)) {
    throw new Error(`${relativePath}: найдена устаревшая прямая ссылка на контрольную`);
  }
}

const routeFiles = [
  "routes/russian/7/prichastnyy-oborot.json",
  "routes/russian/8/obosoblennye-obstoyatelstva.json",
];
for (const relativePath of routeFiles) {
  const route = JSON.parse(read(relativePath));
  const controlStep = route.steps?.find((step) => step.type === "control");
  if (controlStep?.resource !== "/control/") {
    throw new Error(`${relativePath}: маршрут должен вести в раздел опубликованных работ`);
  }
}

const controlCore = read("control/control_core.js");
if (!controlCore.includes('subject !== "russian" || Boolean(assignmentPublicId)')) {
  throw new Error("В опубликованной работе должны быть скрыты устаревшие переключатели формата");
}

console.log("public_control_links: ok");
