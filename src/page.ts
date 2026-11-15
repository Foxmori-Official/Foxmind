import { Readability } from '@mozilla/readability'
import type { PageSnapshot, Paragraph } from './shared'

const blocked = 'script, style, noscript, iframe, svg, form, nav, aside, footer, [role="navigation"], [hidden], [aria-hidden="true"]'
const blocks = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,dd,dt,tr'
const paragraphLimit = 1_600
const snapshotLimit = 64_000
const maxParagraphs = 250

function cleanClone(): Document {
  const copy = document.cloneNode(true) as Document
  const originalNodes = document.body.querySelectorAll('*')
  const copiedNodes = copy.body.querySelectorAll('*')
  for (let index = 0; index < originalNodes.length; index++) {
    const source = originalNodes[index]
    const target = copiedNodes[index]
    if (!copy.body.contains(target)) continue

    if (target.matches('tv-translation[data-tv-owned].tv-tr-replace')) {
      const backup = target.querySelector<HTMLTemplateElement>('template.tv-backup')
      if (backup) target.replaceWith(backup.content.cloneNode(true))
      else target.remove()
      continue
    }
    if (target.matches(blocked + ', [data-tv-owned]')) {
      target.remove()
      continue
    }
    const style = getComputedStyle(source)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') target.remove()
  }
  copy.querySelectorAll(blocked + ', template, [data-tv-owned]').forEach(element => element.remove())
  return copy
}

function collectParagraphs(root: Element): Pick<PageSnapshot, 'paragraphs' | 'limited'> {
  const elements = [...root.querySelectorAll(blocks)].filter(element => !element.querySelector(blocks))
  const candidates = elements.length ? elements : [root]
  const paragraphs: Paragraph[] = []
  let characters = 0
  for (const element of candidates) {
    const raw = element.textContent ?? ''
    const clean = element.matches('pre') ? raw.trim() : raw.replace(/\s+/gu, ' ').trim()
    for (let start = 0; start < clean.length; start += paragraphLimit) {
      const text = clean.slice(start, start + paragraphLimit)
      characters += text.length
      if (characters > snapshotLimit || paragraphs.length >= maxParagraphs) return { paragraphs, limited: true }
      paragraphs.push({ text, heading: element.matches('h1,h2,h3,h4,h5,h6') })
    }
  }
  return { paragraphs, limited: false }
}

export function readPage(): PageSnapshot {
  const snapshot: PageSnapshot = {
    url: location.href,
    title: document.title.trim().slice(0, 300),
    paragraphs: [],
    limited: false,
  }
  if (!document.body) return snapshot

  const doc = cleanClone()
  const article = new Readability(doc.cloneNode(true) as Document, {
    serializer: element => element,
    maxElemsToParse: 30_000,
  })
  try {
    const parsed = article.parse()
    if (parsed?.textContent?.trim() && parsed.content instanceof Element) {
      const content = collectParagraphs(parsed.content)
      if (content.paragraphs.length) return { ...snapshot, ...content, title: parsed.title?.slice(0, 300) || snapshot.title }
    }
  } catch { /* Large or unusual DOMs can still be read through their main element. */ }

  const main = doc.querySelector('main, article, [role="main"]')
  const content = main ? collectParagraphs(main) : undefined
  return { ...snapshot, ...(content?.paragraphs.length ? content : collectParagraphs(doc.body)) }
}
