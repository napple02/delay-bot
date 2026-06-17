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

データ源は [Yahoo!路線情報の運行情報（関東エリア）](https://transit.yahoo.co.jp/diainfo/area/4) ページ。ページ内の `__NEXT_DATA__`（JSON）の `troubleRails`（運行トラブル中の路線一覧）を参照し、監視対象4路線（railCode: 田園都市線=114・半蔵門線=138・小田原線=109・江ノ島線=110）が含まれるかで遅延を判定する。

> 注: 旧データ源 `tetsudo.rti-giken.jp/free/delay.json` は2022年5月に無料公開を終了済み。`index.js`（Alexaスキル）は現在もこの旧URLを参照しており動作しない点に注意。

### セットアップ

1. Discordサーバーの対象チャンネル → 連携 → ウェブフック → 新規ウェブフックを作成し、URLをコピー。
2. GitHubリポジトリ Settings → Secrets and variables → Actions → New repository secret で、名前 `DISCORD_WEBHOOK_URL` として上記URLを登録。

### スケジュール

GitHub Actions の cron は **UTC**（JST = UTC+9）。`.github/workflows/notify.yml` で2本設定。
Actions実行はキュー混雑で数分遅延しうるため、目標時刻の **10分前** に起動して遅延を吸収する。

| 目標通知時刻(JST) | 起動(JST) | cron(UTC) |
|---|---|---|
| 5:50 | 5:40 | `40 20 * * *` |
| 6:50 | 6:40 | `40 21 * * *` |

> ⚠️ それでも大幅遅延時は通知が5:50/6:50を過ぎる可能性がある。確実性が必要な場合は起動をさらに前倒しする。Actionsタブから `workflow_dispatch` で手動実行も可能。

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
