chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action !== "offscreen-download") return;

  const cache = await caches.open("hls-downloads");
  const response = await cache.match(message.cacheKey);
  if (!response) return;

  const arrayBuffer = await response.arrayBuffer();
  const tsData = new Uint8Array(arrayBuffer);

  let blob;

  if (message.needsTransmux && window.muxjs) {
    blob = await transmuxToMp4(tsData);
  } else {
    blob = new Blob([tsData], { type: "video/mp2t" });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = message.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(async () => {
    URL.revokeObjectURL(url);
    const c = await caches.open("hls-downloads");
    await c.delete(message.cacheKey);
  }, 60000);
});

function transmuxToMp4(tsData) {
  return new Promise((resolve, reject) => {
    const transmuxer = new muxjs.mp4.Transmuxer({
      keepOriginalTimestamps: true,
      remux: true,
    });

    const chunks = [];

    transmuxer.on("data", (segment) => {
      const combined = new Uint8Array(
        segment.initSegment.byteLength + segment.data.byteLength
      );
      combined.set(segment.initSegment, 0);
      combined.set(segment.data, segment.initSegment.byteLength);
      chunks.push(combined);
    });

    transmuxer.on("done", () => {
      if (chunks.length === 0) {
        reject(new Error("Transmuxing produced no output"));
        return;
      }
      resolve(new Blob(chunks, { type: "video/mp4" }));
    });

    transmuxer.push(tsData);
    transmuxer.flush();
  });
}
