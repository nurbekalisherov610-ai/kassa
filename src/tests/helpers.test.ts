import test from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHtml,
    escapeMd,
    generateDealId,
    isDateOnOrAfter,
    isValidDate,
    isValidPhone,
    isValidPrice,
    parsePrice,
    renderDealCard,
    renderSuccessMessage,
} from '../utils/helpers';

test('generateDealId returns collision-resistant Telegram-safe IDs', () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => generateDealId()));
    assert.equal(ids.size, 1_000);
    for (const id of ids) {
        assert.match(id, /^LT-\d{8}-[A-F0-9]{8}$/);
        assert.ok(Buffer.byteLength(`mgr:deal:${id}`, 'utf8') <= 64);
    }
});

test('date validation rejects impossible dates', () => {
    assert.equal(isValidDate('29.02.2028'), true);
    assert.equal(isValidDate('29.02.2027'), false);
    assert.equal(isValidDate('31.04.2026'), false);
    assert.equal(isValidDate('2026-04-30'), false);
    assert.equal(isDateOnOrAfter('01.05.2028', '30.04.2028'), true);
    assert.equal(isDateOnOrAfter('29.04.2028', '30.04.2028'), false);
});

test('phone validation accepts Uzbek formats and rejects short values', () => {
    assert.equal(isValidPhone('+998 90 123 45 67'), true);
    assert.equal(isValidPhone('901234567'), true);
    assert.equal(isValidPhone('12345'), false);
});

test('price parsing and validation are consistent', () => {
    assert.equal(isValidPrice('$1,250.50'), true);
    assert.equal(parsePrice('$1,250.50'), 1250.5);
    assert.equal(isValidPrice('-10'), false);
    assert.equal(parsePrice('-10'), 0);
    assert.equal(isValidPrice('1.2.3'), false);
    assert.equal(parsePrice('1.2.3'), 0);
});

test('Telegram Markdown renderers escape customer-provided fields', () => {
    const card = renderDealCard({
        clientName: 'Ali_*[x]',
        destination: 'Dubai `VIP`',
        notes: 'paid *later*',
        price: 1000,
    });
    assert.ok(card.includes(escapeMd('Ali_*[x]')));
    assert.ok(card.includes(escapeMd('Dubai `VIP`')));
    assert.ok(card.includes(escapeMd('paid *later*')));

    const success = renderSuccessMessage(
        { dealId: 'LT-20260729-ABCDEF12', price: 1000, destination: 'Bali_*', numberOfPeople: 2 },
        3,
        5000,
    );
    assert.ok(success.includes(escapeMd('Bali_*')));
    assert.equal(success.toLowerCase().includes('maqsad'), false);
});

test('HTML escaping makes user-provided Telegram content safe', () => {
    assert.equal(
        escapeHtml('<b>Ali & "Vali"</b>'),
        '&lt;b&gt;Ali &amp; &quot;Vali&quot;&lt;/b&gt;'
    );
});
