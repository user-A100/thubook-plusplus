import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteOrigin = "https://thubook.help";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const outputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(extensionDir, "data", "current-review-index.json");
const concurrency = 16;

async function getJson(pathname) {
  const response = await fetch(`${siteOrigin}${pathname}`);
  if (!response.ok) throw new Error(`${pathname} 返回 HTTP ${response.status}`);
  return response.json();
}

const [manifest, index] = await Promise.all([
  getJson("/data/manifest.json"),
  getJson("/data/with_comment_index.json"),
]);
const courses = Object.values(index.courses || {});
const reviewIds = [];

for (let offset = 0; offset < courses.length; offset += concurrency) {
  const batch = courses.slice(offset, offset + concurrency);
  const documents = await Promise.all(
    batch.map(async (course) => ({
      course,
      document: await getJson(`/data/courses/${course.sqid}.json`),
    })),
  );
  for (const { course, document } of documents) {
    for (const review of document.results || document.reviews || []) {
      if (review.id !== null && review.id !== undefined) reviewIds.push(review.id);
    }
  }
}

reviewIds.sort((left, right) => Number(left || 0) - Number(right || 0));
if (reviewIds.length !== Number(manifest.total_reviews)) {
  throw new Error(`站点清单为 ${manifest.total_reviews} 条，但实际抓取到 ${reviewIds.length} 个点评 ID`);
}

const snapshot = {
  source: siteOrigin,
  captured_at: new Date().toISOString(),
  total_reviews: reviewIds.length,
  review_ids: reviewIds,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`已保存网站现存 ${reviewIds.length} 个点评 ID（不含正文）：${outputPath}`);
