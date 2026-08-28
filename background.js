"use strict";

// 本地只读扩展：后台仅在首次安装时打开管理页，不执行任何网络请求。
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OPEN_LOCAL_LIBRARY") return false;
  chrome.runtime.openOptionsPage().then(
    () => sendResponse({ ok: true }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});
