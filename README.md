# delay-bot

電車の遅延情報

指定した4路線（田園都市線・半蔵門線・江ノ島線・小田原線）の運行情報を [鉄道遅延情報のJSON](https://tetsudo.rti-giken.jp/free/delay.json) から取得し、遅延の有無をAlexaに発話させるワンショット型カスタムスキル。Alexaアプリの定型アクション（スケジュール実行）からの自動起動を想定する。

## 動作

スキル起動（`LaunchRequest`）時に遅延を判定し、発話後にセッションを終了する。

| ケース | 発話 |
|---|---|
| 遅延あり | 注意してください。現在、[遅延路線名]で、遅延が発生しています。お出かけ前に運行情報をご確認ください。 |
| 遅延なし | 現在、田園都市線、半蔵門線、小田急線はすべて平常運転です。いってらっしゃいませ。 |
| 取得失敗 | すみません、遅延情報の取得に失敗しました。 |

## Discord通知（GitHub Actions）

毎朝5:50と6:50に、同じ4路線の遅延情報を自動でDiscordへテキスト通知する。Alexaやローカル端末の電源は不要。

### セットアップ

1. Discordサーバーの対象チャンネル → 連携 → ウェブフック → 新規ウェブフックを作成し、URLをコピー。
2. GitHubリポジトリ Settings → Secrets and variables → Actions → New repository secret で、名前 `DISCORD_WEBHOOK_URL` として上記URLを登録。

### スケジュール

GitHub Actions の cron は **UTC**（JST = UTC+9）。`.github/workflows/notify.yml` で2本設定。

| JST | UTC（cron） |
|---|---|
| 5:50 | `50 20 * * *` |
| 6:50 | `50 21 * * *` |

> ⚠️ GitHub Actions の cron は混雑時に数分遅延することがある。Actionsタブから `workflow_dispatch` で手動実行も可能。

## 構成

| ファイル | 内容 |
|---|---|
| `index.js` | Lambdaエントリーポイント（`https` で遅延情報取得・判定） |
| `notify.js` | Discord通知スクリプト（遅延情報取得・判定後にWebhookへPOST、Node標準 `https` のみ） |
| `.github/workflows/notify.yml` | 毎朝5:50/6:50に `notify.js` を実行するワークフロー |
| `interactionModels/custom/ja-JP.json` | 対話モデル（呼び出し名「通勤路線」） |

## 技術スタック

- 実行環境: AWS Lambda (Node.js)
- 依存: `ask-sdk-core`
- HTTPクライアント: Node.js標準 `https` モジュール

## デプロイ

`node_modules` を含めてzip化し、Lambdaのハンドラを `index.handler` に設定する。
