// The service worker cannot create blob URLs (no DOM). This offscreen document
// receives a Blob over a MessageChannel port and returns an object URL that the
// service worker hands to chrome.downloads.download so it can capture a downloadId.
navigator.serviceWorker.onmessage = (event) => {
  if (event.data?.action !== "create-blob-url") return;

  const port = event.ports[0];
  const url = URL.createObjectURL(event.data.blob);
  port.postMessage({ url });
};
