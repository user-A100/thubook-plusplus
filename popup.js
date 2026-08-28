"use strict";
chrome.storage.local.get(["reviews", "settings"]).then(({ reviews = [], settings = {} }) => {
  document.getElementById("total").textContent = reviews.length;
  document.getElementById("enabled").textContent = reviews.length && settings.enabled !== false ? "已启用" : "未启用";
});
document.getElementById("open-dashboard").addEventListener("click", () => chrome.runtime.openOptionsPage());
