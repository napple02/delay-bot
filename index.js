'use strict';

const https = require('https');
const Alexa = require('ask-sdk-core');

/**
 * 監視対象路線（Yahoo!路線情報の railCode と表示名の対応）。
 * railCode は https://transit.yahoo.co.jp/diainfo/<railCode>/0 のID。
 * 4路線とも関東エリア（area/4）に所属する。
 */
const MONITORED_LINES = [
    { code: '114', name: '田園都市線' }, // 東急田園都市線
    { code: '138', name: '半蔵門線' }, // 東京メトロ半蔵門線
    { code: '109', name: '小田原線' }, // 小田急小田原線
    { code: '110', name: '江ノ島線' }, // 小田急江ノ島線
];

/** Yahoo!路線情報 運行情報（関東エリア）のページURL */
const DIAINFO_AREA_URL = 'https://transit.yahoo.co.jp/diainfo/area/4';

/**
 * 指定URLのHTMLを取得する。
 *
 * Args:
 *     url (str): 取得対象のURL。
 *
 * Returns:
 *     Promise<str>: レスポンス本文（UTF-8）。
 *
 * Raises:
 *     Error: 通信失敗・HTTPステータス異常時。
 */
function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        // 既定のUAだと弾かれる場合があるためブラウザ相当のUAを送る
        const options = { headers: { 'User-Agent': 'Mozilla/5.0' } };
        https
            .get(url, options, (res) => {
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
                res.on('end', () => resolve(data));
            })
            .on('error', reject);
    });
}

/**
 * Yahoo!路線情報ページの __NEXT_DATA__ JSONを抽出してパースする。
 *
 * Args:
 *     html (str): 運行情報ページのHTML。
 *
 * Returns:
 *     object: __NEXT_DATA__ のパース結果。
 *
 * Raises:
 *     Error: JSON部分が見つからない・パース失敗時。
 */
function parseNextData(html) {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!match) {
        throw new Error('運行情報データ(__NEXT_DATA__)が見つかりませんでした。');
    }
    return JSON.parse(match[1]);
}

/**
 * 関東エリアの運行情報を取得し、監視対象路線のうち遅延中のものを抽出する。
 *
 * Returns:
 *     Promise<Array<object>>: `{ name, status }` の配列。遅延がなければ空配列。
 *
 * Raises:
 *     Error: 取得・パース失敗時。
 */
async function fetchDelayedLines() {
    const html = await fetchHtml(DIAINFO_AREA_URL);
    const nextData = parseNextData(html);
    // トラブル中の路線のみが troubleRails に入る（平常運転の路線は含まれない）
    const troubleRails = nextData.props.pageProps.troubleRails || [];

    const delayed = [];
    for (const rail of troubleRails) {
        const property = (rail.routeInfo && rail.routeInfo.property) || {};
        const monitored = MONITORED_LINES.find((line) => line.code === String(property.railCode));
        if (!monitored) {
            continue;
        }
        // diainfo[0] に現在の運行状況（列車遅延・運転見合わせ等）が入る
        const info = (property.diainfo && property.diainfo[0]) || {};
        delayed.push({ name: monitored.name, status: info.status || '運行情報あり' });
    }
    return delayed;
}

/** スキル起動（LaunchRequest）を処理するハンドラ */
const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        let speech;

        try {
            const delayedLines = await fetchDelayedLines();

            if (delayedLines.length > 0) {
                const names = delayedLines.map((line) => line.name).join('、');
                speech = `注意してください。現在、${names}で、遅延が発生しています。お出かけ前に運行情報をご確認ください。`;
            } else {
                speech = '現在、田園都市線、半蔵門線、小田急線はすべて平常運転です。いってらっしゃいませ。';
            }
        } catch (err) {
            console.error('遅延情報の取得に失敗しました:', err);
            speech = 'すみません、遅延情報の取得に失敗しました。';
        }

        // 発話後にセッションを終了する（ワンショット起動）
        return handlerInput.responseBuilder
            .speak(speech)
            .withShouldEndSession(true)
            .getResponse();
    },
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(LaunchRequestHandler)
    .lambda();
