// 確定テキストを Notion ページへ追記する。
// ブラウザ/WebView から api.notion.com を直接叩くと CORS で弾かれる場合があるため、
// 任意で Cloudflare Worker などの中継(proxy)URL を挟めるようにしている。
// （proxy を使う場合は app.json の whitelist にそのホストを追加すること）

export interface NotionConfig {
  token: string
  pageId: string
  proxy: string
}

function normalizePageId(v: string): string {
  const m = v.replace(/-/g, '').match(/[0-9a-f]{32}/i)
  if (!m) return v
  const h = m[0]
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export class NotionRecorder {
  private queue: string[] = []
  private busy = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private headerSent = false

  constructor(private cfg: NotionConfig) {}

  private base(): string {
    return this.cfg.proxy || 'https://api.notion.com'
  }

  private async fetchNotion(path: string, init: RequestInit): Promise<Response> {
    return fetch(this.base() + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    })
  }

  /** 記録先ページに到達できるか確認する。 */
  async test(): Promise<boolean> {
    const res = await this.fetchNotion(`/v1/pages/${normalizePageId(this.cfg.pageId)}`, { method: 'GET' })
    return res.ok
  }

  /** 確定テキストを1件キューへ。5秒ごとにまとめて追記する。 */
  enqueue(text: string): void {
    if (!this.cfg.token || !this.cfg.pageId) return
    this.queue.push(text)
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        void this.flush()
      }, 5000)
    }
  }

  /** キューを即時送信する（停止時などに使用）。 */
  async flush(): Promise<void> {
    if (this.busy || this.queue.length === 0) return
    const batch = this.queue.splice(0, this.queue.length)
    const children: unknown[] = []
    if (!this.headerSent) {
      this.headerSent = true
      children.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: `🎙 文字起こし ${new Date().toLocaleString('ja-JP')}` } }],
        },
      })
    }
    for (const t of batch) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: t.slice(0, 2000) } }] },
      })
    }

    this.busy = true
    try {
      const res = await this.fetchNotion(`/v1/blocks/${normalizePageId(this.cfg.pageId)}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children }),
      })
      if (!res.ok) {
        // 失敗分は再送のため戻す
        this.queue.unshift(...batch)
        throw new Error(`Notion HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
    } finally {
      this.busy = false
      if (this.queue.length && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null
          void this.flush()
        }, 5000)
      }
    }
  }
}
