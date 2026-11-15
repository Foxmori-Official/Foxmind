import {
  archiveArea, archiveKey, deleteArchivedSummary, emptyArchive, readArchive,
  type ArchiveScope, type SummaryArchive, type SummaryRecord,
} from './summary-archive'
import { summaryContents } from './summary-view'
import { el, errorCopy, t, uiLanguage } from './ui'

function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

export async function initializeSummaryArchiveSettings() {
  const window = await chrome.windows.getCurrent()
  if (window.id === undefined) return
  const scope: ArchiveScope = { windowId: window.id, incognito: window.incognito }
  const list = el('archiveEntries')
  const search = el<HTMLInputElement>('archiveSearch')
  const archiveCount = el('archiveCount')
  const clear = el<HTMLButtonElement>('clearArchive')
  const remove = el<HTMLButtonElement>('deleteArchiveEntry')
  const reader = el<HTMLDialogElement>('archiveReader')
  const readBody = el('archiveReadBody')
  const source = el<HTMLAnchorElement>('archiveSource')
  const date = new Intl.DateTimeFormat(uiLanguage(), { dateStyle: 'medium', timeStyle: 'short' })
  let opened: string | undefined
  let entries: { record: SummaryRecord; text: string }[] = []
  let changing = false
  let revision = 0

  function showStatus(id: string, message = '') {
    const status = el(id)
    status.textContent = message
    status.hidden = !message
  }

  function showRecord(entry: SummaryRecord) {
    const hostname = new URL(entry.url).hostname
    opened = entry.id
    el('archiveReadTitle').textContent = entry.title || hostname
    el('archiveReadMeta').textContent = [hostname, date.format(entry.at), t(entry.selected ? 'selectedText' : 'wholePageSummary')].join(' · ')
    readBody.replaceChildren(...summaryContents(entry))
    if (entry.limited) {
      const hint = document.createElement('p')
      hint.className = 'muted'
      hint.textContent = t('partial')
      readBody.prepend(hint)
    }
    source.href = entry.url
    showStatus('archiveReadStatus')
    reader.showModal()
    reader.scrollTop = 0
  }

  function makeRow(entry: SummaryRecord) {
    const hostname = new URL(entry.url).hostname
    const row = document.createElement('button')
    row.className = 'archive-item'
    row.type = 'button'
    row.setAttribute('aria-haspopup', 'dialog')
    const icon = document.createElement('span')
    icon.className = 'archive-item-icon'
    icon.setAttribute('aria-hidden', 'true')
    const glyph = document.createElement('span')
    glyph.className = 'archive-glyph'
    icon.append(glyph)
    const text = document.createElement('span')
    const title = document.createElement('span')
    title.className = 'archive-item-title'
    title.textContent = entry.title || hostname
    const meta = document.createElement('span')
    meta.className = 'archive-item-meta'
    meta.textContent = hostname + ' · ' + t(entry.selected ? 'selectedText' : 'wholePageSummary')
    text.append(title, meta)
    const time = document.createElement('time')
    time.className = 'archive-item-date'
    time.dateTime = new Date(entry.at).toISOString()
    time.textContent = date.format(entry.at)
    const chevron = document.createElement('span')
    chevron.className = 'archive-chevron'
    chevron.setAttribute('aria-hidden', 'true')
    row.append(icon, text, time, chevron)
    row.addEventListener('click', () => showRecord(entry))
    return row
  }

  function showMatches() {
    const terms = normalizeSearch(search.value).match(/\S+/gu) ?? []
    const matches = terms.length ? entries.filter(item => terms.every(term => item.text.includes(term))) : entries
    archiveCount.textContent = matches.length === entries.length ? String(entries.length) : matches.length + ' / ' + entries.length
    archiveCount.hidden = !entries.length
    clear.disabled = changing || !entries.length
    el('archiveEmpty').hidden = Boolean(matches.length)
    el('archiveEmptyTitle').textContent = t(entries.length ? 'archiveNoMatches' : 'archiveEmpty')
    el('archiveEmptyHint').textContent = t(entries.length ? 'archiveNoMatchesHint' : 'archiveEmptyHint')
    list.replaceChildren(...matches.map(item => makeRow(item.record)))
  }

  function paint(archive: SummaryArchive) {
    entries = [...archive.entries].sort((a, b) => b.at - a.at).map(record => {
      const text = normalizeSearch([
        record.title, record.url, record.summary.overview,
        ...record.summary.points.map(point => point.text),
        ...record.evidence.map(paragraph => paragraph.text),
      ].join('\n'))
      return { record, text }
    })
    if (opened && !entries.some(item => item.record.id === opened)) reader.close()
    showMatches()
    showStatus('archiveStatus')
  }

  async function refresh() {
    const before = revision
    const archive = await readArchive(scope)
    if (before === revision) paint(archive)
  }

  async function erase(id?: string) {
    if (changing) return
    changing = clear.disabled = remove.disabled = true
    try {
      await deleteArchivedSummary(scope, id)
      if (!id) search.value = ''
      await refresh()
    } catch (error) {
      showStatus(reader.open ? 'archiveReadStatus' : 'archiveStatus', errorCopy(error))
    } finally {
      changing = remove.disabled = false
      clear.disabled = !entries.length
    }
  }

  reader.addEventListener('close', () => {
    opened = undefined
    readBody.replaceChildren()
    source.removeAttribute('href')
  })
  search.placeholder = t('archiveSearchHint')
  search.addEventListener('input', showMatches)
  clear.addEventListener('click', () => void erase())
  remove.addEventListener('click', () => { if (opened) void erase(opened) })
  const key = archiveKey(scope)
  const area = archiveArea(scope)
  chrome.storage[area].onChanged.addListener(changes => {
    if (!changes[key]) return
    revision++
    paint(changes[key].newValue ?? emptyArchive)
  })
  el('privateArchiveNotice').hidden = !scope.incognito
  await refresh()
}
