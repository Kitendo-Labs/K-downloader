import { downloadStream, triggerDownload } from "../lib/downloader.js";

const STREAM_PATTERN = /\.(m3u8|mpd)(\?.*)?$/i;
const activeDownloads = new Map();

chrome.webRequest.onBeforeRequest.addListener(
  handleRequest,
  { urls: ["<all_urls>"] },
  []
);

async function handleRequest(details) {
  const { url, tabId, type } = details;

  if (tabId < 0) return;
  if (!STREAM_PATTERN.test(url)) return;
  if (["image", "font"].includes(type)) return;

  const streamType = /\.mpd(\?.*)?$/i.test(url) ? "dash" : "hls";
  await addStream(tabId, url, streamType);
}

async function addStream(tabId, url, streamType) {
  const key = `tab_${tabId}`;
  const data = await chrome.storage.session.get(key);
  const streams = data[key] || [];

  if (streams.some((s) => s.url === url)) return;

  streams.push({ url, streamType, detectedAt: Date.now() });

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

const pendingBlobRequests = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startDownload") {
    handleDownloadRequest(message.url, message.streamType, message.tabTitle);
    sendResponse({ started: true });
  }

  if (message.action === "getDownloadStatus") {
    const status = activeDownloads.get(message.url) || null;
    sendResponse({ status });
  }

  if (message.action === "blob-url-ready") {
    const pending = pendingBlobRequests.get(message.cacheKey);
    if (pending) {
      pending.resolve(message.blobUrl);
      pendingBlobRequests.delete(message.cacheKey);
    }
  }

  return false;
});

async function handleDownloadRequest(url, streamType, tabTitle) {
  activeDownloads.set(url, { state: "downloading", downloaded: 0, total: 0, percent: 0 });
  broadcastProgress(url);

  try {
    const blob = await downloadStream(url, streamType, (progress) => {
      activeDownloads.set(url, { state: "downloading", ...progress });
      broadcastProgress(url);
    });

    activeDownloads.set(url, { state: "saving" });
    broadcastProgress(url);

    const filename = generateFilename(tabTitle);
    const { cacheKey } = await triggerDownload(blob, filename);

    const blobUrl = await requestBlobUrl(cacheKey);
    if (!blobUrl) throw new Error("Failed to create blob URL");

    await chrome.downloads.download({
      url: blobUrl,
      filename,
      saveAs: true,
    });

    activeDownloads.set(url, { state: "done" });
    broadcastProgress(url);

    setTimeout(() => activeDownloads.delete(url), 10000);
  } catch (err) {
    activeDownloads.set(url, { state: "error", error: err.message });
    broadcastProgress(url);
  }
}

function broadcastProgress(url) {
  const status = activeDownloads.get(url);
  chrome.runtime.sendMessage({ action: "downloadProgress", url, status }).catch(() => {});
}

function requestBlobUrl(cacheKey) {
  return new Promise((resolve) => {
    pendingBlobRequests.set(cacheKey, { resolve });

    chrome.runtime.sendMessage({
      action: "offscreen-create-blob-url",
      cacheKey,
    });

    setTimeout(() => {
      if (pendingBlobRequests.has(cacheKey)) {
        pendingBlobRequests.delete(cacheKey);
        resolve(null);
      }
    }, 30000);
  });
}

function generateFilename(tabTitle) {
  const sanitized = (tabTitle || "video")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 120);

  return `${sanitized || "video"}.mp4`;
}
