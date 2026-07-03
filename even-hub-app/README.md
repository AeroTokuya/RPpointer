# RP Transcribe → Notion (Even Realities G2 / Even Hub アプリ)

Even Realities G2 の**公式 Even Hub SDK** を使ったアプリです。グラスのマイクで拾った音声を
その場で文字起こしし、

- **グラスのディスプレイにライブ字幕として表示**（`textContainerUpgrade`）
- **確定テキストを Notion ページへ追記記録**

します。ダブルタップでアプリを終了します。

> リポジトリ直下の `glasses.html` は、ブラウザから Web Bluetooth で非公式に G1 BLE
> プロトコルを直接叩く簡易版です。こちらの `even-hub-app/` は **公式 SDK ベース**で、
> BLE 接続やパケット組み立ては Even のコンパニオンアプリ側が担うため、より確実で壊れにくい実装です。

## 仕組み

```
グラスのマイク(PCM 16kHz mono)
  → onEvenHubEvent(audioEvent.audioPcm)
  → Deepgram ストリーミングSTT (src/asr/stt.ts)
      ├─ textContainerUpgrade → グラスに字幕表示 (src/main.ts)
      └─ NotionRecorder.enqueue → Notion ページへ追記 (src/notion.ts)
```

使用している主な公式SDK API（`@evenrealities/even_hub_sdk`）:

| API | 役割 |
| --- | --- |
| `waitForEvenAppBridge()` | グラスへのブリッジ取得 |
| `createStartUpPageContainer` / `TextContainerProperty` | 表示コンテナ(576×288)を作成 |
| `textContainerUpgrade` / `TextContainerUpgrade` | 表示テキストの更新（字幕） |
| `audioControl(true/false)` | マイクの ON/OFF |
| `onEvenHubEvent` | 音声PCM・タップ等のイベント受信 |
| `shutDownPageContainer` / `OsEventTypeList.DOUBLE_CLICK_EVENT` | ダブルタップで終了 |

## 事前に必要なもの

1. **Deepgram の API キー**（音声認識）
   Deepgram 以外（AssemblyAI, Whisper 等）に差し替える場合は `src/asr/stt.ts` だけ書き換え、
   接続先ホストを `app.json` の `whitelist` に追加してください。
2. **Notion のインテグレーショントークンと記録先ページID**
   Notion で「インテグレーション」を作成 → トークン取得 → 記録先ページの「接続先」に追加。
   ページIDは URL 末尾の32桁。
3. （必要な場合のみ）**Notion 中継プロキシ URL**
   WebView から `api.notion.com` を直接呼べず CORS で弾かれる場合は、Cloudflare Worker などの
   中継を用意し、そのホストを `app.json` の `whitelist` に追加してください。Worker のサンプルコードは
   リポジトリ直下の `glasses.html`（④の折りたたみ内）にあります。

これらのキーはアプリ起動後の設定画面（コンパニオンアプリ側）で入力し、端末に保存されます。

## 開発・ビルド

```bash
cd even-hub-app
npm install

# ローカル開発（ブラウザ + シミュレータ）
npm run dev          # Vite dev server (http://localhost:5173)
npm run simulate     # 別ターミナルで Even Hub シミュレータを起動

# 本番ビルド & パッケージ
npm run build        # 型チェック + Vite ビルド → dist/
npm run pack         # Even Hub 用にパッケージ化
```

`npm install` には npm レジストリへの到達が必要です（`@evenrealities/*` を取得します）。

## 実機へのインストール

`npm run pack` で生成したパッケージを Even Hub に提出/サイドロードします。手順は公式ドキュメント
（https://hub.evenrealities.com/docs）に従ってください。

## 注意 / 未確定点

- テキスト表示・ASR・イベント購読は Even 公式のスターターテンプレート（`even-realities/evenhub-templates` の
  `asr` / `text-heavy`）で公開されている SDK API に合わせています。
- `onEvenHubEvent` のイベントオブジェクトの正確なフィールド名（特にダブルタップ判定の `sysType` の
  取り出し方）は SDK バージョンにより異なる可能性があるため、`src/main.ts` では複数の候補を
  フォールバックで見ています。実機・シミュレータで動かして必要なら該当箇所を1行調整してください。
- 表示は 576×288・4bit グレースケール（16階調グリーン）。1画面に収まるよう直近約240文字を追従表示します。
