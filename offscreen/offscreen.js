chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action !== "offscreen-create-blob-url") return;

  const cache = await caches.open("hls-downloads");
  const response = await cache.match(message.cacheKey);

  if (!response) {
    chrome.runtime.sendMessage({ action: "blob-url-ready", blobUrl: null, cacheKey: message.cacheKey });
    return;
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  chrome.runtime.sendMessage({
    action: "blob-url-ready",
    blobUrl,
    cacheKey: message.cacheKey,
  });

  setTimeout(async () => {
    URL.revokeObjectURL(blobUrl);
    const c = await caches.open("hls-downloads");
    await c.delete(message.cacheKey);
  }, 120000);
});
