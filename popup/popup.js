const streamList = document.getElementById("stream-list");
const emptyState = document.getElementById("empty-state");
const streamElements = new Map();
let currentTabTitle = "video";

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showEmpty();

  currentTabTitle = tab.title || "video";

  const key = `tab_${tab.id}`;
  const data = await chrome.storage.session.get(key);
  const streams = data[key] || [];

  if (streams.length === 0) return showEmpty();

  emptyState.hidden = true;
  streams.forEach((stream) => renderStream(stream));

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "downloadProgress") {
      updateStreamUI(message.url, message.status);
    }
  });
}

function showEmpty() {
  emptyState.hidden = false;
  streamList.innerHTML = "";
}

function renderStream(stream) {
  const item = document.createElement("div");
  item.className = "stream-item";

  const meta = document.createElement("div");
  meta.className = "stream-meta";

  const badge = document.createElement("span");
  badge.className = `stream-badge ${stream.streamType}`;
  badge.textContent = stream.streamType.toUpperCase();

  const urlDisplay = document.createElement("div");
  urlDisplay.className = "stream-url";
  urlDisplay.textContent = truncateUrl(stream.url, 100);
  urlDisplay.title = stream.url;

  meta.appendChild(badge);
  meta.appendChild(urlDisplay);

  const actions = document.createElement("div");
  actions.className = "stream-actions";

  const btn = document.createElement("button");
  btn.className = "btn-download";
  btn.textContent = "Download";

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

  item.appendChild(meta);
  item.appendChild(actions);
  item.appendChild(progressBar);
  streamList.appendChild(item);

  streamElements.set(stream.url, { btn, progressText, progressBar, progressFill });

  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Starting...";
    progressBar.hidden = false;

    chrome.runtime.sendMessage({
      action: "startDownload",
      url: stream.url,
      streamType: stream.streamType,
      tabTitle: currentTabTitle,
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

  const { btn, progressText, progressBar, progressFill } = els;

  if (status.state === "downloading") {
    btn.disabled = true;
    btn.textContent = "Downloading...";
    progressBar.hidden = false;
    progressFill.style.width = `${status.percent || 0}%`;
    progressText.textContent = status.total
      ? `${status.downloaded}/${status.total} segments`
      : "Starting...";
  }

  if (status.state === "saving") {
    btn.textContent = "Saving...";
    progressFill.style.width = "100%";
    progressText.textContent = "Writing file...";
  }

  if (status.state === "done") {
    btn.textContent = "Done";
    btn.disabled = true;
    progressFill.style.width = "100%";
    progressText.textContent = "Saved";
  }

  if (status.state === "error") {
    btn.textContent = "Retry";
    btn.disabled = false;
    progressText.textContent = status.error || "Download failed";
  }
}

function truncateUrl(url, maxLength) {
  if (url.length <= maxLength) return url;
  const start = url.substring(0, 45);
  const end = url.substring(url.length - 45);
  return `${start}...${end}`;
}

init();
