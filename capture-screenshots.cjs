// Capture Chrome Web Store screenshots of the K-downloader popup.
// Launches Chromium with the unpacked extension, seeds session storage with
// realistic detected streams, drives the popup into several states, and
// composites each popup onto a 1280x800 branded backdrop (store requirement).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const os = require("os");

const EXT = "/Users/user/Documents/Dev/Kitendo/hls-downloader";
const OUT = path.join(EXT, "store-assets");
const CHROMIUM = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1181/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
);

const SHOTS = [
  { w: 1280, h: 800 },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kdl-profile-"));

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: CHROMIUM,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  // Find the extension's service worker to get its ID.
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log("Extension ID:", extId);

  // Open a normal page so chrome.tabs.query has an active tab with a title.
  const page = await ctx.newPage();
  await page.goto("https://example.com/");
  await page.evaluate(() => { document.title = "Big Buck Bunny - Sample Video Player"; });
  await page.waitForTimeout(500);
  const tabId = await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t.id;
  });
  console.log("Active tab id:", tabId);

  // Seed session storage: two detected streams (HLS + DASH) for this tab.
  await sw.evaluate(async (tabId) => {
    await chrome.storage.session.set({
      [`tab_${tabId}`]: [
        { url: "https://cdn.example.com/vod/bbb/master.m3u8", streamType: "hls" },
        { url: "https://cdn.example.com/vod/bbb/manifest.mpd", streamType: "dash" },
      ],
      concurrency: 8,
    });
  }, tabId);

  // popup.js queries the active tab then reads chrome.storage.session
  // under `tab_<id>`. Rather than chase the popup's real tab id, inject an
  // init script (runs before popup.js) that pins chrome.tabs.query to a fixed
  // tab and seeds the streams into a tiny in-memory chrome.storage.session
  // shim. This makes the render deterministic and independent of tab ids.
  const popupPage = await ctx.newPage();
  await popupPage.setViewportSize({ width: 420, height: 600 });

  await popupPage.addInitScript(() => {
    const FIXED_TAB = { id: 999001, title: "Big Buck Bunny - Sample Video Player" };
    const store = {
      "tab_999001": [
        { url: "https://cdn.example.com/vod/bbb/master.m3u8", streamType: "hls" },
        { url: "https://cdn.example.com/vod/bbb/manifest.mpd", streamType: "dash" },
      ],
      concurrency: 8,
    };
    const get = (keys) => {
      if (keys == null) return Promise.resolve({ ...store });
      if (typeof keys === "string") return Promise.resolve({ [keys]: store[keys] });
      const out = {};
      for (const k of keys) out[k] = store[k];
      return Promise.resolve(out);
    };
    const set = (obj) => { Object.assign(store, obj); return Promise.resolve(); };
    window.chrome = window.chrome || {};
    chrome.tabs = {
      query: () => Promise.resolve([FIXED_TAB]),
    };
    chrome.storage = { session: { get, set, remove: () => Promise.resolve() } };
    chrome.runtime = chrome.runtime || {};
    chrome.runtime.getManifest = () => ({ version: "1.0.5" });
    chrome.runtime.onMessage = { addListener: () => {} };
    chrome.runtime.sendMessage = (_m, cb) => { if (typeof cb === "function") cb({}); };
  });

  await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popupPage.waitForTimeout(700);

  // State 1: detected streams (idle)
  await shotComposite(popupPage, path.join(OUT, "screenshot-1-detected.png"),
    "Detect HLS & DASH streams on any page");

  // State 2: a download in progress - drive the UI directly for a clean shot.
  await popupPage.evaluate(() => {
    const items = document.querySelectorAll(".stream-item");
    const first = items[0];
    if (!first) return;
    const btn = first.querySelector(".btn-download");
    const section = first.querySelector(".progress-section");
    const fill = first.querySelector(".progress-fill");
    const pct = first.querySelector(".progress-percent");
    const detail = first.querySelector(".progress-detail");
    btn.disabled = true;
    btn.textContent = "63%";
    section.classList.add("active");
    fill.style.width = "63%";
    pct.textContent = "63%";
    detail.textContent = "118 of 187 segments - 4.2 MB/s - ~16s left";
  });
  await popupPage.waitForTimeout(300);
  await shotComposite(popupPage, path.join(OUT, "screenshot-2-progress.png"),
    "Fast parallel downloads with live speed & ETA");

  // State 3: completed
  await popupPage.evaluate(() => {
    const first = document.querySelector(".stream-item");
    if (!first) return;
    const btn = first.querySelector(".btn-download");
    const fill = first.querySelector(".progress-fill");
    const pct = first.querySelector(".progress-percent");
    const detail = first.querySelector(".progress-detail");
    const openBtn = first.querySelector(".btn-open-folder");
    btn.textContent = "Done";
    btn.classList.add("done");
    fill.style.width = "100%";
    fill.classList.add("complete");
    pct.textContent = "100%";
    detail.textContent = "Saved";
    if (openBtn) openBtn.hidden = false;
  });
  await popupPage.waitForTimeout(300);
  await shotComposite(popupPage, path.join(OUT, "screenshot-3-done.png"),
    "Saved straight to your device - all local, no tracking");

  await ctx.close();
  console.log("Done. Screenshots in", OUT);
}

// Composite the popup screenshot centered on a 1280x800 branded backdrop.
async function shotComposite(popupPage, outPath, caption) {
  const popupPng = await popupPage.screenshot({ type: "png" });
  const b64 = popupPng.toString("base64");

  // Use a throwaway page to render the composite via HTML/CSS, then screenshot.
  const composer = await popupPage.context().newPage();
  await composer.setViewportSize({ width: 1280, height: 800 });
  await composer.setContent(`
    <html><head><style>
      * { margin:0; box-sizing:border-box; }
      body {
        width:1280px; height:800px; overflow:hidden;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        background:
          radial-gradient(circle at 18% 22%, rgba(25,184,206,.28), transparent 45%),
          radial-gradient(circle at 85% 80%, rgba(255,122,69,.20), transparent 45%),
          linear-gradient(135deg, #0c1418 0%, #0e1c22 100%);
        display:flex; align-items:center; justify-content:space-between;
        padding:0 96px;
      }
      .left { max-width:560px; color:#fff; }
      .badge {
        display:inline-flex; align-items:center; gap:8px;
        background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.14);
        padding:6px 14px; border-radius:999px; font-size:14px; color:#bfe9f2;
        margin-bottom:26px; font-weight:600;
      }
      .badge img { width:20px; height:20px; }
      h1 { font-size:46px; line-height:1.12; font-weight:800; letter-spacing:-1px; }
      h1 .accent { background:linear-gradient(135deg,#3fd0e6,#19B8CE); -webkit-background-clip:text; background-clip:text; color:transparent; }
      p { margin-top:20px; font-size:19px; line-height:1.6; color:#aab8bf; }
      .device {
        position:relative; border-radius:18px; overflow:hidden;
        box-shadow:0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06);
      }
      .device img { display:block; width:400px; }
      .chrome-bar {
        height:34px; background:#202428; display:flex; align-items:center; gap:6px; padding:0 12px;
      }
      .dot { width:11px; height:11px; border-radius:50%; }
      .r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}
    </style></head><body>
      <div class="left">
        <div class="badge"><img src="data:image/png;base64,${ICON_B64}"/> Kitendo Stream Downloader</div>
        <h1>${caption.replace(/&/g, "&amp;")}</h1>
        <p>One click turns any HLS or DASH stream into a saved file. Everything runs locally in your browser.</p>
      </div>
      <div class="device">
        <div class="chrome-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
        <img src="data:image/png;base64,${b64}"/>
      </div>
    </body></html>
  `);
  await composer.waitForTimeout(250);
  await composer.screenshot({ path: outPath, type: "png" });
  await composer.close();
  console.log("Wrote", outPath);
}

const ICON_B64 = fs.readFileSync(path.join(EXT, "icons/icon-128.png")).toString("base64");

main().catch((e) => { console.error(e); process.exit(1); });
