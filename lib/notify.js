'use strict';

const { MONITORED_LINES, fetchDelayedLines } = require('./delay');

/** 日本の祝日一覧API（{"YYYY-MM-DD":"祝日名"} 形式） */
const HOLIDAYS_API_URL = 'https://holidays-jp.github.io/api/v1/date.json';

/** ODPT運行情報APIのベースURL */
const ODPT_API_URL = 'https://api.odpt.org/api/v4/odpt:TrainInformation';

/**
 * ODPTフォールバック対象路線（半蔵門線・田園都市線のみ）。
 * 小田急2路線はODPT未提供のため対象外。
 */
const ODPT_LINES = [
    { operator: 'odpt.Operator:TokyoMetro', railway: 'odpt.Railway:TokyoMetro.Hanzomon', name: '半蔵門線' },
    { operator: 'odpt.Operator:Tokyu', railway: 'odpt.Railway:Tokyu.DenEnToshi', name: '田園都市線' },
];

/** Discord Embedの色（10進数） */
const COLOR_NORMAL = 0x2ecc71; // 緑
const COLOR_DELAY = 0xe74c3c; // 赤
const COLOR_FALLBACK = 0xf1c40f; // 黄（フォールバック）

/**
 * 実行時点のJST（日本時間）の日付情報を返す。
 *
 * Returns:
 *     object: `{ date: "YYYY-MM-DD", day: 曜日(0=日..6=土) }`。
 */
function getJstDate() {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(jst.getUTCDate()).padStart(2, '0');
    return { date: `${y}-${m}-${d}`, day: jst.getUTCDay() };
}

/**
 * 通勤日（平日かつ祝日でない）かどうかを判定する。
 *
 * 祝日APIの取得に失敗した場合は「祝日でない」とみなす（フェイルオープン）。
 *
 * Returns:
 *     Promise<object>: `{ commute: bool, reason: str }`。
 */
async function isCommuteDay() {
    const { date, day } = getJstDate();
    if (day === 0 || day === 6) {
        return { commute: false, reason: '土日のため' };
    }
    try {
        const res = await fetch(HOLIDAYS_API_URL);
        if (res.ok) {
            const holidays = await res.json();
            if (holidays[date]) {
                return { commute: false, reason: `祝日（${holidays[date]}）のため` };
            }
        }
    } catch (err) {
        // 祝日判定不能時は通常処理（通知する側に倒す）
        console.error('祝日情報の取得に失敗（祝日でないとみなして継続）:', err);
    }
    return { commute: true, reason: '' };
}

/**
 * ODPT運行情報APIから対象路線の運行状況を取得する（フォールバック用）。
 *
 * Args:
 *     token (str): ODPT_TOKEN。
 *
 * Returns:
 *     Promise<Array<object>>: `{ name, text }` の配列。`text` が空なら平常。
 *
 * Raises:
 *     Error: トークン未設定・通信失敗時。
 */
async function fetchOdptInfo(token) {
    if (!token) {
        throw new Error('ODPT_TOKEN が未設定です。');
    }

    const results = [];
    // operator単位で取得し、対象railwayを抽出する
    const operators = [...new Set(ODPT_LINES.map((line) => line.operator))];
    for (const operator of operators) {
        const url = `${ODPT_API_URL}?odpt:operator=${operator}&acl:consumerKey=${token}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`ODPT取得失敗: ${res.status}`);
        }
        const list = await res.json();
        for (const line of ODPT_LINES.filter((l) => l.operator === operator)) {
            const entry = list.find((item) => item['odpt:railway'] === line.railway);
            // trainInformationText があれば異常、無ければ平常
            const textObj = entry && entry['odpt:trainInformationText'];
            const text = textObj && (textObj.ja || textObj);
            results.push({ name: line.name, text: typeof text === 'string' ? text : '' });
        }
    }
    return results;
}

/**
 * 平常/遅延の状況からDiscord Embedペイロードを生成する。
 *
 * Args:
 *     delayedLines (Array<object>): `{ name, code, status, updatedAt }` の配列。
 *
 * Returns:
 *     object: Discord Webhookへ送るペイロード。
 */
function buildEmbed(delayedLines) {
    const updatedAt = (delayedLines[0] && delayedLines[0].updatedAt) || '';
    const footer = updatedAt ? { text: `データ更新: ${updatedAt}（Yahoo!路線情報）` } : { text: 'Yahoo!路線情報' };

    if (delayedLines.length > 0) {
        return {
            embeds: [
                {
                    title: '⚠️ 遅延・運行情報あり',
                    description: 'お出かけ前に運行情報をご確認ください。',
                    color: COLOR_DELAY,
                    fields: delayedLines.map((line) => ({
                        name: line.name,
                        value: `${line.status}\n[詳細](https://transit.yahoo.co.jp/diainfo/${line.code}/0)`,
                        inline: true,
                    })),
                    footer,
                    timestamp: new Date().toISOString(),
                },
            ],
        };
    }

    const names = MONITORED_LINES.map((line) => line.name).join('、');
    return {
        embeds: [
            {
                title: '✅ すべて平常運転',
                description: `${names}は平常運転です。\nいってらっしゃいませ。`,
                color: COLOR_NORMAL,
                footer,
                timestamp: new Date().toISOString(),
            },
        ],
    };
}

/**
 * ODPTフォールバック結果からDiscord Embedペイロードを生成する。
 *
 * Args:
 *     odptInfo (Array<object>): `{ name, text }` の配列。
 *
 * Returns:
 *     object: Discord Webhookへ送るペイロード。
 */
function buildFallbackEmbed(odptInfo) {
    const fields = odptInfo.map((line) => ({
        name: line.name,
        value: line.text || '平常運転',
        inline: true,
    }));
    return {
        embeds: [
            {
                title: '⚠️ Yahoo取得失敗 — ODPTで代替表示',
                description: '小田急2路線（小田原線・江ノ島線）はODPT未提供のため取得できません。',
                color: COLOR_FALLBACK,
                fields,
                footer: { text: '公共交通オープンデータセンター(ODPT)' },
                timestamp: new Date().toISOString(),
            },
        ],
    };
}

/**
 * Discord Webhookへペイロードを送信する。
 *
 * Args:
 *     webhookUrl (str): Discord WebhookのURL。
 *     payload (object): 送信するJSONペイロード（content または embeds）。
 *
 * Raises:
 *     Error: 通信失敗・HTTPステータス異常時。
 */
async function postToDiscord(webhookUrl, payload) {
    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    // Discord Webhookは成功時に204を返す
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Discord送信に失敗しました（ステータス: ${res.status}）`);
    }
}

/**
 * 遅延情報を取得し、Discordへ通知する一連の処理。
 * Cloudflare Workers（`worker.js`）・Node.js手動実行（`notify.js`）の両エントリーポイントから共用する。
 *
 * Args:
 *     webhookUrl (str): Discord WebhookのURL。
 *     odptToken (str|undefined): ODPTフォールバック用トークン（未設定なら省略）。
 *
 * Returns:
 *     Promise<void>: 通知完了（またはスキップ）で解決する。送信失敗時は例外を投げる。
 */
async function notify(webhookUrl, odptToken) {
    const { commute, reason } = await isCommuteDay();
    if (!commute) {
        console.log(`本日は通知対象外（${reason}）。送信せず終了します。`);
        return;
    }

    let payload;
    try {
        const delayedLines = await fetchDelayedLines();
        payload = buildEmbed(delayedLines);
    } catch (err) {
        console.error('Yahoo!路線情報の取得に失敗しました:', err);
        // フォールバック: ODPTで半蔵門線・田園都市線のみ取得を試みる
        try {
            const odptInfo = await fetchOdptInfo(odptToken);
            payload = buildFallbackEmbed(odptInfo);
        } catch (fallbackErr) {
            console.error('ODPTフォールバックにも失敗しました:', fallbackErr);
            payload = { content: 'すみません、遅延情報の取得に失敗しました。' };
        }
    }

    await postToDiscord(webhookUrl, payload);
    console.log('Discordへ通知しました。');
}

module.exports = {
    HOLIDAYS_API_URL,
    ODPT_API_URL,
    ODPT_LINES,
    COLOR_NORMAL,
    COLOR_DELAY,
    COLOR_FALLBACK,
    getJstDate,
    isCommuteDay,
    fetchOdptInfo,
    buildEmbed,
    buildFallbackEmbed,
    postToDiscord,
    notify,
};
