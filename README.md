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

## Discord通知（Cloudflare Workers）

通勤日の朝（5:50/6:40目標）に、同じ4路線の遅延情報を自動でDiscordへ通知する。Alexaやローカル端末の電源は不要。

データ源は [Yahoo!路線情報の運行情報（関東エリア）](https://transit.yahoo.co.jp/diainfo/area/4) ページ。ページ内の `__NEXT_DATA__`（JSON）の `troubleRails`（運行トラブル中の路線一覧）を参照し、監視対象4路線（railCode: 田園都市線=114・半蔵門線=138・小田原線=109・江ノ島線=110）が含まれるかで遅延を判定する。取得・判定ロジックは `lib/delay.js` に集約し、Alexa（`index.js`）と共用する。取得は最大3回リトライする。

主な仕様:

- **平日・祝日スキップ**: 土日と、[holidays-jp API](https://holidays-jp.github.io/api/v1/date.json) による日本の祝日は通知しない（通勤日のみ）。cronで月〜金に絞り、祝日は `worker.js` 側で判定。
- **Discord Embed**: 遅延あり=赤／平常=緑のEmbedで、路線ごとの状況・データ更新時刻・Yahooへのリンクを表示。平常時も毎回通知する。
- **ODPT部分フォールバック**: Yahoo取得が3回とも失敗した場合のみ、[公共交通オープンデータセンター(ODPT)](https://developer.odpt.org/) で**半蔵門線・田園都市線のみ**代替取得する（小田急2路線はODPT未提供）。`ODPT_TOKEN` 未設定時はスキップし、従来の取得失敗メッセージを送る。

### セットアップ

1. Discordサーバーの対象チャンネル → 連携 → ウェブフック → 新規ウェブフックを作成し、URLをコピー。
2. Cloudflare アカウントを作成し、ログイン:
   ```bash
   npx wrangler login
   ```
3. Secrets を登録:
   ```bash
   npx wrangler secret put DISCORD_WEBHOOK_URL
   npx wrangler secret put ODPT_TOKEN  # 任意・フォールバック用
   ```
4. デプロイ:
   ```bash
   npx wrangler deploy
   ```

### スケジュール

Cloudflare Workers の cron は **UTC**（JST = UTC+9）。`wrangler.toml` で2本設定。

| 目標通知時刻(JST) | cron(UTC) |
|---|---|
| 5:50 | `50 20 * * SUN-THU` |
| 6:40（出発10分前） | `40 21 * * SUN-THU` |

### ローカルテスト

```bash
# dev サーバー起動（別ターミナルで）
npx wrangler dev --test-scheduled

# スケジュール実行をシミュレート
curl "http://localhost:8787/__scheduled"

# 本番ログをリアルタイム確認
npx wrangler tail
```

## 構成

| ファイル | 内容 |
|---|---|
| `lib/delay.js` | 共有モジュール（監視路線定義・リトライ付き取得・`troubleRails` 判定） |
| `index.js` | Alexa Lambdaエントリーポイント（`lib/delay.js` を利用） |
| `notify.js` | Discord通知スクリプト・Node.js版（`lib/delay.js` を利用。Cloudflare Workers 移行済みのため通常は未使用） |
| `worker.js` | Cloudflare Workers エントリーポイント（Discord定時通知・cron実行） |
| `wrangler.toml` | Cloudflare Workers 設定（cronスケジュール定義） |
| `.github/workflows/notify.yml` | 手動テスト用ワークフロー（`workflow_dispatch` のみ） |
| `interactionModels/custom/ja-JP.json` | 対話モデル（呼び出し名「通勤路線」） |

## 技術スタック

- 実行環境: AWS Lambda (Node.js) / Cloudflare Workers
- 依存: `ask-sdk-core`（Alexaのみ）。通知はグローバル `fetch` のみで追加依存なし
- データ源: Yahoo!路線情報（主）／ODPT（フォールバック）／holidays-jp（祝日判定）

## デプロイ（Alexa）

`node_modules` と **`lib/` ディレクトリ**を含めてzip化し、Lambdaのハンドラを `index.handler` に設定する。
