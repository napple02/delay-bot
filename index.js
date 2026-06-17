'use strict';

const Alexa = require('ask-sdk-core');
const { fetchDelayedLines } = require('./lib/delay');

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
