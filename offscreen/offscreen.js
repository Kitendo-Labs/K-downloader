chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action !== "offscreen-download") return;

  const cache = await caches.open("hls-downloads");
  const response = await cache.match(message.cacheKey);
  if (!response) return;

  const blob = await response.blob();
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
