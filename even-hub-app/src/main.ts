// RP Transcribe → Notion  (Even Realities G2 / Even Hub アプリ)
//
// 流れ:
//   グラスのマイク音声(PCM) → Deepgram で文字起こし
//     → グラスのディスプレイにライブ字幕表示 (SDK: textContainerUpgrade)
//     → 確定テキストを Notion ページへ追記
//   ダブルタップでアプリ終了。

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { startSttStream, type SttClient } from './asr/stt'
import { NotionRecorder } from './notion'
import { mountUi, loadConfig, saveConfig, setStatus, setTranscript, type Config } from './ui'

// グラス表示は 576x288。1画面に収まる範囲だけを追従表示する。
const GLASS_TAIL_CHARS = 240
const CONTAINER_ID = 1
const CONTAINER_NAME = 'transcript'

let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>
let stt: SttClient | null = null
let notion: NotionRecorder | null = null
let running = false

// textContainerUpgrade はBLE帯域が細いので120msにデバウンスする
let pendingGlassText: string | null = null
let glassTimer: ReturnType<typeof setInterval> | null = null

async function main() {
  const cfg = loadConfig()
  const ui = mountUi(cfg, () => void start(ui.getConfig()), () => void stop())

  setStatus('グラスに接続中…')
  bridge = await waitForEvenAppBridge()

  // グラスに表示するテキストコンテナを1つ作成
  const transcript = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    content: 'Ready',
    isEventCapture: 1,
  })
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [transcript] }),
  )

  // イベント購読: 音声PCM → STT、ダブルタップ → 終了
  bridge.onEvenHubEvent((event: any) => {
    const pcm = event?.audioEvent?.audioPcm
    if (pcm && stt) stt.sendPcm(pcm)

    const sysType =
      event?.sysEvent?.eventType ??
      event?.systemEvent?.type ??
      event?.osEvent?.type ??
      event?.sysType
    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void shutdown()
    }
  })

  setStatus('待機中。開始を押してください。')
}

async function start(cfg: Config) {
  if (running) return
  saveConfig(cfg)

  if (!cfg.deepgramKey) {
    setStatus('Deepgram APIキーを入力してください')
    return
  }
  notion = new NotionRecorder({ token: cfg.notionToken, pageId: cfg.notionPageId, proxy: cfg.notionProxy })

  // マイクを有効化
  await bridge.audioControl(true)

  stt = startSttStream(
    cfg.deepgramKey,
    ({ finalText, interimText }) => {
      setTranscript(finalText, interimText)
      // グラスへは「確定+暫定」の末尾を表示
      const live = (finalText + (interimText ? ' ' + interimText : '')).trim()
      queueGlassText(live.slice(-GLASS_TAIL_CHARS))
      // 確定した末尾の文だけ Notion に記録
      recordFinals(finalText)
    },
    (err) => setStatus('STTエラー: ' + errMsg(err)),
    { language: cfg.lang },
  )

  startGlassPump()
  running = true
  setStatus('文字起こし中… （グラスをダブルタップで終了）')
}

async function stop() {
  if (!running) return
  running = false
  try {
    await bridge.audioControl(false)
  } catch {
    /* noop */
  }
  stt?.close()
  stt = null
  stopGlassPump()
  await notion?.flush()
  setStatus('停止しました')
}

async function shutdown() {
  await stop()
  try {
    await bridge.shutDownPageContainer(1)
  } catch {
    /* noop */
  }
}

// ---- Notion: 新しく確定した分だけ記録する --------------------------------
let recordedLen = 0
function recordFinals(finalText: string) {
  if (!notion) return
  if (finalText.length <= recordedLen) return
  const fresh = finalText.slice(recordedLen).trim()
  recordedLen = finalText.length
  if (fresh) notion.enqueue(`[${new Date().toLocaleTimeString('ja-JP', { hour12: false })}] ${fresh}`)
}

// ---- グラス表示のデバウンス送信 ------------------------------------------
function queueGlassText(text: string) {
  pendingGlassText = text
}
function startGlassPump() {
  if (glassTimer) return
  glassTimer = setInterval(() => {
    if (pendingGlassText === null) return
    const content = pendingGlassText || ' '
    pendingGlassText = null
    void bridge
      .textContainerUpgrade(new TextContainerUpgrade({ containerID: CONTAINER_ID, containerName: CONTAINER_NAME, content }))
      .catch(() => {})
  }, 120)
}
function stopGlassPump() {
  if (glassTimer) {
    clearInterval(glassTimer)
    glassTimer = null
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

main().catch((e) => setStatus('起動エラー: ' + errMsg(e)))
