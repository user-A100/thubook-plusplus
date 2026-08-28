"use strict";

const LOCAL_PAGE_SIZE = 20;
let statisticsObserver = null;

async function openLibrary() {
  const response = await chrome.runtime.sendMessage({ type: "OPEN_LOCAL_LIBRARY" });
  if (!response?.ok) throw new Error(response?.error || "无法打开本地库管理页");
}

function createGlobalBadge(total) {
  if (document.getElementById("thu-local-library-badge")) return;
  const badge = document.createElement("button");
  badge.id = "thu-local-library-badge";
  badge.type = "button";
  badge.textContent = `本地点评库 · ${total}`;
  badge.title = "这些数据只在你的浏览器中显示";
  badge.addEventListener("click", () => openLibrary().catch(console.error));
  document.body.appendChild(badge);
}

function createHomeNotice(total) {
  const pageHead = document.querySelector(".page-head");
  if (!pageHead || document.getElementById("thu-local-home-note")) return;
  const notice = document.createElement("section");
  notice.id = "thu-local-home-note";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "本地点评库已启用";
  const text = document.createElement("span");
  text.textContent = `浏览器中有 ${total} 条备份；进入课程详情页时会自动补充缺失点评。`;
  copy.append(title, text);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "管理本地库";
  button.addEventListener("click", () => openLibrary().catch(console.error));
  notice.append(copy, button);
  pageHead.insertAdjacentElement("afterend", notice);
}

function waitForStatisticsPage() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const reviewTotal = document.getElementById("stat-review-total");
      const courseTotal = document.getElementById("stat-course-total");
      const reviewedTotal = document.getElementById("stat-course-reviewed");
      if (reviewTotal && courseTotal && reviewedTotal && courseTotal.textContent.trim() !== "0") {
        resolve({ reviewTotal, courseTotal, reviewedTotal });
        return;
      }
      if (Date.now() - startedAt > 8000) {
        resolve(reviewTotal && courseTotal && reviewedTotal ? { reviewTotal, courseTotal, reviewedTotal } : null);
        return;
      }
      setTimeout(check, 80);
    };
    check();
  });
}

async function updateStatisticsPage(reviews) {
  const elements = await waitForStatisticsPage();
  if (!elements) return;
  const [manifestResponse, indexResponse, currentIdResponse] = await Promise.all([
    fetch("/data/manifest.json", { cache: "no-store", credentials: "omit" }),
    fetch("/data/with_comment_index.json", { cache: "no-store", credentials: "omit" }),
    fetch(chrome.runtime.getURL("data/current-review-index.json")),
  ]);
  if (!manifestResponse.ok || !indexResponse.ok || !currentIdResponse.ok) return;

  const [manifest, index, currentIdIndex] = await Promise.all([
    manifestResponse.json(),
    indexResponse.json(),
    currentIdResponse.json(),
  ]);
  const localMissing = ReviewCore.subtractExistingReviewIds(
    reviews,
    currentIdIndex.review_ids,
  ).reviews;
  const reviewedCourseIds = new Set(
    Object.values(index.courses || {}).map((course) => String(course.sqid)),
  );
  localMissing.forEach((review) => reviewedCourseIds.add(String(review.courseId)));

  const values = new Map([
    [elements.reviewTotal, Number(manifest.total_reviews || 0) + localMissing.length],
    [elements.courseTotal, Number(manifest.total_courses || 0)],
    [elements.reviewedTotal, reviewedCourseIds.size],
  ]);
  statisticsObserver?.disconnect();
  values.forEach((value, element) => {
    if (!element.dataset.thuLocalOriginal) element.dataset.thuLocalOriginal = element.textContent.trim();
    element.dataset.thuLocalValue = String(value);
    element.textContent = String(value);
  });
  statisticsObserver = new MutationObserver(() => {
    values.forEach((value, element) => {
      if (element.textContent !== String(value)) element.textContent = String(value);
    });
  });
  values.forEach((_value, element) => {
    statisticsObserver.observe(element, { childList: true, characterData: true, subtree: true });
  });

  document.getElementById("thu-local-stat-note")?.remove();
  const note = document.createElement("p");
  note.id = "thu-local-stat-note";
  note.textContent = `已计入本地补充 ${localMissing.length} 条点评；合并统计仅在此浏览器可见。`;
  document.querySelector(".stat-grid")?.insertAdjacentElement("afterend", note);
}

function makeArchiveCard(review) {
  const card = document.createElement("article");
  card.className = "thu-local-card";
  const rating = document.createElement("div");
  rating.className = "thu-local-rating";
  rating.textContent = `推荐指数：${review.rating}${review.score ? `　成绩：${review.score}` : ""}`;
  const comment = document.createElement("div");
  comment.className = "thu-local-comment";
  comment.textContent = review.comment;
  const meta = document.createElement("div");
  meta.className = "thu-local-meta";
  const source = document.createElement("span");
  source.textContent = "来自本地备份";
  const time = document.createElement("span");
  time.textContent = review.createdAt || "原时间未记录";
  meta.append(source, time);
  card.append(rating, comment, meta);
  return card;
}

function renderCourseArchive(localCount, missing) {
  document.getElementById("thu-local-archive")?.remove();
  document.querySelector(".thu-local-count-note")?.remove();
  const reviewList = document.getElementById("course-review-list");
  const pagination = document.getElementById("course-detail-pagination");
  const target = pagination || reviewList;
  if (!target) return;

  if (missing.length) {
    const countTitle = document.getElementById("review-count-title");
    if (countTitle) {
      const localNote = document.createElement("span");
      localNote.className = "thu-local-count-note";
      localNote.textContent = `＋ 本地补充 ${missing.length} 条`;
      countTitle.appendChild(localNote);
    }
  }

  const archive = document.createElement("section");
  archive.id = "thu-local-archive";
  const head = document.createElement("header");
  head.className = "thu-local-archive-head";
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = `本地备份补充（${missing.length} 条）`;
  const description = document.createElement("p");
  description.textContent = `本地库中本课程共有 ${localCount} 条；这里只显示公开页面中没有的记录。不会上传到网站。`;
  copy.append(title, description);
  const stamp = document.createElement("span");
  stamp.className = "thu-local-archive-stamp";
  stamp.textContent = "LOCAL ONLY";
  head.append(copy, stamp);
  archive.appendChild(head);

  if (!missing.length) {
    const empty = document.createElement("div");
    empty.className = "thu-local-empty";
    empty.textContent = "本地库已启用；这门课程暂未发现需要补充显示的点评。";
    archive.appendChild(empty);
  } else {
    let visible = 0;
    const appendNext = () => {
      const next = missing.slice(visible, visible + LOCAL_PAGE_SIZE);
      next.forEach((review) => archive.insertBefore(makeArchiveCard(review), more));
      visible += next.length;
      more.textContent = `继续显示（剩余 ${missing.length - visible} 条）`;
      more.style.display = visible < missing.length ? "block" : "none";
    };
    const more = document.createElement("button");
    more.type = "button";
    more.className = "thu-local-more";
    more.addEventListener("click", appendNext);
    archive.appendChild(more);
    appendNext();
  }
  target.insertAdjacentElement("afterend", archive);
}

async function loadOnlineReviews(courseId) {
  const response = await fetch(`/data/courses/${encodeURIComponent(courseId)}.json`, { cache: "no-store", credentials: "omit" });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const document = await response.json();
  return document.results || document.reviews || [];
}

async function renderForCurrentPage(reviews) {
  createGlobalBadge(reviews.length);
  const path = location.pathname;
  if (path.endsWith("/thucourse/") || path.endsWith("/thucourse/index.html") || path.endsWith("/thucourse/index")) {
    createHomeNotice(reviews.length);
  }
  if (path.endsWith("/statistics.html") || path.endsWith("/statistics")) {
    await updateStatisticsPage(reviews);
  }
  if (!path.endsWith("/course.html") && !path.endsWith("/course")) return;
  const courseId = new URLSearchParams(location.search).get("sqid");
  if (!courseId) return;
  const localReviews = reviews.filter((review) => String(review.courseId) === String(courseId));
  if (!localReviews.length) return;
  const onlineReviews = await loadOnlineReviews(courseId);
  const missing = ReviewCore.findMissingReviews(courseId, localReviews, onlineReviews)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  renderCourseArchive(localReviews.length, missing);
}

function removeLocalElements() {
  statisticsObserver?.disconnect();
  statisticsObserver = null;
  for (const id of ["thu-local-library-badge", "thu-local-home-note", "thu-local-archive", "thu-local-stat-note"]) document.getElementById(id)?.remove();
  document.querySelectorAll("[data-thu-local-original]").forEach((element) => {
    element.textContent = element.dataset.thuLocalOriginal;
    delete element.dataset.thuLocalOriginal;
    delete element.dataset.thuLocalValue;
  });
  document.querySelector(".thu-local-count-note")?.remove();
}

async function initialize() {
  const stored = await chrome.storage.local.get(["reviews", "settings"]);
  const reviews = stored.reviews || [];
  const enabled = stored.settings?.enabled !== false;
  removeLocalElements();
  if (enabled && reviews.length) await renderForCurrentPage(reviews);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.reviews || changes.settings)) initialize().catch(console.error);
});
initialize().catch((error) => console.error("[THU Local Review Library]", error));
