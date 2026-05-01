import { parseM3U8 } from "./m3u8-parser.js";

export async function downloadStream(manifestUrl, onProgress) {
  const manifestText = await fetch(manifestUrl).then((r) => r.text());
  const parsed = parseM3U8(manifestText, manifestUrl);

  let segments;

  if (parsed.type === "master") {
    const bestVariant = parsed.variants[0];
    const variantText = await fetch(bestVariant.url).then((r) => r.text());
    const variantParsed = parseM3U8(variantText, bestVariant.url);
    segments = variantParsed.segments;
  } else {
    segments = parsed.segments;
  }

  if (!segments || segments.length === 0) {
    throw new Error("No segments found in playlist");
  }

  const chunks = [];
  let downloaded = 0;

  for (const segment of segments) {
    const response = await fetch(segment.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch segment: ${response.status} ${segment.url}`);
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

  return new Blob([merged], { type: "video/mp2t" });
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename: filename || "stream.ts",
    saveAs: true,
  }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}
