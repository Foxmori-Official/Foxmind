import type { SummaryRecord } from './summary-archive'
import { t } from './ui'

export function summaryContents(entry: SummaryRecord): HTMLElement[] {
  const { summary } = entry
  const overview = document.createElement('p')
  overview.className = 'overview'
  overview.textContent = summary.overview
  const list = document.createElement('ol')
  list.className = 'points'
  const evidence = new Map(entry.evidence.map(({ id, text }) => [id, text]))
  for (const point of summary.points) {
    const row = document.createElement('li')
    row.append(document.createTextNode(point.text))
    const details = document.createElement('details')
    const label = document.createElement('summary')
    label.dataset.msg = 'evidence'
    label.textContent = t('evidence')
    details.append(label)
    for (const id of point.evidenceIds) {
      const quote = document.createElement('blockquote')
      quote.textContent = evidence.get(id) ?? ''
      details.append(quote)
    }
    row.append(details)
    list.append(row)
  }
  return [overview, list]
}
