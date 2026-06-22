const STREAM_PATTERN = /\.(m3u8|mpd)(\?.*)?$/i;
const activeDownloads = new Map();
const jobs = new Map();
const jobByChromeId = new Map();

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startDownload") {
    handleDownloadRequest(message.url, message.streamType, message.tabTitle, message.concurrency);
    sendResponse({ started: true });
  }

  if (message.action === "getDownloadStatus") {
    const status = activeDownloads.get(message.url) || null;
    sendResponse({ status });
  }

  if (message.action === "showDownload") {
    chrome.downloads.show(message.downloadId);
    sendResponse({ shown: true });
  }

  if (message.target === "service-worker") {
    handleOffscreenMessage(message);
  }

  return false;
});

function handleOffscreenMessage(message) {
  const job = jobs.get(message.jobId);
  if (!job) return;

  if (message.type === "stream-download:progress") {
    activeDownloads.set(job.url, {
      state: "downloading",
      downloaded: message.downloaded,
      total: message.total,
      percent: message.percent,
      bytesPerSec: message.bytesPerSec,
      etaSeconds: message.etaSeconds,
    });
    broadcastProgress(job.url);
  } else if (message.type === "stream-download:ready") {
    void startChromeDownload(message);
  } else if (message.type === "stream-download:error") {
    activeDownloads.set(job.url, { state: "error", error: message.message });
    broadcastProgress(job.url);
    jobs.delete(message.jobId);
  }
}

async function handleDownloadRequest(url, streamType, tabTitle, concurrency) {
  const jobId = crypto.randomUUID();
  const ext = streamType === "dash" ? ".mp4" : ".ts";
  const filename = generateFilename(tabTitle, ext);
  jobs.set(jobId, { url, filename });

  activeDownloads.set(url, { state: "downloading", downloaded: 0, total: 0, percent: 0 });
  broadcastProgress(url);

  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({
    target: "offscreen",
    type: "stream-download:start",
    jobId,
    manifestUrl: url,
    streamType,
    concurrency,
  }).catch(() => {});
}

async function startChromeDownload(message) {
  const job = jobs.get(message.jobId);
  if (!job) return;

  activeDownloads.set(job.url, { state: "saving" });
  broadcastProgress(job.url);

  try {
    const downloadId = await chrome.downloads.download({
      url: message.objectUrl,
      filename: job.filename,
    });
    job.objectUrl = message.objectUrl;
    job.chromeDownloadId = downloadId;
    jobByChromeId.set(downloadId, message.jobId);

    activeDownloads.set(job.url, { state: "done", downloadId });
    broadcastProgress(job.url);
  } catch (err) {
    activeDownloads.set(job.url, { state: "error", error: err.message });
    broadcastProgress(job.url);
    revokeJob(message.jobId);
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  if (delta.state.current !== "complete" && delta.state.current !== "interrupted") return;

  const jobId = jobByChromeId.get(delta.id);
  if (jobId) revokeJob(jobId);
});

function revokeJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  if (job.objectUrl) {
    chrome.runtime.sendMessage({
      target: "offscreen",
      type: "stream-download:revoke",
      jobId,
      objectUrl: job.objectUrl,
    }).catch(() => {});
  }
  if (job.chromeDownloadId) jobByChromeId.delete(job.chromeDownloadId);
  jobs.delete(jobId);
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["BLOBS"],
    justification: "Fetch video segments and create blob URL for download",
  });
}

function broadcastProgress(url) {
  const status = activeDownloads.get(url);
  chrome.runtime.sendMessage({ action: "downloadProgress", url, status }).catch(() => {});
}

function generateFilename(tabTitle, ext) {
  const sanitized = (tabTitle || "video")
    .replace(/[<>:"/\\|?*]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .substring(0, 120);

  return `${sanitized || "video"}${ext}`;
}
