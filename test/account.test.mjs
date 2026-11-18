import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/account.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { readAccount, issueKey } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
let calls, saved, replies
globalThis.location = { origin: 'https://foxmori.com' }
globalThis.window = {}
window.top = window
globalThis.chrome = {
  tabs: { query: async () => [{ id: 1, url: 'https://foxmori.com/#models', incognito: false }] },
  scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] },
  storage: { local: { set: async value => { saved = value } } },
}
test.beforeEach(() => {
  calls = []
  saved = undefined
  replies = new Map([
    ['user/profile', { id: 12, email: 'account-a@example.test' }],
    ['groups/available', { items: [{ id: 7, name: 'Shared group' }] }],
    ['keys', { key: 'shared-or-renamed-key' }],
  ])
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname.replace('/api/console/', '')
    calls.push({ path, options })
    const value = replies.get(path)
    return value instanceof Response ? value : Response.json({ code: 0, data: value })
  }
})

test('account connection uses only profile and available groups, including paginated groups', async () => {
  assert.deepEqual(await readAccount(), { id: 12, label: 'account-a@example.test', groups: [{ id: 7, name: 'Shared group' }] })
  assert.deepEqual(calls.map(call => call.path), ['user/profile', 'groups/available'])
  assert.deepEqual(saved, { foxmoriAccount: { id: 12, label: 'account-a@example.test' } })
  replies.set('groups/available', [{ id: 8, name: 'Another group' }])
  assert.equal((await readAccount()).groups[0].id, 8)
})

test('key creation uses one generic POST with the existing account ID and default name', async () => {
  assert.equal(await issueKey(12, 7), 'shared-or-renamed-key')
  assert.equal(calls.length, 1)
  const { path, options } = calls[0]
  assert.equal(path, 'keys')
  assert.equal(options.method, 'POST')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(options.body), { name: 'Foxmind', account_id: 12, group_id: 7 })
})

test('login and account changes fail once without retrying key creation', async () => {
  for (const [status, code] of [[401, 'loginRequired'], [409, 'accountChanged'], [403, 'groupUnavailable']]) {
    replies.set('keys', Response.json({}, { status }))
    await assert.rejects(issueKey(12, 7), error => error.code === code)
  }
  assert.deepEqual(calls.map(call => call.path), ['keys', 'keys', 'keys'])
})

test('incomplete or masked generic key responses cannot be saved', async () => {
  for (const key of ['', 'masked***', undefined]) {
    replies.set('keys', { key })
    await assert.rejects(issueKey(12, 7), error => error.code === 'invalidKey')
  }
})
