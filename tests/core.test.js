const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

test("normalizes an old API review and applies the course id map", () => {
  const result = Core.normalizeReview(
    {
      id: 3419,
      course: { id: 31430, name: "英语听说交流（A）", teacher: "张老师" },
      rating: 5,
      comment: " 很好\r\n  推荐 ",
      created_at: "2026/06/09 19:34",
      score: "",
    },
    { 31430: 999 },
  );
  assert.equal(result.valid, true);
  assert.equal(result.review.originalCourseId, 31430);
  assert.equal(result.review.courseId, 999);
  assert.equal(result.review.comment, "很好\n推荐");
  assert.equal(result.review.score, null);
});

test("normalizes a single submission file where id is the course id", () => {
  const result = Core.normalizeImport([
    { name: "new_1.json", value: { id: 2165, rating: 5, comment: "值得选择", created_at: "2026/06/04 23:57" } },
  ]);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0].courseId, 2165);
  assert.equal(result.reviews[0].sourceId, null);
});

test("deduplicates formatting-only differences conservatively", () => {
  const first = Core.normalizeReview({ course: { id: 1 }, rating: 4, comment: "第一行\r\n第二行" }).review;
  const second = Core.normalizeReview({ course: { id: 1 }, rating: 4, comment: " 第一行\n 第二行 " }).review;
  assert.equal(first.fingerprint, second.fingerprint);
});

test("keeps distinct source reviews when text matches but metadata differs", () => {
  const result = Core.normalizeImport([
    {
      name: "backup.json",
      value: [
        { id: 1, course: { id: 42 }, rating: 5, comment: "相同正文", created_at: "2025/01/01 10:00", score: "A" },
        { id: 2, course: { id: 42 }, rating: 5, comment: "相同正文", created_at: "2025/01/02 10:00", score: "B" },
      ],
    },
  ]);
  assert.equal(result.reviews.length, 2);
  assert.equal(Core.contentFingerprint(result.reviews[0]), Core.contentFingerprint(result.reviews[1]));
  assert.notEqual(result.reviews[0].fingerprint, result.reviews[1].fingerprint);
});

test("content dedupe keeps the richer record for the same course and text", () => {
  const normalized = Core.normalizeImport([
    {
      name: "duplicates.json",
      value: [
        { id: 10, course: { id: 42, name: "课程" }, rating: 5, comment: "重复正文", created_at: "2025/01/02 10:00" },
        { id: 11, course: { id: 42, name: "课程", teacher: "教师" }, rating: 3, comment: " 重复正文 ", created_at: "2025/01/01 10:00", score: "A" },
        { id: 12, course: { id: 43, name: "另一门课" }, rating: 5, comment: "重复正文" },
      ],
    },
  ]);
  const deduped = Core.dedupeReviewsByContent(normalized.reviews);
  assert.equal(deduped.reviews.length, 2);
  assert.equal(deduped.duplicateCount, 1);
  assert.equal(deduped.reviews.find((review) => review.courseId === 42).sourceId, 11);
});

test("warns when an API response contains only one page", () => {
  const result = Core.normalizeImport([
    { name: "reviews.json", value: { count: 3390, results: [{ course: { id: 1 }, rating: 5, comment: "完整点评" }] } },
  ]);
  assert.equal(result.reviews.length, 1);
  assert.match(result.warnings[0], /1\/3390/);
});

test("finds only the local text multiplicity missing from the public page", () => {
  const local = [
    Core.normalizeReview({ id: 1, course: { id: 42 }, rating: 5, comment: "相同正文", created_at: "2025/01/01 10:00" }).review,
    Core.normalizeReview({ id: 2, course: { id: 42 }, rating: 5, comment: "相同正文", created_at: "2025/01/02 10:00" }).review,
    Core.normalizeReview({ id: 3, course: { id: 42 }, rating: 3, comment: "仅本地存在" }).review,
  ];
  const online = [{ rating: 1, comment: " 相同正文 " }];
  const missing = Core.findMissingReviews(42, local, online);
  assert.equal(missing.length, 2);
  assert.deepEqual(missing.map((review) => review.sourceId), [2, 3]);
});

test("does not overlay a public review again when only its metadata differs", () => {
  const local = [
    Core.normalizeReview({ id: 1, course: { id: 42 }, rating: 5, comment: "网站已有正文", created_at: "2025/01/01 10:00" }).review,
  ];
  const online = [{ rating: 2, comment: "网站已有正文", created_at: "2026/01/01 10:00", score: "不同" }];
  assert.deepEqual(Core.findMissingReviews(42, local, online), []);
});

test("subtracts the website subset by original review id without merging distinct rows", () => {
  const local = [
    Core.normalizeReview({ id: 1, course: { id: 42 }, rating: 5, comment: "正文 A" }).review,
    Core.normalizeReview({ id: 2, course: { id: 42 }, rating: 5, comment: "相同正文" }).review,
    Core.normalizeReview({ id: 3, course: { id: 42 }, rating: 5, comment: "相同正文" }).review,
  ];
  const existing = [
    Core.normalizeReview({ id: 1, course: { id: 42 }, rating: 1, comment: "网站版本正文可能有变化" }).review,
  ];
  const result = Core.subtractExistingReviews(local, existing);
  assert.equal(result.existingCount, 1);
  assert.deepEqual(result.reviews.map((review) => review.sourceId), [2, 3]);
});

test("falls back to course and text when an imported review has no original id", () => {
  const local = [Core.normalizeReview({ id: 42, rating: 5, comment: "无点评 ID" }).review];
  const existing = [Core.normalizeReview({ id: 9, course: { id: 42 }, rating: 1, comment: "无点评 ID" }).review];
  const result = Core.subtractExistingReviews(local, existing);
  assert.equal(result.existingCount, 1);
  assert.deepEqual(result.reviews, []);
});

test("subtracts a public id index without needing review contents", () => {
  const local = [
    Core.normalizeReview({ id: 1, course: { id: 42 }, rating: 5, comment: "私人正文 A" }).review,
    Core.normalizeReview({ id: 2, course: { id: 43 }, rating: 4, comment: "私人正文 B" }).review,
  ];
  const result = Core.subtractExistingReviewIds(local, [1, 99]);
  assert.equal(result.existingCount, 1);
  assert.deepEqual(result.reviews.map((review) => review.sourceId), [2]);
});
