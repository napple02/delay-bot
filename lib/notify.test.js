'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmbed, buildFallbackEmbed, getJstDate } = require('./notify');

test('buildEmbed: 遅延なしは平常運転のEmbedを返す', () => {
    const payload = buildEmbed([]);
    assert.equal(payload.embeds[0].title, '✅ すべて平常運転');
    assert.equal(payload.embeds[0].fields, undefined);
});

test('buildEmbed: 遅延ありは路線ごとのfieldsを持つ', () => {
    const payload = buildEmbed([
        { name: '田園都市線', code: '114', status: '遅延', updatedAt: '12:00' },
    ]);
    assert.equal(payload.embeds[0].title, '⚠️ 遅延・運行情報あり');
    assert.equal(payload.embeds[0].fields.length, 1);
    assert.equal(payload.embeds[0].fields[0].name, '田園都市線');
});

test('buildFallbackEmbed: textが空なら平常運転と表示する', () => {
    const payload = buildFallbackEmbed([{ name: '半蔵門線', text: '' }]);
    assert.equal(payload.embeds[0].fields[0].value, '平常運転');
});

test('getJstDate: 曜日は0(日)〜6(土)の範囲', () => {
    const { date, day } = getJstDate();
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(day >= 0 && day <= 6);
});
