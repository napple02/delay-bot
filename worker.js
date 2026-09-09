'use strict';

import { notify } from './lib/notify.js';

/** Cloudflare Workers エントリポイント */
export default {
    async scheduled(_event, env, _ctx) {
        const webhookUrl = env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
            console.error('環境変数 DISCORD_WEBHOOK_URL が設定されていません。');
            return;
        }

        try {
            await notify(webhookUrl, env.ODPT_TOKEN);
        } catch (err) {
            console.error('Discordへの通知に失敗しました:', err);
        }
    },
};
