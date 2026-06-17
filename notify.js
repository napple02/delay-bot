'use strict';

const https = require('https');

/** 監視対象の路線名（APIレスポンスの name と完全一致させる） */
const MONITORED_LINES = ['田園都市線', '半蔵門線', '江ノ島線', '小田原線'];

/** 遅延情報APIのエンドポイント */
const DELAY_API_URL = 'https://tetsudo.rti-giken.jp/free/delay.json';

/**
 * 遅延情報APIから現在遅延中の路線一覧を取得する。
 *
 * Returns:
 *     Promise<Array<object>>: 遅延中の鉄道路線オブジェクトの配列。
 *
 * Raises:
 *     Error: 通信失敗・HTTPステータス異常・JSONパース失敗時。
 */
function fetchDelayInfo() {
    return new Promise((resolve, reject) => {
        https
            .get(DELAY_API_URL, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`予期しないステータスコード: ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(err);
                    }
                });
            })
            .on('error', (err) => {
                reject(err);
            });
    });
}

/**
 * 遅延情報をもとに通知メッセージを生成する。
 *
 * Args:
 *     delayList (Array<object>): 遅延中の鉄道路線オブジェクトの配列。
 *
 * Returns:
 *     str: Discordへ送信するメッセージ本文。
 */
function buildMessage(delayList) {
    // 監視対象路線のうち、現在遅延しているものを抽出する
    const delayedLines = delayList
        .filter((item) => MONITORED_LINES.includes(item.name))
        .map((item) => item.name);

    if (delayedLines.length > 0) {
        return `注意してください。現在、${delayedLines.join('、')}で、遅延が発生しています。お出かけ前に運行情報をご確認ください。`;
    }
    return '現在、田園都市線、半蔵門線、小田急線はすべて平常運転です。いってらっしゃいませ。';
}

/**
 * Discord WebhookへメッセージをPOSTする。
 *
 * Args:
 *     webhookUrl (str): Discord WebhookのURL。
 *     content (str): 送信するメッセージ本文。
 *
 * Returns:
 *     Promise<void>: 送信完了時に解決する。
 *
 * Raises:
 *     Error: 通信失敗・HTTPステータス異常時。
 */
function postToDiscord(webhookUrl, content) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ content });
        const url = new URL(webhookUrl);
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(url, options, (res) => {
            // Discord Webhookは成功時に204を返す
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`Discord送信に失敗しました（ステータス: ${res.statusCode}）`));
                return;
            }
            res.resume();
            res.on('end', resolve);
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * 遅延情報を取得し、Discordへ通知するエントリーポイント。
 */
async function main() {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('環境変数 DISCORD_WEBHOOK_URL が設定されていません。');
        process.exit(1);
    }

    let content;
    try {
        const delayList = await fetchDelayInfo();
        content = buildMessage(delayList);
    } catch (err) {
        console.error('遅延情報の取得に失敗しました:', err);
        content = 'すみません、遅延情報の取得に失敗しました。';
    }

    try {
        await postToDiscord(webhookUrl, content);
        console.log('Discordへ通知しました:', content);
    } catch (err) {
        console.error('Discordへの通知に失敗しました:', err);
        process.exit(1);
    }
}

main();
