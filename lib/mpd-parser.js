export function parseMPD(xmlText, manifestUrl) {
  const baseUrl = extractBaseUrl(xmlText, manifestUrl);
  const periods = findElements(xmlText, "Period");
  const result = { type: "mpd", representations: [] };

  for (const period of periods) {
    const adaptationSets = findElements(period, "AdaptationSet");

    for (const as of adaptationSets) {
      const asMime = getAttr(as, "mimeType") || "";
      const asContent = getAttr(as, "contentType") || "";
      const isVideo = asMime.startsWith("video") || asContent === "video";
      const isAudio = asMime.startsWith("audio") || asContent === "audio";

      if (!isVideo && !isAudio) continue;

      const representations = findElements(as, "Representation");

      for (const rep of representations) {
        const repData = parseRepresentation(rep, as, period, baseUrl);
        if (repData) {
          repData.mediaType = isVideo ? "video" : "audio";
          result.representations.push(repData);
        }
      }
    }
  }

  result.representations.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
  return result;
}

function parseRepresentation(rep, adaptationSet, period, baseUrl) {
  const bandwidth = parseInt(getAttr(rep, "bandwidth") || "0", 10);
  const width = getAttr(rep, "width") || getAttr(adaptationSet, "width");
  const height = getAttr(rep, "height") || getAttr(adaptationSet, "height");
  const resolution = width && height ? `${width}x${height}` : null;
  const id = getAttr(rep, "id") || "";
  const mimeType = getAttr(rep, "mimeType") || getAttr(adaptationSet, "mimeType") || "";

  const segTemplate = findElement(rep, "SegmentTemplate") || findElement(adaptationSet, "SegmentTemplate");
  const segList = findElement(rep, "SegmentList") || findElement(adaptationSet, "SegmentList");
  const baseUrlEl = findElement(rep, "BaseURL") || findElement(adaptationSet, "BaseURL");
  const repBaseUrl = baseUrlEl ? resolveUrl(getTextContent(baseUrlEl), baseUrl) : baseUrl;

  if (segTemplate) {
    return {
      id, bandwidth, resolution, mimeType,
      segments: parseSegmentTemplate(segTemplate, period, repBaseUrl, id, bandwidth),
    };
  }

  if (segList) {
    return {
      id, bandwidth, resolution, mimeType,
      segments: parseSegmentList(segList, repBaseUrl),
    };
  }

  if (baseUrlEl) {
    const directUrl = resolveUrl(getTextContent(baseUrlEl), baseUrl);
    return {
      id, bandwidth, resolution, mimeType,
      segments: [{ url: directUrl }],
    };
  }

  return null;
}

function parseSegmentTemplate(template, period, baseUrl, repId, bandwidth) {
  const segments = [];
  const media = getAttr(template, "media") || "";
  const init = getAttr(template, "initialization") || "";
  const timescale = parseInt(getAttr(template, "timescale") || "1", 10);
  const startNumber = parseInt(getAttr(template, "startNumber") || "1", 10);

  if (init) {
    const initUrl = buildTemplateUrl(init, repId, bandwidth, startNumber, 0);
    segments.push({ url: resolveUrl(initUrl, baseUrl), isInit: true });
  }

  const timeline = findElement(template, "SegmentTimeline");

  if (timeline) {
    const entries = findAllSelfClosing(timeline, "S");
    let time = 0;
    let number = startNumber;

    for (const entry of entries) {
      const t = getAttr(entry, "t");
      const d = parseInt(getAttr(entry, "d") || "0", 10);
      const r = parseInt(getAttr(entry, "r") || "0", 10);

      if (t !== null && t !== undefined) time = parseInt(t, 10);

      for (let i = 0; i <= r; i++) {
        const segUrl = buildTemplateUrl(media, repId, bandwidth, number, time);
        segments.push({ url: resolveUrl(segUrl, baseUrl), duration: d / timescale });
        time += d;
        number++;
      }
    }
  } else {
    const duration = parseFloat(getAttr(template, "duration") || "0");
    if (duration <= 0) return segments;

    const periodDuration = parseDuration(getAttr(period, "duration") || "");
    const totalSegments = periodDuration > 0 ? Math.ceil((periodDuration * timescale) / duration) : 0;

    for (let i = 0; i < totalSegments; i++) {
      const number = startNumber + i;
      const time = i * duration;
      const segUrl = buildTemplateUrl(media, repId, bandwidth, number, time);
      segments.push({ url: resolveUrl(segUrl, baseUrl), duration: duration / timescale });
    }
  }

  return segments;
}

function parseSegmentList(segList, baseUrl) {
  const segments = [];
  const initEl = findElement(segList, "Initialization");

  if (initEl) {
    const sourceURL = getAttr(initEl, "sourceURL");
    if (sourceURL) {
      segments.push({ url: resolveUrl(sourceURL, baseUrl), isInit: true });
    }
  }

  const segUrls = findAllSelfClosing(segList, "SegmentURL");
  for (const seg of segUrls) {
    const media = getAttr(seg, "media");
    if (media) {
      segments.push({ url: resolveUrl(media, baseUrl) });
    }
  }

  return segments;
}

function buildTemplateUrl(template, repId, bandwidth, number, time) {
  return template
    .replace(/\$RepresentationID\$/g, repId)
    .replace(/\$Bandwidth\$/g, String(bandwidth))
    .replace(/\$Number(%\d+d)?\$/g, (_, fmt) => {
      if (fmt) {
        const width = parseInt(fmt.replace("%", "").replace("d", ""), 10);
        return String(number).padStart(width, "0");
      }
      return String(number);
    })
    .replace(/\$Time\$/g, String(time));
}

function extractBaseUrl(xmlText, manifestUrl) {
  const match = xmlText.match(/<MPD[^>]*>[\s\S]*?<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/);
  if (match) {
    const val = match[1].trim();
    if (val.startsWith("http")) return val;
    return resolveUrl(val, manifestUrl);
  }
  return manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
}

function resolveUrl(uri, baseUrl) {
  if (!uri) return baseUrl;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;

  try {
    return new URL(uri, baseUrl).href;
  } catch {
    const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
    return basePath + uri;
  }
}

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || "0", 10) * 3600) +
         (parseInt(match[2] || "0", 10) * 60) +
         parseFloat(match[3] || "0");
}

function getAttr(xml, name) {
  const tagMatch = xml.match(/^<\w+\s([^>]*)/);
  if (!tagMatch) return null;
  const attrRegex = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
  const match = tagMatch[1].match(attrRegex);
  return match ? match[1] : null;
}

function getTextContent(xml) {
  const match = xml.match(/>([^<]*)</);
  return match ? match[1].trim() : "";
}

function findElement(xml, tagName) {
  const selfClosing = new RegExp(`<${tagName}(\\s[^>]*)?\\/>`);
  const scMatch = xml.match(selfClosing);

  const opening = new RegExp(`<${tagName}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`);
  const match = xml.match(opening);

  if (match) return match[0];
  if (scMatch) return scMatch[0];
  return null;
}

function findElements(xml, tagName) {
  const results = [];

  const pattern = new RegExp(`<${tagName}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "g");
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[0]);
  }

  return results;
}

function findAllSelfClosing(xml, tagName) {
  const results = [];
  const pattern = new RegExp(`<${tagName}(\\s[^>]*)?\\/?\\s*>`, "g");
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[0]);
  }
  return results;
}
