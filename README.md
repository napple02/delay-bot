# delay-bot

電車の遅延情報

指定した4路線（田園都市線・半蔵門線・江ノ島線・小田原線）の運行情報を [Yahoo!路線情報](https://transit.yahoo.co.jp/diainfo/area/4) から取得し、遅延の有無をAlexaに発話させるワンショット型カスタムスキル。Alexaアプリの定型アクション（スケジュール実行）からの自動起動を想定する。あわせて同じ判定ロジックでDiscordへ定時通知する（後述）。

## 動作

スキル起動（`LaunchRequest`）時に遅延を判定し、発話後にセッションを終了する。

| ケース | 発話 |
|---|---|
| 遅延あり | 注意してください。現在、[遅延路線名]で、遅延が発生しています。お出かけ前に運行情報をご確認ください。 |
| 遅延なし | 現在、田園都市線、半蔵門線、小田急線はすべて平常運転です。いってらっしゃいませ。 |
| 取得失敗 | すみません、遅延情報の取得に失敗しました。 |

## Discord通知（GitHub Actions）

通勤日の朝（5:50/6:50目標）に、同じ4路線の遅延情報を自動でDiscordへ通知する。Alexaやローカル端末の電源は不要。

データ源は [Yahoo!路線情報の運行情報（関東エリア）](https://transit.yahoo.co.jp/diainfo/area/4) ページ。ページ内の `__NEXT_DATA__`（JSON）の `troubleRails`（運行トラブル中の路線一覧）を参照し、監視対象4路線（railCode: 田園都市線=114・半蔵門線=138・小田原線=109・江ノ島線=110）が含まれるかで遅延を判定する。取得・判定ロジックは `lib/delay.js` に集約し、Alexa（`index.js`）とDiscord（`notify.js`）で共用する。取得は最大3回リトライする。

主な仕様:

- **平日・祝日スキップ**: 土日と、[holidays-jp API](https://holidays-jp.github.io/api/v1/date.json) による日本の祝日は通知しない（通勤日のみ）。cronで月〜金に絞り、祝日は `notify.js` 側で判定。
- **Discord Embed**: 遅延あり=赤／平常=緑のEmbedで、路線ごとの状況・データ更新時刻・Yahooへのリンクを表示。平常時も毎回通知する。
- **ODPT部分フォールバック**: Yahoo取得が3回とも失敗した場合のみ、[公共交通オープンデータセンター(ODPT)](https://developer.odpt.org/) で**半蔵門線・田園都市線のみ**代替取得する（小田急2路線はODPT未提供）。`ODPT_TOKEN` 未設定時はスキップし、従来の取得失敗メッセージを送る。

### セットアップ

1. Discordサーバーの対象チャンネル → 連携 → ウェブフック → 新規ウェブフックを作成し、URLをコピー。
2. GitHubリポジトリ Settings → Secrets and variables → Actions → New repository secret で、名前 `DISCORD_WEBHOOK_URL` として上記URLを登録。
3. （任意・フォールバック用）[ODPT開発者登録](https://developer.odpt.org/) でアクセストークンを取得し、`ODPT_TOKEN` という名前でSecretsに登録。

### スケジュール

GitHub Actions の cron は **UTC**（JST = UTC+9）。`.github/workflows/notify.yml` で2本設定。
Actions実行はキュー混雑で数分遅延しうるため、目標時刻の **10分前** に起動して遅延を吸収する。

cronは平日(JST月〜金 = UTC日〜木, DOW `0-4`)に限定する。

| 目標通知時刻(JST) | 起動(JST) | cron(UTC) |
|---|---|---|
| 5:50 | 5:40 | `40 20 * * 0-4` |
| 6:50 | 6:40 | `40 21 * * 0-4` |

> ⚠️ それでも大幅遅延時は通知が5:50/6:50を過ぎる可能性がある。確実性が必要な場合は起動をさらに前倒しする。Actionsタブから `workflow_dispatch` で手動実行も可能。

## 構成

| ファイル | 内容 |
|---|---|
| `lib/delay.js` | 共有モジュール（監視路線定義・リトライ付き取得・`troubleRails` 判定） |
| `index.js` | Alexa Lambdaエントリーポイント（`lib/delay.js` を利用） |
| `notify.js` | Discord通知スクリプト（祝日スキップ・Embed整形・ODPTフォールバック） |
| `.github/workflows/notify.yml` | 通勤日の朝に `notify.js` を実行するワークフロー |
| `interactionModels/custom/ja-JP.json` | 対話モデル（呼び出し名「通勤路線」） |

## 技術スタック

- 実行環境: AWS Lambda (Node.js) / GitHub Actions (Node.js 24)
- 依存: `ask-sdk-core`（Alexaのみ）。通知はNode標準 `https` のみで追加依存なし
- データ源: Yahoo!路線情報（主）／ODPT（フォールバック）／holidays-jp（祝日判定）

## デプロイ

`node_modules` と **`lib/` ディレクトリ**を含めてzip化し、Lambdaのハンドラを `index.handler` に設定する。
