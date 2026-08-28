import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


EXTENSION_DIR = Path(__file__).resolve().parent.parent
DASHBOARD_SCREENSHOT = EXTENSION_DIR / "dashboard-smoke.png"
COURSE_SCREENSHOT = EXTENSION_DIR / "course-local-smoke.png"
STATISTICS_SCREENSHOT = EXTENSION_DIR / "statistics-local-smoke.png"


def main():
    with tempfile.TemporaryDirectory(prefix="thucourse-local-library-") as profile_dir:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile_dir,
                channel="chromium",
                headless=True,
                args=[
                    f"--disable-extensions-except={EXTENSION_DIR}",
                    f"--load-extension={EXTENSION_DIR}",
                ],
            )
            requests = []
            context.on("request", lambda request: requests.append((request.method, request.url)))
            try:
                workers = context.service_workers
                worker = workers[0] if workers else context.wait_for_event("serviceworker", timeout=15000)
                extension_id = worker.url.split("/")[2]

                raw_review = {
                    "id": 999999,
                    "course": {"id": 31345, "name": "石文化和艺术", "teacher": "温庆博"},
                    "rating": 4,
                    "comment": "这是一条仅用于验证本地补显的点评，不会提交到网站。",
                    "created_at": "2024/01/02 03:04",
                    "score": "A-",
                }

                dashboard = context.new_page()
                dashboard.goto(f"chrome-extension://{extension_id}/dashboard.html")
                dashboard.locator("#backup-files").set_input_files(
                    {
                        "name": "local-test-backup.json",
                        "mimeType": "application/json",
                        "buffer": json.dumps([raw_review], ensure_ascii=False).encode("utf-8"),
                    }
                )
                expect(dashboard.locator("#review-count")).to_have_text("1", timeout=20000)
                expect(dashboard.locator("#enabled-status")).to_have_text("已启用")
                expect(dashboard.locator("#import-note")).to_contain_text("公开索引 2685 条，其中重合 0 条；实际补载 1 条")
                dashboard.screenshot(path=str(DASHBOARD_SCREENSHOT), full_page=True)

                statistics = context.new_page()
                statistics.goto("https://thubook.help/thucourse/statistics.html")
                expect(statistics.locator("#stat-review-total")).to_have_text("2686", timeout=20000)
                expect(statistics.locator("#stat-course-total")).to_have_text("37804")
                expect(statistics.locator("#stat-course-reviewed")).to_have_text("1048")
                expect(statistics.locator("#thu-local-stat-note")).to_contain_text("本地补充 1 条点评")
                statistics.screenshot(path=str(STATISTICS_SCREENSHOT), full_page=True)

                course = context.new_page()
                course.goto(
                    "https://thubook.help/thucourse/course.html?sqid=31345"
                    "&name=%E7%9F%B3%E6%96%87%E5%8C%96%E5%92%8C%E8%89%BA%E6%9C%AF"
                    "&teacher=%E6%B8%A9%E5%BA%86%E5%8D%9A"
                )
                expect(course.locator("#thu-local-archive h3")).to_have_text("本地备份补充（1 条）", timeout=20000)
                expect(course.locator(".thu-local-comment")).to_have_text(raw_review["comment"])
                expect(course.locator(".thu-local-meta")).to_contain_text("来自本地备份")
                course.screenshot(path=str(COURSE_SCREENSHOT), full_page=True)

                home = context.new_page()
                home.goto("https://thubook.help/thucourse/")
                expect(home.locator("#thu-local-home-note")).to_contain_text("本地点评库已启用", timeout=20000)

                for page in list(context.pages):
                    if page != home and page.url == f"chrome-extension://{extension_id}/dashboard.html":
                        page.close()
                with context.expect_page(timeout=10000) as opened_info:
                    home.click("#thu-local-home-note button")
                opened = opened_info.value
                opened.wait_for_load_state()
                expect(opened.locator("h1")).to_contain_text("THU 本地点评库")
                opened.close()

                with context.expect_page(timeout=10000) as reopened_info:
                    home.click("#thu-local-library-badge")
                reopened = reopened_info.value
                reopened.wait_for_load_state()
                expect(reopened.locator("h1")).to_contain_text("THU 本地点评库")
                reopened.close()

                target_posts = [
                    (method, url)
                    for method, url in requests
                    if method == "POST" and ("/comment" in url or "yourschool.cc.cd" in url)
                ]
                assert not target_posts, target_posts
                assert not any("api.yourschool.cc.cd" in url for _method, url in requests)
                print(
                    f"PASS extension={extension_id} private-backup=absent public-id-index=2685 "
                    f"statistics=2686/37804/1048 local-overlay=1 options-open=2 "
                    f"comment-posts=0 api-requests=0 screenshot={COURSE_SCREENSHOT}"
                )
            finally:
                context.close()


if __name__ == "__main__":
    main()
