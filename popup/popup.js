import { downloadStream, triggerDownload } from "../lib/downloader.js";

const streamList = document.getElementById("stream-list");
const emptyState = document.getElementById("empty-state");

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showEmpty();

  const key = `tab_${tab.id}`;
  const data = await chrome.storage.session.get(key);
  const streams = data[key] || [];

  if (streams.length === 0) return showEmpty();

  emptyState.hidden = true;
  streams.forEach((stream, index) => renderStream(stream, index));
}

function showEmpty() {
  emptyState.hidden = false;
  streamList.innerHTML = "";
}

function renderStream(stream, index) {
  const item = document.createElement("div");
  item.className = "stream-item";

  const urlDisplay = document.createElement("div");
  urlDisplay.className = "stream-url";
  urlDisplay.textContent = truncateUrl(stream.url, 120);
  urlDisplay.title = stream.url;

  const actions = document.createElement("div");
  actions.className = "stream-actions";

  const btn = document.createElement("button");
  btn.className = "btn-download";
  btn.textContent = "Download";
  btn.dataset.index = index;

  const progressText = document.createElement("span");
  progressText.className = "progress-text";

  actions.appendChild(btn);
  actions.appendChild(progressText);

  const progressBar = document.createElement("div");
  progressBar.className = "progress-bar";
  progressBar.hidden = true;

  const progressFill = document.createElement("div");
  progressFill.className = "progress-fill";
  progressBar.appendChild(progressFill);

  item.appendChild(urlDisplay);
  item.appendChild(actions);
  item.appendChild(progressBar);
  streamList.appendChild(item);

  btn.addEventListener("click", () =>
    handleDownload(stream.url, btn, progressText, progressBar, progressFill)
  );
}

async function handleDownload(url, btn, progressText, progressBar, progressFill) {
  btn.disabled = true;
  btn.textContent = "Downloading...";
  progressBar.hidden = false;

  try {
    const blob = await downloadStream(url, (progress) => {
      progressFill.style.width = `${progress.percent}%`;
      progressText.textContent = `${progress.downloaded}/${progress.total} segments`;
    });

    const filename = generateFilename(url);
    triggerDownload(blob, filename);

    btn.textContent = "Done";
    progressText.textContent = "Saved";
  } catch (err) {
    btn.textContent = "Failed";
    progressText.textContent = err.message;
    btn.disabled = false;

    setTimeout(() => {
      btn.textContent = "Retry";
    }, 2000);
  }
}

function truncateUrl(url, maxLength) {
  if (url.length <= maxLength) return url;
  const start = url.substring(0, 50);
  const end = url.substring(url.length - 50);
  return `${start}...${end}`;
}

function generateFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split("/").pop()?.replace(/\.m3u8.*$/, "") || "stream";
    return `${base}_${Date.now()}.ts`;
  } catch {
    return `stream_${Date.now()}.ts`;
  }
}

init();
