import { copyFile } from 'node:fs/promises'
import { build } from 'esbuild'

await build({
  entryPoints: ['src/page.ts'],
  outfile: 'dist/page.js',
  bundle: true,
  format: 'iife',
  globalName: 'foxmindPage',
  target: 'chrome116',
  // chrome.scripting.executeScript returns the last evaluated expression.
  footer: { js: 'foxmindPage.readPage();' },
})

await copyFile('node_modules/@mozilla/readability/LICENSE.md', 'dist/Readability-LICENSE.md')
await copyFile('node_modules/turndown/LICENSE', 'dist/Turndown-LICENSE')
await copyFile('node_modules/turndown-plugin-gfm/LICENSE', 'dist/Turndown-GFM-LICENSE')
await copyFile('LICENSE', 'dist/LICENSE')
