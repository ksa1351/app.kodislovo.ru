const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const publishedId = "945eb6fa31fdfbf42ddc8a109e055a4f7d510021";

const controlIndex = read("control/index.html");
if (!controlIndex.includes(`control.html?assignment=${publishedId}`)) {
  throw new Error("Раздел контрольных не содержит ссылку на опубликованную работу");
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
