<div align="center">
  <img src="../public/icons/foxmind.svg" alt="" width="80" height="80">
  <h1>Foxmind</h1>
  <p>Summarize pages and selections, revisit local summaries, export pages and send resources to Foxdown</p>
  <p><a href="https://github.com/Foxmori-Official/Foxmind/releases/latest">Download</a> · <a href="../README.md">简体中文</a></p>
</div>

## Quick install

1. Download and extract foxmind-0.0.1.zip from [Releases](https://github.com/Foxmori-Official/Foxmind/releases/latest).
2. Open chrome://extensions or edge://extensions, enable Developer mode and load the folder containing manifest.json with **Load unpacked**.
3. Follow setup to sign in at [foxmori.com](https://foxmori.com/#models), read your account, choose a subscription group and obtain a Foxmind API key. You can also enter an existing key from the Foxmori console.
4. Choose a chat model and enable page content permission. Pin Foxmind, open a webpage, click its icon and choose **Summarize page**.

Click the toolbar icon again to close the panel. The manifest requires Chrome / Edge 116 or later. Automated browser acceptance uses Chromium.

## Features

- Summarize pages with expandable source passages. Completed summaries stay visible when you navigate.
- Summarize selections independently between the page summary and resources.
- Search locally archived summaries by title, URL, summary or quoted evidence, then open, delete or clear records.
- Export pages as static HTML or Markdown. HTML retains external asset URLs.
- Discover attachments and permitted media requests, then send them to a Foxdown server.

The interface supports English and Simplified Chinese.

## Foxdown

Start [Foxdown](https://github.com/Foxmori-Official/Foxdown), enter its server address in Settings and add its Web API token if configured. The default local address is http://127.0.0.1:16801. Connect and save, then refresh resources after starting media playback.

## Privacy

Summaries require page content permission and an explicit button click. Page titles and extracted text are sent to Foxmori. Normal-window summaries, quoted passages and full source URLs remain in this browser profile's local archive and are available after switching Foxmori accounts. Private-window summaries last until that window closes.

Settings and API keys are stored locally. Page export runs locally. Download handoff sends resource URLs and required request headers to the configured Foxdown server.

## Build

Use Node.js 26 and npm.

~~~sh
git clone https://github.com/Foxmori-Official/Foxmind.git
cd Foxmind
npm ci
npm run build
~~~

Load dist in the browser. Run npm run typecheck and npm test for checks. Install Chromium with npx playwright install chromium, then run npm run test:browser. On a headless Linux host use xvfb-run --auto-servernum npm run test:browser. Run npm run package to create the ZIP and SHA256 checksums. GitHub Actions builds release artifacts.

## License

Foxmind uses GPL-3.0. Mozilla Readability, Turndown and its GFM plugin retain their respective licenses. [License](../LICENSE)

See the [Chinese README](../README.md#致谢与许可) for related projects.
