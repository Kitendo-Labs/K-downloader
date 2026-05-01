import { parseM3U8 } from "./m3u8-parser.js";
import { parseMPD } from "./mpd-parser.js";

export async function downloadStream(manifestUrl, streamType, onProgress) {
  const manifestText = await fetch(manifestUrl).then((r) => r.text());

  let segments;
  let mimeType = "video/mp2t";

  if (streamType === "dash") {
    const parsed = parseMPD(manifestText, manifestUrl);
    const videoRep = parsed.representations.find((r) => r.mediaType === "video");
    if (!videoRep) throw new Error("No video representation found in MPD");
    segments = videoRep.segments;
    mimeType = videoRep.mimeType || "video/mp4";
  } else {
    const parsed = parseM3U8(manifestText, manifestUrl);

    if (parsed.type === "master") {
      const bestVariant = parsed.variants[0];
      const variantText = await fetch(bestVariant.url).then((r) => r.text());
      const variantParsed = parseM3U8(variantText, bestVariant.url);
      segments = variantParsed.segments;
    } else {
      segments = parsed.segments;
    }
  }

  if (!segments || segments.length === 0) {
    throw new Error("No segments found in playlist");
  }

  const chunks = [];
  let downloaded = 0;

  for (const segment of segments) {
    const response = await fetch(segment.url);
    if (!response.ok) {
      throw new Error(`Segment fetch failed: ${response.status} ${segment.url}`);
    }

    const buffer = await response.arrayBuffer();
    chunks.push(buffer);
    downloaded++;

    if (onProgress) {
      onProgress({
        downloaded,
        total: segments.length,
        percent: Math.round((downloaded / segments.length) * 100),
      });
    }
  }

  const totalSize = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const merged = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return { data: merged, mimeType };
}

export async function triggerDownload({ data, mimeType }, filename) {
  await ensureOffscreenDocument();

  const blob = new Blob([data], { type: mimeType });
  const cache = await caches.open("hls-downloads");
  const cacheKey = `https://hls-downloader.local/${Date.now()}`;
  await cache.put(cacheKey, new Response(blob));

  chrome.runtime.sendMessage({
    action: "offscreen-download",
    cacheKey,
    filename: filename || "video.mp4",
  });
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["BLOBS"],
    justification: "Create blob URL for video download",
  });
}
