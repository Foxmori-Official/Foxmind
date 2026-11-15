import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'))
assert.equal(manifest.version, pkg.version)
assert.equal(manifest.name, 'Foxmind')
for (const file of ['background.js', 'sidepanel.js', 'page.js', 'options.html', 'onboarding.html', 'icons/foxmind-128.png']) {
  assert.ok((await readFile('dist/' + file)).length, file)
}
await mkdir('release', { recursive: true })
const name = 'foxmind-' + pkg.version + '.zip'
const destination = resolve('release', name)
await import('node:fs/promises').then(fs => fs.rm(destination, { force: true }))
execFileSync('zip', ['-qr', destination, '.', '-x', '*.DS_Store'], { cwd: 'dist' })
const hash = createHash('sha256').update(await readFile(destination)).digest('hex')
await writeFile('release/SHA256SUMS.txt', hash + '  ' + name + '\n')
console.log('release/' + name)
