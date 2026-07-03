// 端末(コンパニオンアプリ)側の画面。設定入力とライブ確認に使う。
// グラス本体への表示は main.ts が SDK 経由で行う。

export interface Config {
  deepgramKey: string
  notionToken: string
  notionPageId: string
  notionProxy: string
  lang: string
}

const CONFIG_KEY = 'rp-glass-transcribe-config'

export function loadConfig(): Config {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
    return {
      deepgramKey: c.deepgramKey || '',
      notionToken: c.notionToken || '',
      notionPageId: c.notionPageId || '',
      notionProxy: c.notionProxy || '',
      lang: c.lang || 'ja',
    }
  } catch {
    return { deepgramKey: '', notionToken: '', notionPageId: '', notionProxy: '', lang: 'ja' }
  }
}

export function saveConfig(c: Config): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
}

let transcriptEl: HTMLElement
let statusEl: HTMLElement

export function mountUi(cfg: Config, onStart: () => void, onStop: () => void): { getConfig: () => Config } {
  const root = document.getElementById('app')!
  root.innerHTML = `
    <h1>RP TRANSCRIBE</h1>
    <div class="sub">EVEN G2 → NOTION 文字起こし</div>

    <div class="card">
      <div class="label">DEEPGRAM API KEY（音声認識）</div>
      <input id="cfg-dg" type="password" placeholder="Deepgram のAPIキー" />
      <div class="label">NOTION TOKEN</div>
      <input id="cfg-token" type="password" placeholder="ntn_... / secret_..." />
      <div class="label">NOTION PAGE ID</div>
      <input id="cfg-page" type="text" placeholder="記録先ページID（URL末尾32桁）" />
      <div class="label">NOTION PROXY URL（CORS中継・任意）</div>
      <input id="cfg-proxy" type="text" placeholder="https://xxxx.workers.dev（直接不可なとき）" />
      <div class="label">言語</div>
      <input id="cfg-lang" type="text" placeholder="ja / en" />
    </div>

    <div class="card">
      <div class="label">操作</div>
      <label class="row"><button id="btn-start">開始</button> <button id="btn-stop">停止</button></label>
      <div id="status">待機中</div>
    </div>

    <div class="card">
      <div class="label">TRANSCRIPT（グラスにも同じ内容が表示されます）</div>
      <div id="transcript"></div>
    </div>

    <div class="card">
      <div class="hint">
        グラス側では文字起こしがリアルタイム表示されます。ダブルタップでアプリを終了します。<br>
        確定したテキストは指定した Notion ページに追記されます。
      </div>
    </div>
  `

  const dg = root.querySelector<HTMLInputElement>('#cfg-dg')!
  const token = root.querySelector<HTMLInputElement>('#cfg-token')!
  const page = root.querySelector<HTMLInputElement>('#cfg-page')!
  const proxy = root.querySelector<HTMLInputElement>('#cfg-proxy')!
  const lang = root.querySelector<HTMLInputElement>('#cfg-lang')!
  dg.value = cfg.deepgramKey
  token.value = cfg.notionToken
  page.value = cfg.notionPageId
  proxy.value = cfg.notionProxy
  lang.value = cfg.lang

  const getConfig = (): Config => ({
    deepgramKey: dg.value.trim(),
    notionToken: token.value.trim(),
    notionPageId: page.value.trim(),
    notionProxy: proxy.value.trim().replace(/\/+$/, ''),
    lang: lang.value.trim() || 'ja',
  })
  for (const el of [dg, token, page, proxy, lang]) {
    el.addEventListener('change', () => saveConfig(getConfig()))
  }

  root.querySelector('#btn-start')!.addEventListener('click', onStart)
  root.querySelector('#btn-stop')!.addEventListener('click', onStop)

  transcriptEl = root.querySelector('#transcript')!
  statusEl = root.querySelector('#status')!
  return { getConfig }
}

export function setStatus(msg: string): void {
  if (statusEl) statusEl.textContent = msg
}

export function setTranscript(finalText: string, interimText: string): void {
  if (!transcriptEl) return
  transcriptEl.innerHTML = ''
  transcriptEl.appendChild(document.createTextNode(finalText))
  if (interimText) {
    const span = document.createElement('span')
    span.className = 'interim'
    span.textContent = (finalText ? ' ' : '') + interimText
    transcriptEl.appendChild(span)
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight
}
