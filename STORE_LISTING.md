# Chrome Web Store - Submission Listing

Copy-paste content and answers for the Chrome Web Store Developer Dashboard.

---

## Basics

- **Extension name**: Kitendo Stream Downloader
- **Category**: Productivity (alt: Developer Tools)
- **Language**: English (United States)

---

## Short description (max 132 chars)

> Detect HLS and DASH video streams on any page and download them to your device. Fast, local, no tracking.

---

## Detailed description

> Kitendo Stream Downloader detects HLS (.m3u8) and DASH (.mpd) video streams playing on the page you are viewing and lets you save them as a single file on your device.
>
> FEATURES
> - Automatic stream detection - the extension spots .m3u8 (HLS) and .mpd (DASH) manifests on the active tab and lists them in the popup.
> - One-click download - pick a detected stream and the extension fetches every segment and assembles them into one file.
> - Concurrent downloading - segments are fetched in parallel (adjustable 1-16 workers) for fast downloads, with live speed and ETA.
> - Sensible filenames - downloads are named from the page title automatically.
> - Completely local - all detection, fetching, and assembly happen inside your browser. There are no servers, no analytics, and no tracking. Nothing about your browsing is ever sent anywhere.
>
> RESPONSIBLE USE
> This tool is intended for downloading content you are authorized to download - your own media or content you have permission to save. You are responsible for complying with the terms of service of the sites you use and with applicable copyright law.
>
> PRIVACY
> The extension collects no personal data and transmits nothing off your device. Full policy: https://kitendo-labs.github.io/K-downloader/privacy.html

---

## Single purpose statement

> The extension has a single purpose: to detect HLS and DASH video streams on the user's current tab and download the selected stream to the user's device.

---

## Permission justifications

Paste each into the matching field on the dashboard.

- **webRequest**
  > Used to observe the active tab's network requests so the extension can detect video stream manifest URLs (.m3u8 / .mpd). Detection is local; URLs are never transmitted.

- **downloads**
  > Used to save the assembled video file to the user's device via the browser's download manager.

- **storage**
  > Used to keep the list of detected streams for the current tab and the user's "parallel downloads" preference in session storage. Data is session-scoped and never leaves the device.

- **activeTab**
  > Used to identify the current tab so detected streams are associated with the correct page and to derive a download filename from the page title.

- **offscreen**
  > Used to assemble large video files in an offscreen document, which has the memory headroom that the service worker lacks. No user data is processed there beyond the video being downloaded.

- **host permission `<all_urls>`**
  > A downloadable video stream can be hosted on any website, so the extension must be able to detect streams and fetch their segments regardless of domain. The extension does not read page content or inject scripts; it only observes stream requests and fetches the segments the user explicitly chooses to download. No browsing data is collected or transmitted.

---

## Data usage disclosures (Privacy practices tab)

Answer the dashboard checkboxes as follows:

- Does this item collect or use user data? -> The extension does **not** collect user data.
- Personally identifiable information: **No**
- Health information: **No**
- Financial / payment information: **No**
- Authentication information: **No**
- Personal communications: **No**
- Location: **No**
- Web history: **No**
- User activity: **No**
- Website content: **No**

Certify the three compliance checkboxes:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

- **Privacy policy URL**: https://kitendo-labs.github.io/K-downloader/privacy.html

---

## Store assets checklist

- [x] Store icon 128x128 (icons/icon-128.png)
- [ ] Screenshots: 1-5 images, 1280x800 or 640x400 (PNG or JPEG). Capture the popup detecting a stream + a download in progress.
- [ ] Small promo tile 440x280 (optional but recommended)
- [ ] Marquee promo 1400x560 (optional)

---

## Submission steps

1. Go to https://chrome.google.com/webstore/devconsole and pay the one-time $5 registration fee if not already done.
2. Click "Add new item" and upload `K-downloader-vX.Y.Z.zip` (build with `./build-release.sh`).
3. Fill the listing fields above (name, descriptions, category, language).
4. Upload the 128x128 icon and screenshots.
5. Privacy practices tab: paste permission justifications, set data disclosures, add the privacy policy URL.
6. Submit for review. With `<all_urls>` + webRequest expect a longer review (days to ~2 weeks).
