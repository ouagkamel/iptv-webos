// tests/epg-import.test.mjs — fixtures §9 EPG : 644 (terminaison résiduelle),
// 500-exact (bord de modulo), offsets, dates-12, attrs, CDATA, coupe 7 Ko.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, db, makePair, addImportRow, addPlaylist } from './helpers/dbx.mjs';
import { buildXmltv, program, xmltvHeader, xmltvFooter, routeText } from './helpers/fixtures.mjs';

const URL_EPG = 'http://fixtures.test/epg.xml';

async function importEpg(text, opts) {
  await freshDb();
  const plId = await addPlaylist(db, 'P');
  const importId = await addImportRow(db, plId, 'epg');
  routeText(URL_EPG, text, opts || {});
  const pair = makePair('epg', 'epg');
  const detail = await pair.controller.startImport({ importId: importId, playlistId: plId, kind: 'epg', url: URL_EPG });
  return { plId, importId, detail, pair };
}

test('xmltv-644 : exactement 644 lignes, COMPLETE reçu, status completed (deadlock §6.2)', async () => {
  const text = buildXmltv(644, {});
  const r = await importEpg(text);
  assert.equal(await db.epg.where('importId').equals(r.importId).count(), 644);
  const pl = await db.playlists.get(r.plId);
  assert.equal(pl.activeEpgImportId, r.importId);
  assert.equal((await db.imports.get(r.importId)).status, 'completed');
  assert.equal(r.detail.kind, 'epg');
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('xmltv-2000-exact : bord de modulo CHUNK_ITEMS (V10), terminaison sans résidu', async () => {
  const text = buildXmltv(2000, {});
  const r = await importEpg(text);
  assert.equal(await db.epg.where('importId').equals(r.importId).count(), 2000);
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('xmltv-offsets : +0100 / -0500 / sans offset → écarts exacts en UTC', async () => {
  const body =
    program('cA', '20260101180000 +0100', '20260101190000 +0100', 'A') +
    program('cB', '20260101180000 -0500', '20260101190000 -0500', 'B') +
    program('cC', '20260101180000', '20260101190000', 'C');
  const r = await importEpg(xmltvHeader() + body + xmltvFooter());
  const rows = await db.epg.where('importId').equals(r.importId).toArray();
  const byCh = {}; rows.forEach(x => { byCh[x.channelId] = x; });
  const a = byCh.cA, b = byCh.cB, c = byCh.cC;
  assert.equal(a.startTime, Date.UTC(2026, 0, 1, 17, 0, 0), '+0100 → 17:00Z');
  assert.equal(b.startTime, Date.UTC(2026, 0, 1, 23, 0, 0), '-0500 → 23:00Z');
  assert.equal(c.startTime, Date.UTC(2026, 0, 1, 18, 0, 0), 'sans offset = UTC');
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('xmltv-dates-12 : secondes absentes → parsées (secondes=00), non ignorées', async () => {
  const body = program('cD', '202601011800', '202601011900', 'D');
  const r = await importEpg(xmltvHeader() + body + xmltvFooter());
  const d = await db.epg.where('importId').equals(r.importId).filter(x => x.channelId === 'cD').first();
  assert.ok(d, 'item présent');
  assert.equal(d.startTime, Date.UTC(2026, 0, 1, 18, 0, 0));
  assert.equal(d.stopTime, Date.UTC(2026, 0, 1, 19, 0, 0));
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('xmltv-attrs : > littéral dans valeur quotée, quotes simples, ordre inversé', async () => {
  const body =
    '<programme stop="20260101190000" start="20260101180000" channel=\'cE\'>' +
    '<desc>note : a &gt; b</desc><title>E avec &gt; littéral > dans le titre</title></programme>';
  const r = await importEpg(xmltvHeader() + body + xmltvFooter());
  assert.equal(await db.epg.count(), 1, 'programme capturé malgré ordre/quotes/>');
  const e = await db.epg.limit(1).first();
  assert.equal(e.channelId, 'cE');
  assert.ok(e.title.indexOf('>') !== -1);
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('xmltv-cdata : CDATA débullée, entités résolues (&amp; en dernier)', async () => {
  const body =
    '<programme channel="cF" start="20260101180000" stop="20260101190000">' +
    "<title><![CDATA[Les &amp; Grands]]></title></programme>";
  const r = await importEpg(xmltvHeader() + body + xmltvFooter());
  const f = await db.epg.limit(1).first();
  assert.equal(f.title, 'Les & Grands');
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('xmltv-coupe : chunks réseau de 7 Ko (frontières arbitraires) → zéro perte', async () => {
  const text = buildXmltv(300, {});
  const reference = (text.match(/<programme\b/g) || []).length;
  assert.equal(reference, 300);
  const r = await importEpg(text, { chunkSize: 7168 });
  assert.equal(await db.epg.count(), 300, 'carryOver : aucun programme perdu');
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});

test('dates invalides / attributs manquants → items ignorés, jamais epoch 0', async () => {
  const body =
    program('cG', '2026-01-01T18:00:00', '20260101190000', 'format ISO refusé') +
    '<programme channel="cH" start="20260101180000"><title>stop absent</title></programme>';
  const r = await importEpg(xmltvHeader() + body + xmltvFooter());
  assert.equal(await db.epg.count(), 0);
  r.pair.controller.destroy(); r.pair.dataManager.destroy();
});
