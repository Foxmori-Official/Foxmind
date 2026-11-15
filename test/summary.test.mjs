import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSummary, prepareInput } from '../src/summary.ts'

test('long pages preserve source IDs and respect the request budget', () => {
  const paragraphs = Array.from({ length: 35 }, (_, index) => ({
    text: ((index % 7 === 0 ? 'Heading ' : 'Paragraph ') + index + ' ').repeat(140),
    heading: index % 7 === 0,
  }))
  const input = prepareInput('Example', paragraphs, false)
  assert.equal(input.limited, true)
  assert.ok(input.paragraphs.reduce((size, item) => size + item.text.length, 0) <= 14_000)
  assert.ok(input.paragraphs.at(-1).id >= 30)
  for (const item of input.paragraphs) assert.ok(paragraphs[item.id - 1].text.startsWith(item.text))
})

test('the model must cite paragraphs actually provided to it', () => {
  const input = { title: 'Example', paragraphs: [{ id: 7, text: 'Source' }], limited: false }
  const valid = { overview: 'Overview', points: [{ text: 'Point', evidenceIds: [7, 7] }] }
  const fence = String.fromCharCode(96).repeat(3)
  assert.deepEqual(parseSummary(fence + 'json\n' + JSON.stringify(valid) + '\n' + fence, input), {
    overview: 'Overview', points: [{ text: 'Point', evidenceIds: [7] }],
  })
  valid.points[0].evidenceIds = [8]
  assert.throws(() => parseSummary(JSON.stringify(valid), input), /badSummary/)
})
