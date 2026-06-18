'use strict';

/** 監視対象路線 */
const MONITORED_LINES = [
    { code: '114', name: '田園都市線' },
    { code: '138', name: '半蔵門線' },
    { code: '109', name: '小田原線' },
    { code: '110', name: '江ノ島線' },
];

const DIAINFO_AREA_URL = 'https://transit.yahoo.co.jp/diainfo/area/4';
const HOLIDAYS_API_URL = 'https://holidays-jp.github.io/api/v1/date.json';
const ODPT_API_URL = 'https://api.odpt.org/api/v4/odpt:TrainInformation';

const ODPT_LINES = [
    { operator: 'odpt.Operator:TokyoMetro', railway: 'odpt.Railway:TokyoMetro.Hanzomon', name: '半蔵門線' },
    { operator: 'odpt.Operator:Tokyu', railway: 'odpt.Railway:Tokyu.DenEnToshi', name: '田園都市線' },
];

const COLOR_NORMAL = 0x2ecc71;
const COLOR_DELAY = 0xe74c3c;
const COLOR_FALLBACK = 0xf1c40f;

/** ms待機 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * URLのテキストをリトライ付きで取得する。
 * Cloudflare Workers では fetch API を使用（https モジュール不可）。
 */
async function fetchText(url, retries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (!res.ok) {
                throw new Error(`予期しないステータスコード: ${res.status}`);
            }
            return await res.text();
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                await sleep(1000 * attempt);
            }
        }
    }
    throw lastError;
}

/** Yahoo!路線情報から __NEXT_DATA__ を抽出してパース */
function parseNextData(html) {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!match) {
        throw new Error('運行情報データ(__NEXT_DATA__)が見つかりませんでした。');
    }
    return JSON.parse(match[1]);
}

/** 監視対象路線のうち遅延中のものを返す */
async function fetchDelayedLines() {
    const html = await fetchText(DIAINFO_AREA_URL);
    const nextData = parseNextData(html);
    const troubleRails = nextData.props.pageProps.troubleRails || [];

    const delayed = [];
    for (const rail of troubleRails) {
        const property = (rail.routeInfo && rail.routeInfo.property) || {};
        const monitored = MONITORED_LINES.find((line) => line.code === String(property.railCode));
        if (!monitored) continue;
        const info = (property.diainfo && property.diainfo[0]) || {};
        delayed.push({
            name: monitored.name,
            code: monitored.code,
            status: info.status || '運行情報あり',
            updatedAt: info.updateDate || '',
        });
    }
    return delayed;
}

/** JST の日付・曜日を返す */
function getJstDate() {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(jst.getUTCDate()).padStart(2, '0');
    return { date: `${y}-${m}-${d}`, day: jst.getUTCDay() };
}

/** 通勤日判定（土日・祝日はスキップ） */
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
        console.error('祝日情報の取得に失敗（祝日でないとみなして継続）:', err);
    }
    return { commute: true, reason: '' };
}

/** ODPTフォールバック */
async function fetchOdptInfo(token) {
    if (!token) throw new Error('ODPT_TOKEN が未設定です。');
    const results = [];
    const operators = [...new Set(ODPT_LINES.map((l) => l.operator))];
    for (const operator of operators) {
        const url = `${ODPT_API_URL}?odpt:operator=${operator}&acl:consumerKey=${token}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`ODPT取得失敗: ${res.status}`);
        const list = await res.json();
        for (const line of ODPT_LINES.filter((l) => l.operator === operator)) {
            const entry = list.find((item) => item['odpt:railway'] === line.railway);
            const textObj = entry && entry['odpt:trainInformationText'];
            const text = textObj && (textObj.ja || textObj);
            results.push({ name: line.name, text: typeof text === 'string' ? text : '' });
        }
    }
    return results;
}

/** Discord Embed（平常/遅延） */
function buildEmbed(delayedLines) {
    const updatedAt = (delayedLines[0] && delayedLines[0].updatedAt) || '';
    const footer = updatedAt ? { text: `データ更新: ${updatedAt}（Yahoo!路線情報）` } : { text: 'Yahoo!路線情報' };

    if (delayedLines.length > 0) {
        return {
            embeds: [{
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
            }],
        };
    }

    const names = MONITORED_LINES.map((l) => l.name).join('、');
    return {
        embeds: [{
            title: '✅ すべて平常運転',
            description: `${names}は平常運転です。\nいってらっしゃいませ。`,
            color: COLOR_NORMAL,
            footer,
            timestamp: new Date().toISOString(),
        }],
    };
}

/** ODPTフォールバック用 Embed */
function buildFallbackEmbed(odptInfo) {
    return {
        embeds: [{
            title: '⚠️ Yahoo取得失敗 — ODPTで代替表示',
            description: '小田急2路線（小田原線・江ノ島線）はODPT未提供のため取得できません。',
            color: COLOR_FALLBACK,
            fields: odptInfo.map((line) => ({ name: line.name, value: line.text || '平常運転', inline: true })),
            footer: { text: '公共交通オープンデータセンター(ODPT)' },
            timestamp: new Date().toISOString(),
        }],
    };
}

/** Discord Webhook へ送信 */
async function postToDiscord(webhookUrl, payload) {
    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Discord送信に失敗しました（ステータス: ${res.status}）`);
    }
}

/** Cloudflare Workers エントリポイント */
export default {
    async scheduled(_event, env, _ctx) {
        const webhookUrl = env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
            console.error('環境変数 DISCORD_WEBHOOK_URL が設定されていません。');
            return;
        }

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
            try {
                const odptInfo = await fetchOdptInfo(env.ODPT_TOKEN);
                payload = buildFallbackEmbed(odptInfo);
            } catch (fallbackErr) {
                console.error('ODPTフォールバックにも失敗しました:', fallbackErr);
                payload = { content: 'すみません、遅延情報の取得に失敗しました。' };
            }
        }

        try {
            await postToDiscord(webhookUrl, payload);
            console.log('Discordへ通知しました。');
        } catch (err) {
            console.error('Discordへの通知に失敗しました:', err);
        }
    },
};
