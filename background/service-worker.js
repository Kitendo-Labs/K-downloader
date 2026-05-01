const M3U8_PATTERN = /\.m3u8(\?.*)?$/i;

chrome.webRequest.onBeforeRequest.addListener(
  handleRequest,
  { urls: ["<all_urls>"] },
  []
);

async function handleRequest(details) {
  const { url, tabId, type } = details;

  if (tabId < 0) return;
  if (!M3U8_PATTERN.test(url)) return;
  if (["image", "font"].includes(type)) return;

  await addStream(tabId, url);
}

async function addStream(tabId, url) {
  const key = `tab_${tabId}`;
  const data = await chrome.storage.session.get(key);
  const streams = data[key] || [];

  if (streams.some((s) => s.url === url)) return;

  streams.push({
    url,
    detectedAt: Date.now(),
  });

  await chrome.storage.session.set({ [key]: streams });
  await updateBadge(tabId, streams.length);
}

async function updateBadge(tabId, count) {
  const text = count > 0 ? String(count) : "";
  const color = count > 0 ? "#e53e3e" : "#999999";

  await chrome.action.setBadgeText({ text, tabId });
  await chrome.action.setBadgeBackgroundColor({ color, tabId });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.session.remove(`tab_${tabId}`);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    await chrome.storage.session.remove(`tab_${tabId}`);
    await updateBadge(tabId, 0);
  }
});
