import TurndownService from 'turndown'
import { tables } from 'turndown-plugin-gfm'
import type { ExportFormat } from './page-export'

export function downloadExport(title: string, content: string, format: ExportFormat) {
  if (format === 'markdown') {
    const template = document.createElement('template')
    template.innerHTML = content
    const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    converter.use(tables)
    content = converter.turndown(template.content) + '\n'
  }

  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100).replace(/[. ]+$/, '') || 'foxmind-page'
  const isHtml = format === 'html'
  const file = new Blob([content], { type: isHtml ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' })
  const href = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = href
  link.download = name + (isHtml ? '.html' : '.md')
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}
