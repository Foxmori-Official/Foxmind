import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAIBaseUrl, getAIService } from '../src/ai-service.ts'
import { AI_REQUEST_TIMEOUT_MS, fetchModels, summarize } from '../src/summary.ts'
import { API } from '../src/shared.ts'

const originalFetch = globalThis.fetch
let allowed
let calls
globalThis.chrome = { permissions: { contains: async () => allowed } }
test.beforeEach(() => {
  allowed = true
  calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json({ data: [{ id: 'one' }, { id: 'one' }, { id: 'two' }] })
  }
})
test.after(() => { globalThis.fetch = originalFetch })

test('API bases accept root URLs, custom paths and pasted chat endpoint URLs', () => {
  assert.equal(normalizeAIBaseUrl(' https://custom.example/ '), 'https://custom.example/v1')
  assert.equal(normalizeAIBaseUrl('https://custom.example/api/v1/chat/completions'), 'https://custom.example/api/v1')
  assert.equal(normalizeAIBaseUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1')
  assert.equal(normalizeAIBaseUrl('https://custom.example/gateway/'), 'https://custom.example/gateway')
  for (const value of ['javascript:alert(1)', 'ftp://server/', 'https://user:pass@server/v1', 'https://server/v1?key=secret', 'https://server/v1#key']) {
    assert.throws(() => normalizeAIBaseUrl(value), error => error.code === 'invalidAIUrl')
  }
})

test('old settings still resolve to Foxmori while custom settings choose their own credentials', () => {
  const legacy = { credential: { key: 'fox-key' }, model: 'fox-model' }
  assert.deepEqual(getAIService(legacy), { baseUrl: API, key: 'fox-key', model: 'fox-model' })
  const customAI = { baseUrl: 'https://custom.example/v1', key: 'custom-key', model: 'custom-model' }
  assert.deepEqual(getAIService({ ...legacy, provider: 'custom', customAI }), customAI)
})

test('model lists go directly to the custom API using only its configured key', async () => {
  const service = { baseUrl: 'https://custom.example/openai/v1', key: 'custom-key', model: 'model' }
  assert.deepEqual(await fetchModels(service), ['one', 'two'])
  assert.equal(calls[0].url, service.baseUrl + '/models')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer custom-key')
  assert.equal(calls[0].options.credentials, 'omit')
  assert.equal(calls[0].options.redirect, 'error')
})

test('unauthenticated local APIs receive no Authorization header', async () => {
  await fetchModels({ baseUrl: 'http://localhost:1234/v1', key: '', model: 'local-model' })
  assert.equal(Object.hasOwn(calls[0].options.headers, 'Authorization'), false)
})

test('a revoked permission prevents any outgoing model request', async () => {
  allowed = false
  await assert.rejects(fetchModels({ baseUrl: 'https://custom.example/v1', key: 'key', model: 'model' }), error => error.code === 'aiPermission')
  assert.equal(calls.length, 0)
})

test('custom Chat Completions summaries retain the source citation validation', async () => {
  const input = { title: 'Example', paragraphs: [{ id: 4, text: 'Original evidence' }], limited: false }
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      overview: 'Overview', points: [{ text: 'Point', evidenceIds: [4] }],
    }) } }] })
  }
  const summary = await summarize({ baseUrl: 'https://custom.example/v1', key: 'key', model: 'manual-model' }, 'English', input, new AbortController().signal)
  assert.equal(summary.points[0].evidenceIds[0], 4)
  assert.equal(calls[0].url, 'https://custom.example/v1/chat/completions')
  const request = JSON.parse(calls[0].options.body)
  assert.equal(request.model, 'manual-model')
  assert.equal(request.stream, false)
  assert.deepEqual(JSON.parse(request.messages[1].content), { title: input.title, paragraphs: input.paragraphs })
})

test('model discovery and summaries share a slow-model budget, including response-body timeouts', async () => {
  assert.equal(AI_REQUEST_TIMEOUT_MS, 600_000)
  const originalTimeout = AbortSignal.timeout
  const deadlines = []
  AbortSignal.timeout = ms => {
    assert.equal(ms, AI_REQUEST_TIMEOUT_MS)
    const controller = new AbortController()
    deadlines.push(controller)
    return controller.signal
  }
  const service = { baseUrl: 'https://custom.example/v1', key: 'key', model: 'model' }
  globalThis.fetch = async (_url, { signal }) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    queueMicrotask(() => deadlines.at(-1).abort(new DOMException('Deadline reached', 'TimeoutError')))
  }) })
  try {
    await assert.rejects(fetchModels(service), error => error.code === 'modelTimeout')
    await assert.rejects(summarize(service, 'English', { title: '', paragraphs: [], limited: false }, new AbortController().signal), error => error.code === 'modelTimeout')
    assert.equal(deadlines.length, 2)
  } finally { AbortSignal.timeout = originalTimeout }
})

test('cancelling a summary aborts the model request without retry', async () => {
  const controller = new AbortController()
  let count = 0
  globalThis.fetch = async (_url, { signal }) => new Promise((_, reject) => {
    count++
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    queueMicrotask(() => controller.abort())
  })
  await assert.rejects(summarize({ baseUrl: 'https://custom.example/v1', key: 'key', model: 'model' }, 'English', { title: '', paragraphs: [], limited: false }, controller.signal), error => error.name === 'AbortError')
  assert.equal(count, 1)
})
