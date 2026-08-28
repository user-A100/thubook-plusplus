"use strict";

const state = { reviews: [], idMap: {}, meta: {}, settings: { enabled: true, dedupeOnImport: true } };
const $ = (id) => document.getElementById(id);

async function loadState() {
  const stored = await chrome.storage.local.get(["reviews", "idMap", "meta", "settings"]);
  state.reviews = stored.reviews || [];
  state.idMap = stored.idMap || {};
  state.meta = stored.meta || {};
  state.settings = { ...state.settings, ...(stored.settings || {}) };
  $("enabled-toggle").checked = state.settings.enabled;
  $("dedupe-toggle").checked = state.settings.dedupeOnImport !== false;
  render();
}

async function persist() {
  await chrome.storage.local.set({ reviews: state.reviews, idMap: state.idMap, meta: state.meta, settings: state.settings });
}

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
}

function render() {
  $("review-count").textContent = state.reviews.length;
  $("course-count").textContent = new Set(state.reviews.map((review) => String(review.courseId))).size;
  $("enabled-status").textContent = state.settings.enabled && state.reviews.length ? "已启用" : "未启用";
  $("enabled-status").style.color = state.settings.enabled && state.reviews.length ? "var(--green)" : "";
  const duplicateSuffix = state.meta.existingCount ? ` · 跳过现存 ${state.meta.existingCount}` : "";
  $("source-name").textContent = state.meta.sourceLabel ? `${state.meta.sourceLabel}${duplicateSuffix}` : "尚未导入";
  $("enabled-toggle").disabled = state.reviews.length === 0;
  renderRecords();
}

function renderRecords() {
  const query = ReviewCore.normalizeWhitespace($("search-input").value).toLowerCase();
  const filtered = query
    ? state.reviews.filter((review) =>
        [review.courseName, review.courseTeacher, review.comment, review.score, review.courseId]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : state.reviews;
  const shown = filtered.slice(0, 250);
  const body = $("records-body");
  body.replaceChildren();

  for (const review of shown) {
    const row = document.createElement("tr");
    const courseCell = document.createElement("td");
    const name = document.createElement("span");
    name.className = "course-name";
    name.textContent = review.courseName || `课程 #${review.courseId}`;
    const meta = document.createElement("span");
    meta.className = "course-meta";
    meta.textContent = `${review.courseTeacher || "教师未知"} · ID ${review.courseId}`;
    courseCell.append(name, meta);
    const ratingCell = document.createElement("td");
    ratingCell.className = "rating";
    ratingCell.textContent = String(review.rating);
    const commentCell = document.createElement("td");
    const comment = document.createElement("span");
    comment.className = "comment-preview";
    comment.textContent = review.comment;
    comment.title = review.comment;
    commentCell.appendChild(comment);
    const timeCell = document.createElement("td");
    timeCell.textContent = review.createdAt || "未记录";
    row.append(courseCell, ratingCell, commentCell, timeCell);
    body.appendChild(row);
  }

  $("empty-state").style.display = state.reviews.length ? "none" : "block";
  $("records-limit").textContent = filtered.length > shown.length ? `显示前 ${shown.length} / ${filtered.length} 条` : filtered.length ? `共 ${filtered.length} 条` : "";
}

async function applyDocuments(documents, sourceLabel, currentIndex = { review_ids: [], total_reviews: 0 }) {
  const result = ReviewCore.normalizeImport(documents);
  if (!result.reviews.length) {
    $("import-note").textContent = "没有找到可用点评。请选择完整备份 JSON。";
    return;
  }
  const rawCount = result.reviews.length;
  state.settings.dedupeOnImport = $("dedupe-toggle").checked;
  const compared = state.settings.dedupeOnImport
    ? ReviewCore.subtractExistingReviewIds(result.reviews, currentIndex.review_ids)
    : { reviews: result.reviews, existingCount: 0 };
  state.reviews = compared.reviews;
  state.idMap = result.idMap;
  state.settings.enabled = true;
  state.meta = {
    importedAt: new Date().toISOString(),
    sourceFiles: documents.map((document) => document.name),
    sourceLabel,
    rawCount,
    existingCount: compared.existingCount,
    siteSnapshotCount: Number(currentIndex.total_reviews || 0),
    dedupeOnImport: state.settings.dedupeOnImport,
    invalidCount: result.invalid.length,
  };
  await persist();
  $("enabled-toggle").checked = true;
  $("import-note").textContent = [
    state.settings.dedupeOnImport
      ? `备份有效 ${rawCount} 条；公开索引 ${Number(currentIndex.total_reviews || 0)} 条，其中重合 ${compared.existingCount} 条；实际补载 ${state.reviews.length} 条。`
      : `已载入 ${state.reviews.length} 条；本次未排除网站现存点评。`,
    `无效 ${result.invalid.length} 条。`,
    ...result.warnings,
  ].join("\n");
  render();
}

async function loadCurrentIndex() {
  const response = await fetch(chrome.runtime.getURL("data/current-review-index.json"));
  if (!response.ok) throw new Error(`读取网站现存 ID 索引失败（HTTP ${response.status}）`);
  return response.json();
}

async function importFiles(files) {
  if (!files.length) return;
  const documents = [];
  const errors = [];
  for (const file of files) {
    try {
      documents.push({ name: file.name, value: JSON.parse(await file.text()) });
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  const currentIndex = await loadCurrentIndex();
  await applyDocuments(
    documents,
    files.length === 1 ? files[0].name : `${files.length} 个本地文件`,
    currentIndex,
  );
  if (errors.length) $("import-note").textContent += `\n${errors.join("\n")}`;
}

function exportLibrary() {
  if (!state.reviews.length) return;
  const rows = state.reviews.map((review) => ({
    id: review.sourceId,
    course: { id: review.courseId, name: review.courseName, teacher: review.courseTeacher },
    rating: review.rating,
    comment: review.comment,
    created_at: review.createdAt,
    score: review.score,
  }));
  const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `thucourse-local-library-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearLibrary() {
  if (!confirm("清除浏览器中保存的本地点评库？网站数据不会受到影响。")) return;
  await chrome.storage.local.clear();
  state.reviews = [];
  state.idMap = {};
  state.meta = {};
  state.settings = { enabled: true, dedupeOnImport: true };
  $("enabled-toggle").checked = false;
  $("dedupe-toggle").checked = true;
  $("import-note").textContent = "本地点评库已清除。";
  render();
}

$("backup-files").addEventListener("change", (event) => importFiles([...event.target.files]));
$("dedupe-toggle").addEventListener("change", async (event) => {
  state.settings.dedupeOnImport = event.target.checked;
  await persist();
  toast("现存数据比对设置将在下一次载入备份时生效。 ");
});
$("enabled-toggle").addEventListener("change", async (event) => {
  state.settings.enabled = event.target.checked;
  await persist();
  render();
  toast(state.settings.enabled ? "本地补显已启用，刷新课程页面即可看到。" : "本地补显已停用。 ");
});
$("open-site-button").addEventListener("click", () => window.open("https://thubook.help/thucourse/", "_blank", "noopener"));
$("search-input").addEventListener("input", renderRecords);
$("export-button").addEventListener("click", exportLibrary);
$("clear-button").addEventListener("click", clearLibrary);

loadState().catch((error) => { $("import-note").textContent = `读取本地库失败：${error.message}`; });
