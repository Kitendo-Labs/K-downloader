export function parseM3U8(content, manifestUrl) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  if (!lines[0]?.startsWith("#EXTM3U")) {
    throw new Error("Invalid M3U8: missing #EXTM3U header");
  }

  const hasVariants = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"));

  if (hasVariants) {
    return { type: "master", variants: parseMasterPlaylist(lines, manifestUrl) };
  }

  return { type: "media", segments: parseMediaPlaylist(lines, manifestUrl) };
}

function parseMasterPlaylist(lines, manifestUrl) {
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

    const attrs = parseAttributes(line);
    const uri = lines[i + 1];
    if (!uri || uri.startsWith("#")) continue;

    variants.push({
      url: resolveUrl(uri, manifestUrl),
      bandwidth: parseInt(attrs.BANDWIDTH || "0", 10),
      resolution: attrs.RESOLUTION || null,
      codecs: attrs.CODECS || null,
    });
  }

  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants;
}

function parseMediaPlaylist(lines, manifestUrl) {
  const segments = [];
  let duration = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("#EXTINF")) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      duration = match ? parseFloat(match[1]) : 0;
      continue;
    }

    if (!line.startsWith("#")) {
      segments.push({
        url: resolveUrl(line, manifestUrl),
        duration,
      });
      duration = 0;
    }
  }

  return segments;
}

function parseAttributes(line) {
  const attrs = {};
  const attrString = line.replace(/^#EXT-X-STREAM-INF:/, "");

  const regex = /([A-Z-]+)=(?:"([^"]+)"|([^,]+))/g;
  let match;

  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2] || match[3];
  }

  return attrs;
}

function resolveUrl(uri, baseUrl) {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }

  try {
    return new URL(uri, baseUrl).href;
  } catch {
    const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
    return basePath + uri;
  }
}
