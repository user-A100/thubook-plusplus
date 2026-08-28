(function exposeReviewCore(root) {
  "use strict";

  const VALID_RATINGS = new Set([1, 2, 3, 4, 5]);

  function normalizeWhitespace(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeScore(value) {
    if (value === null || value === undefined) return null;
    const score = String(value).trim();
    return score === "" ? null : score;
  }

  function toCourseId(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : String(value).trim();
  }

  function mappedCourseId(courseId, idMap) {
    const original = toCourseId(courseId);
    if (original === null) return null;
    const mapped = idMap?.[String(original)];
    return toCourseId(mapped ?? original);
  }

  function hashString(value) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= code + i;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
    return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0)
      .toString(16)
      .padStart(8, "0")}`;
  }

  function contentFingerprint(review) {
    const canonical = [
      String(review.courseId ?? review.course?.id ?? ""),
      String(review.rating ?? ""),
      normalizeWhitespace(review.comment),
    ].join("\u241f");
    return hashString(canonical);
  }

  function duplicateContentKey(review) {
    const canonical = [
      String(review.courseId ?? review.course?.id ?? ""),
      normalizeWhitespace(review.comment),
    ].join("\u241f");
    return hashString(canonical);
  }

  function reviewCompleteness(review) {
    let score = 0;
    if (review.score !== null && review.score !== undefined && String(review.score).trim()) score += 4;
    if (review.createdAt) score += 2;
    if (review.courseName) score += 1;
    if (review.courseTeacher) score += 1;
    if (review.sourceId !== null && review.sourceId !== undefined) score += 1;
    return score;
  }

  function dedupeReviewsByContent(reviews) {
    const positions = new Map();
    const unique = [];
    for (const review of reviews) {
      const key = duplicateContentKey(review);
      if (!positions.has(key)) {
        positions.set(key, unique.length);
        unique.push(review);
        continue;
      }
      const index = positions.get(key);
      const current = unique[index];
      const candidateScore = reviewCompleteness(review);
      const currentScore = reviewCompleteness(current);
      const candidateIsBetter =
        candidateScore > currentScore ||
        (candidateScore === currentScore && String(review.createdAt || "") > String(current.createdAt || ""));
      if (candidateIsBetter) unique[index] = review;
    }
    return { reviews: unique, duplicateCount: reviews.length - unique.length };
  }

  function sourceIdentity(review) {
    const value = review.sourceId ?? review.id;
    return value === null || value === undefined || value === "" ? null : String(value);
  }

  function subtractExistingReviews(localReviews, existingReviews) {
    const used = new Uint8Array(existingReviews.length);
    const bySourceId = new Map();
    const byContent = new Map();
    const byContentWithoutSourceId = new Map();

    function addToBucket(map, key, index) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(index);
    }

    function takeUnused(map, key) {
      const bucket = map.get(key);
      while (bucket?.length) {
        const index = bucket.pop();
        if (!used[index]) {
          used[index] = 1;
          return true;
        }
      }
      return false;
    }

    existingReviews.forEach((review, index) => {
      const sourceId = sourceIdentity(review);
      if (sourceId !== null) addToBucket(bySourceId, sourceId, index);
      else addToBucket(byContentWithoutSourceId, duplicateContentKey(review), index);
      addToBucket(byContent, duplicateContentKey(review), index);
    });

    const reviews = [];
    let existingCount = 0;
    for (const review of localReviews) {
      const sourceId = sourceIdentity(review);
      const matched = sourceId !== null
        ? takeUnused(bySourceId, sourceId) || takeUnused(byContentWithoutSourceId, duplicateContentKey(review))
        : takeUnused(byContent, duplicateContentKey(review));
      if (matched) existingCount += 1;
      else reviews.push(review);
    }
    return { reviews, existingCount };
  }

  function subtractExistingReviewIds(localReviews, existingIds) {
    const counts = new Map();
    for (const id of existingIds || []) {
      const key = id === null || id === undefined || id === "" ? null : String(id);
      if (key !== null) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const reviews = [];
    let existingCount = 0;
    for (const review of localReviews) {
      const key = sourceIdentity(review);
      const count = key === null ? 0 : counts.get(key) || 0;
      if (count > 0) {
        counts.set(key, count - 1);
        existingCount += 1;
      } else {
        reviews.push(review);
      }
    }
    return { reviews, existingCount };
  }

  function fingerprint(review) {
    const canonical = [
      contentFingerprint(review),
      normalizeWhitespace(review.createdAt ?? review.created_at),
      normalizeScore(review.score) ?? "",
      String(review.sourceId ?? review.id ?? ""),
    ].join("\u241f");
    return hashString(canonical);
  }

  function looksLikeIdMap(value) {
    if (!value || Array.isArray(value) || typeof value !== "object") return false;
    const entries = Object.entries(value);
    if (entries.length === 0) return false;
    return entries.every(
      ([key, item]) => /^\d+$/.test(String(key)) && ["string", "number"].includes(typeof item),
    );
  }

  function extractCandidates(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value.results)) return value.results;
    if (Array.isArray(value.reviews)) return value.reviews;
    if (value.rating !== undefined && value.comment !== undefined) return [value];
    return [];
  }

  function normalizeReview(raw, idMap = {}) {
    if (!raw || typeof raw !== "object") {
      return { valid: false, error: "点评不是对象" };
    }

    const nestedCourseId = raw.course && typeof raw.course === "object" ? raw.course.id : null;
    const originalCourseId = toCourseId(
      nestedCourseId ?? raw.course_id ?? raw.courseId ?? raw.sqid ?? raw.id,
    );
    const rating = Number(raw.rating);
    const comment = normalizeWhitespace(raw.comment);
    const courseId = mappedCourseId(originalCourseId, idMap);

    if (courseId === null) return { valid: false, error: "缺少课程 ID", raw };
    if (!VALID_RATINGS.has(rating)) return { valid: false, error: "推荐指数必须是 1–5", raw };
    if (!comment) return { valid: false, error: "点评内容为空", raw };

    const review = {
      sourceId: nestedCourseId !== null ? raw.id ?? null : raw.sourceId ?? null,
      originalCourseId,
      courseId,
      rating,
      comment,
      createdAt: normalizeWhitespace(raw.created_at ?? raw.createdAt) || null,
      score: normalizeScore(raw.score),
      courseName: normalizeWhitespace(raw._course_name ?? raw.course?.name ?? raw.courseName),
      courseTeacher: normalizeWhitespace(
        raw._course_teacher ?? raw.course?.teacher ?? raw.courseTeacher,
      ),
      sourceFile: raw.__sourceFile || null,
    };
    review.fingerprint = fingerprint(review);
    return { valid: true, review };
  }

  function normalizeImport(documents) {
    const idMap = {};
    const warnings = [];
    const candidates = [];

    for (const document of documents) {
      const value = document.value;
      if (looksLikeIdMap(value)) {
        Object.assign(idMap, value);
        continue;
      }
      if (
        value &&
        !Array.isArray(value) &&
        Number.isFinite(Number(value.count)) &&
        Array.isArray(value.results) &&
        Number(value.count) > value.results.length
      ) {
        warnings.push(
          `${document.name} 只包含 ${value.results.length}/${value.count} 条；它看起来是分页响应，请改用完整备份。`,
        );
      }
      for (const raw of extractCandidates(value)) {
        candidates.push({ ...raw, __sourceFile: document.name });
      }
    }

    const reviews = [];
    const invalid = [];
    const seen = new Set();
    for (const raw of candidates) {
      const result = normalizeReview(raw, idMap);
      if (!result.valid) {
        invalid.push({ error: result.error, sourceFile: raw.__sourceFile || null });
        continue;
      }
      if (seen.has(result.review.fingerprint)) continue;
      seen.add(result.review.fingerprint);
      reviews.push(result.review);
    }

    return { reviews, invalid, idMap, warnings };
  }

  function remapReviews(reviews, idMap) {
    return reviews.map((review) => {
      const next = {
        ...review,
        courseId: mappedCourseId(review.originalCourseId ?? review.courseId, idMap),
      };
      next.fingerprint = fingerprint(next);
      return next;
    });
  }

  function findMissingReviews(courseId, localReviews, onlineReviews) {
    const existing = onlineReviews.map((review) => ({
      ...review,
      sourceId: review.sourceId ?? review.id ?? null,
      courseId,
    }));
    return subtractExistingReviews(localReviews, existing).reviews;
  }

  const api = {
    contentFingerprint,
    dedupeReviewsByContent,
    duplicateContentKey,
    extractCandidates,
    findMissingReviews,
    fingerprint,
    looksLikeIdMap,
    mappedCourseId,
    normalizeImport,
    normalizeReview,
    normalizeScore,
    normalizeWhitespace,
    remapReviews,
    subtractExistingReviewIds,
    subtractExistingReviews,
  };

  root.ReviewCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
