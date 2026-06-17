'use strict';

const https = require('https');
const Alexa = require('ask-sdk-core');

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

/** スキル起動（LaunchRequest）を処理するハンドラ */
const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        let speech;

        try {
            const delayList = await fetchDelayInfo();
            // 監視対象路線のうち、現在遅延しているものを抽出する
            const delayedLines = delayList
                .filter((item) => MONITORED_LINES.includes(item.name))
                .map((item) => item.name);

            if (delayedLines.length > 0) {
                speech = `注意してください。現在、${delayedLines.join('、')}で、遅延が発生しています。お出かけ前に運行情報をご確認ください。`;
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
