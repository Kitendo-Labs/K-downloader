import { downloadStream } from "../lib/downloader.js";

// This offscreen document owns every video byte. The MV3 service worker cannot
// hold a full multi-GB video in its heap (it OOMs on fetch or on postMessage),
// so all parsing, segment fetching, and Blob construction happen here in a
// real document with a large heap. The SW only orchestrates and owns
// chrome.downloads; bytes never cross the context boundary - only the final
// blob: URL string does.
const activeBlobs = new Map();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen") return;

  if (message.type === "stream-download:start") {
    void runJob(message);
  } else if (message.type === "stream-download:revoke") {
    revokeJob(message.jobId, message.objectUrl);
  }
});

async function runJob({ jobId, manifestUrl, streamType, concurrency }) {
  try {
    const result = await downloadStream(manifestUrl, streamType, (progress) => {
      sendProgress(jobId, progress);
    }, concurrency);

    const blob = new Blob(result.parts, { type: result.mimeType });
    const objectUrl = URL.createObjectURL(blob);
    activeBlobs.set(jobId, { blob, objectUrl });

    chrome.runtime.sendMessage({
      target: "service-worker",
      type: "stream-download:ready",
      jobId,
      objectUrl,
      mimeType: result.mimeType,
      totalBytes: result.totalBytes,
      segmentCount: result.segmentCount,
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      target: "service-worker",
      type: "stream-download:error",
      jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Throttle to one message per ~300ms so a 930-segment job doesn't flood the
// SW with ~930 runtime messages. The final segment always reports because the
// last completion lands after the throttle window.
const lastSent = new Map();
const speedState = new Map();

// Rolling ~5s window, not cumulative average: tracks current throughput so the
// number reflects live CDN speed. ETA is approximate - total byte size is
// unknown until all segments are fetched, so remaining = avg-segment * left.
function sendProgress(jobId, progress) {
  const now = Date.now();
  const prev = lastSent.get(jobId) || 0;
  const isLast = progress.downloaded === progress.total;
  if (!isLast && now - prev < 300) return;
  lastSent.set(jobId, now);

  const { bytesPerSec, etaSeconds } = computeSpeed(jobId, progress, now);

  chrome.runtime.sendMessage({
    target: "service-worker",
    type: "stream-download:progress",
    jobId,
    ...progress,
    bytesPerSec,
    etaSeconds,
  });
}

function computeSpeed(jobId, progress, now) {
  let state = speedState.get(jobId);
  if (!state) {
    state = { samples: [] };
    speedState.set(jobId, state);
  }

  state.samples.push({ t: now, bytes: progress.downloadedBytes });
  const windowStart = now - 5000;
  while (state.samples.length > 2 && state.samples[0].t < windowStart) {
    state.samples.shift();
  }

  const oldest = state.samples[0];
  const elapsed = (now - oldest.t) / 1000;
  const bytesDelta = progress.downloadedBytes - oldest.bytes;
  const bytesPerSec = elapsed > 0 ? bytesDelta / elapsed : 0;

  let etaSeconds = null;
  if (bytesPerSec > 0 && progress.downloaded > 0) {
    const avgSegmentBytes = progress.downloadedBytes / progress.downloaded;
    const remainingBytes = avgSegmentBytes * (progress.total - progress.downloaded);
    etaSeconds = Math.round(remainingBytes / bytesPerSec);
  }

  return { bytesPerSec, etaSeconds };
}

function revokeJob(jobId, objectUrl) {
  const entry = activeBlobs.get(jobId);
  if (entry) {
    URL.revokeObjectURL(entry.objectUrl);
    activeBlobs.delete(jobId);
  } else if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
  lastSent.delete(jobId);
  speedState.delete(jobId);
}
