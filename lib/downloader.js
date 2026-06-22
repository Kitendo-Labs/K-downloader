import { parseM3U8 } from "./m3u8-parser.js";
import { parseMPD } from "./mpd-parser.js";

export async function downloadStream(manifestUrl, streamType, onProgress, concurrency = 8) {
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

  const limit = Math.max(1, Math.min(16, Math.floor(concurrency) || 8));
  const chunks = await fetchSegmentsConcurrently(segments, limit, onProgress);
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);

  return { parts: chunks, mimeType, totalBytes, segmentCount: chunks.length };
}

async function fetchSegmentsConcurrently(segments, limit, onProgress) {
  const results = new Array(segments.length);
  let downloaded = 0;
  let downloadedBytes = 0;
  let next = 0;

  async function worker() {
    while (next < segments.length) {
      const i = next++;
      results[i] = await fetchSegmentWithRetry(segments[i].url, 3);
      downloaded++;
      downloadedBytes += results[i].byteLength;
      if (onProgress) {
        onProgress({
          downloaded,
          total: segments.length,
          percent: Math.round((downloaded / segments.length) * 100),
          downloadedBytes,
        });
      }
    }
  }

  const workerCount = Math.min(limit, segments.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function fetchSegmentWithRetry(url, maxAttempts) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Segment fetch failed: ${response.status} ${url}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError;
}
