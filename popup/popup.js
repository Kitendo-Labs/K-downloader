const streamList = document.getElementById("stream-list");
const emptyState = document.getElementById("empty-state");
const streamCountEl = document.getElementById("stream-count");
const versionEl = document.getElementById("version");
const concurrencyEl = document.getElementById("concurrency");
const streamElements = new Map();
let currentTabTitle = "video";
let concurrency = 8;

async function init() {
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  await initConcurrency();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showEmpty();

  currentTabTitle = tab.title || "video";

  const key = `tab_${tab.id}`;
  const data = await chrome.storage.session.get(key);
  const streams = data[key] || [];

  if (streams.length === 0) return showEmpty();

  emptyState.hidden = true;
  streamCountEl.textContent = `${streams.length} stream${streams.length > 1 ? "s" : ""}`;
  streams.forEach((stream, index) => renderStream(stream, index));

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "downloadProgress") {
      updateStreamUI(message.url, message.status);
    }
  });
}

function showEmpty() {
  emptyState.hidden = false;
  streamList.innerHTML = "";
  streamCountEl.textContent = "";
}

async function initConcurrency() {
  const { concurrency: saved } = await chrome.storage.session.get("concurrency");
  concurrency = clampConcurrency(saved ?? 8);
  concurrencyEl.value = String(concurrency);

  concurrencyEl.addEventListener("change", () => {
    concurrency = clampConcurrency(concurrencyEl.value);
    concurrencyEl.value = String(concurrency);
    chrome.storage.session.set({ concurrency });
  });
}

function clampConcurrency(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 8;
  return Math.max(1, Math.min(16, n));
}

function getFilename(streamType) {
  const sanitized = currentTabTitle
    .replace(/[<>:"/\\|?*]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .substring(0, 120) || "video";
  const ext = streamType === "dash" ? ".mp4" : ".ts";
  return sanitized + ext;
}

function renderStream(stream, index) {
  const filename = getFilename(stream.streamType);

  const item = document.createElement("div");
  item.className = "stream-item";

  const top = document.createElement("div");
  top.className = "stream-top";

  const info = document.createElement("div");
  info.className = "stream-info";

  const filenameEl = document.createElement("div");
  filenameEl.className = "stream-filename";
  filenameEl.textContent = filename;
  filenameEl.title = filename;

  const meta = document.createElement("div");
  meta.className = "stream-meta";

  const badge = document.createElement("span");
  badge.className = `stream-badge ${stream.streamType}`;
  badge.textContent = stream.streamType.toUpperCase();

  const urlDisplay = document.createElement("span");
  urlDisplay.className = "stream-url";
  urlDisplay.textContent = shortenUrl(stream.url);
  urlDisplay.title = stream.url;

  meta.appendChild(badge);
  meta.appendChild(urlDisplay);

  info.appendChild(filenameEl);
  info.appendChild(meta);

  const btn = document.createElement("button");
  btn.className = "btn-download";
  btn.textContent = "Download";

  const openFolderBtn = document.createElement("button");
  openFolderBtn.className = "btn-open-folder";
  openFolderBtn.textContent = "Open folder";
  openFolderBtn.hidden = true;

  top.appendChild(info);
  top.appendChild(btn);
  top.appendChild(openFolderBtn);

  const progressSection = document.createElement("div");
  progressSection.className = "progress-section";

  const progressRow = document.createElement("div");
  progressRow.className = "progress-row";

  const percentEl = document.createElement("div");
  percentEl.className = "progress-percent";
  percentEl.textContent = "0%";

  const detailEl = document.createElement("div");
  detailEl.className = "progress-detail";
  detailEl.textContent = "Preparing...";

  progressRow.appendChild(percentEl);
  progressRow.appendChild(detailEl);

  const progressBar = document.createElement("div");
  progressBar.className = "progress-bar";

  const progressFill = document.createElement("div");
  progressFill.className = "progress-fill";
  progressBar.appendChild(progressFill);

  progressSection.appendChild(progressRow);
  progressSection.appendChild(progressBar);

  item.appendChild(top);
  item.appendChild(progressSection);
  streamList.appendChild(item);

  streamElements.set(stream.url, {
    btn, percentEl, detailEl, progressSection, progressFill, filenameEl, openFolderBtn,
  });

  openFolderBtn.addEventListener("click", () => {
    const downloadId = openFolderBtn.dataset.downloadId;
    if (downloadId === undefined) return;
    chrome.runtime.sendMessage({
      action: "showDownload",
      downloadId: Number(downloadId),
    });
  });

  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "0%";
    progressSection.classList.add("active");

    chrome.runtime.sendMessage({
      action: "startDownload",
      url: stream.url,
      streamType: stream.streamType,
      tabTitle: currentTabTitle,
      concurrency,
    });
  });

  chrome.runtime.sendMessage(
    { action: "getDownloadStatus", url: stream.url },
    (response) => {
      if (response?.status) updateStreamUI(stream.url, response.status);
    }
  );
}

function updateStreamUI(url, status) {
  const els = streamElements.get(url);
  if (!els) return;

  const { btn, percentEl, detailEl, progressSection, progressFill, openFolderBtn } = els;

  if (status.state === "downloading") {
    btn.disabled = true;
    const pct = status.percent || 0;
    btn.textContent = `${pct}%`;
    progressSection.classList.add("active");
    progressFill.style.width = `${pct}%`;
    percentEl.textContent = `${pct}%`;
    detailEl.textContent = status.total
      ? formatDetail(status)
      : "Connecting...";
  }

  if (status.state === "saving") {
    btn.textContent = "Saving";
    progressFill.style.width = "100%";
    percentEl.textContent = "100%";
    detailEl.textContent = "Writing to disk...";
  }

  if (status.state === "done") {
    btn.textContent = "Done";
    btn.disabled = true;
    btn.classList.add("done");
    progressFill.style.width = "100%";
    progressFill.classList.add("complete");
    percentEl.textContent = "100%";
    detailEl.textContent = "Saved";
    if (status.downloadId !== undefined) {
      openFolderBtn.dataset.downloadId = String(status.downloadId);
      openFolderBtn.hidden = false;
    }
  }

  if (status.state === "error") {
    btn.textContent = "Retry";
    btn.disabled = false;
    btn.classList.add("error");
    percentEl.textContent = "Error";
    detailEl.textContent = status.error || "Download failed";
  }
}

function formatDetail(status) {
  let line = `${status.downloaded} of ${status.total} segments`;
  if (status.bytesPerSec > 0) line += ` - ${formatSpeed(status.bytesPerSec)}`;
  if (status.etaSeconds != null) line += ` - ~${formatEta(status.etaSeconds)} left`;
  return line;
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1e3) return `${(bytesPerSec / 1e3).toFixed(0)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

function formatEta(seconds) {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  return `${seconds}s`;
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30
      ? u.pathname.substring(0, 30) + "..."
      : u.pathname;
    return u.hostname + path;
  } catch {
    return url.substring(0, 50);
  }
}

init();
