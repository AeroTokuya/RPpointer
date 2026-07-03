// STT プロバイダ実装（Deepgram リアルタイム）。
// Even Hub の音声ブリッジは PCM s16le / 16kHz / mono を Uint8Array で渡してくる。
// それを Deepgram のストリーミングWebSocketへ流し、確定/暫定テキストを受け取る。
//
// 別プロバイダ(AssemblyAI, Whisper 等)へ差し替える場合はこのファイルだけ書き換える。
// その際は app.json の whitelist に接続先ホストを追加すること。

export interface SttSnapshot {
  finalText: string   // 確定した全文
  interimText: string // まだ変化しうる末尾
  finished: boolean   // 終了メッセージなら true
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void
  close(): void
}

export interface SttOptions {
  language?: string // 'ja' | 'en' ...
}

export function startSttStream(
  apiKey: string,
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
  opts: SttOptions = {},
): SttClient {
  if (!apiKey) {
    onError?.(new Error('Deepgram APIキーが未設定です'))
    return { sendPcm() {}, close() {} }
  }

  const lang = opts.language || 'ja'
  const params = new URLSearchParams({
    model: 'nova-2',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    language: lang,
  })
  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`

  let finalText = ''
  let interimText = ''
  const pending: Uint8Array[] = []
  let open = false
  let closed = false

  // ブラウザ/WebView では WebSocket サブプロトコルで Bearer 認証する
  const ws = new WebSocket(url, ['token', apiKey])
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    open = true
    for (const chunk of pending) ws.send(chunk)
    pending.length = 0
  }

  ws.onmessage = (ev: MessageEvent) => {
    let msg: any
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
    } catch {
      return
    }
    if (msg?.type && msg.type !== 'Results') return
    const alt = msg?.channel?.alternatives?.[0]
    const text = (alt?.transcript || '').trim()
    if (!text) return
    if (msg.is_final) {
      finalText = (finalText + ' ' + text).trim()
      interimText = ''
    } else {
      interimText = text
    }
    onSnapshot({ finalText, interimText, finished: false })
  }

  ws.onerror = (ev) => onError?.(ev)
  ws.onclose = () => {
    if (!closed) onSnapshot({ finalText, interimText: '', finished: true })
  }

  return {
    sendPcm(chunk: Uint8Array) {
      if (closed) return
      if (open) ws.send(chunk)
      else pending.push(chunk)
    },
    close() {
      closed = true
      try {
        // Deepgram に終了を伝えてグレースフルに閉じる
        if (open) ws.send(JSON.stringify({ type: 'CloseStream' }))
      } catch {
        /* noop */
      }
      try {
        ws.close()
      } catch {
        /* noop */
      }
    },
  }
}
