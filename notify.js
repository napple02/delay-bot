'use strict';

const { notify } = require('./lib/notify');

/**
 * 遅延情報を取得し、Discordへ通知するエントリーポイント（Node.js手動実行用）。
 */
async function main() {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('環境変数 DISCORD_WEBHOOK_URL が設定されていません。');
        process.exit(1);
    }

    try {
        await notify(webhookUrl, process.env.ODPT_TOKEN);
    } catch (err) {
        console.error('Discordへの通知に失敗しました:', err);
        process.exit(1);
    }
}

main();
