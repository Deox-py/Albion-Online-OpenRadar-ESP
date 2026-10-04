// Offline integration test: real anonymized PCAP -> Go parser -> WS -> UI.
// Uses an installed Edge/Chrome, temporary browser profile and no game process.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer';

const root = process.cwd();
const binary = path.resolve(process.argv[2] || '.build/qa-replay.exe');
assert.ok(existsSync(binary), `Build the offline tool first: go build -o .build/qa-replay.exe ./tools/replay-radar (${binary})`);
const browserPath = process.env.OPENRADAR_QA_BROWSER || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
assert.ok(browserPath, 'Install Edge/Chrome or set OPENRADAR_QA_BROWSER');
const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
        const selected = s.address().port;
        s.close(error => error ? reject(error) : resolve(selected));
    });
});
const origin = `http://127.0.0.1:${port}`;
const server = spawn(binary, ['-port', String(port), '-speed', '100', '-duration', '90s', '-qa-map-before-client'], {cwd: root, windowsHide: true});
let serverOutput = '';
server.stdout.on('data', data => { serverOutput += data; });
server.stderr.on('data', data => { serverOutput += data; });
let serverError;
server.once('error', error => { serverError = error; });
let browser;
let page;
const errors = [];
const external = [];
const localRequests = [];
try {
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline) {
        if (serverError) throw serverError;
        if (server.exitCode !== null) throw new Error(`Offline server exited (${server.exitCode}): ${serverOutput}`);
        try { ready = (await fetch(origin, {signal: AbortSignal.timeout(1000)})).ok; } catch { /* server startup */ }
        if (ready) break;
        await delay(100);
    }
    assert.ok(ready, `Offline server did not become ready: ${serverOutput}`);
    browser = await puppeteer.launch({executablePath: browserPath, headless: true, args: ['--disable-gpu', '--no-first-run'], timeout: 20000});
    page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        const url = request.url();
        if (url.startsWith(origin + '/')) localRequests.push(new URL(url).pathname);
        if (/^https?:/.test(url) && !url.startsWith(origin + '/')) external.push(url);
    });
    await page.goto(origin, {waitUntil: 'networkidle0', timeout: 30000});
    assert.equal(await page.$$eval('a[href="/automation"]', links => links.length), 0, 'Radar-only navigation must exclude automation.');
    const removedFeatures = await page.evaluate(async () => {
        const paths = ['/automation', '/api/automation/status', '/api/automation/windows',
            '/api/automation/frame?windowId=qa', '/api/automation/start', '/api/automation/stop',
            '/scripts/automation/index.js', '/scripts/automation/AutomationPanel.js'];
        return Promise.all(paths.map(async path => ({path, status: (await fetch(path)).status})));
    });
    assert.ok(removedFeatures.every(result => result.status === 404), 'Removed automation routes and assets must return 404.');
    await page.evaluate(() => {
        window.__qaLifecycle = [];
        document.addEventListener('click', event => {
            window.__qaLifecycle.push({event: 'click', href: event.target.closest('a')?.getAttribute('href'),
                target: event.target.tagName});
        }, true);
        for (const name of ['htmx:beforeRequest', 'htmx:afterRequest', 'htmx:beforeSwap', 'htmx:afterSettle']) {
            document.addEventListener(name, event => window.__qaLifecycle.push({event: name,
                href: event.detail.elt?.getAttribute('href'), target: event.detail.target?.id}));
        }
    });
    await page.waitForFunction(() => window.harvestablesHandler?.harvestableList.some(r => r.id === 2246), {timeout: 15000});
    const state = await page.evaluate(() => {
        const resource = window.harvestablesHandler.harvestableList.find(r => r.id === 2246);
        return {id: resource.id, x: resource.posX, y: resource.posY, tier: resource.tier, ws: window.wsConnectionStatus};
    });
    assert.deepEqual(state, {id: 2246, x: -307.5, y: 59.5, tier: 5, ws: 'connected'});
    await page.waitForFunction(() => window.currentMapId === '1000' &&
        document.getElementById('mapIdentityStatus')?.dataset.source === 'observed', {timeout: 10000});
    const bootstrap = await page.$eval('#mapIdentityStatus', element => element.textContent);
    assert.match(bootstrap, /Lymhurst/);
    // This context was captured before the browser existed, rather than
    // injected directly into the frontend queue.
    await page.click('#zoomIn');
    assert.equal(await page.$eval('#zoomValue', el => el.textContent), '110%');
    await page.click('#zoomReset');
    // Button auto-scroll can put the canvas center behind the fixed header.
    // Exercise the wheel only after hit testing proves the pointer is on it.
    await page.$eval('#canvasContainer', element => element.scrollIntoView({block: 'center'}));
    await page.waitForFunction(() => {
        const container = document.getElementById('canvasContainer');
        const box = container.getBoundingClientRect();
        return container.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }, {timeout: 10000});
    const radarBox = await page.$eval('#canvasContainer', el => {
        const box = el.getBoundingClientRect(); return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    });
    await page.mouse.move(radarBox.x, radarBox.y);
    await page.mouse.wheel({deltaY: -40});
    await page.waitForFunction(() => document.getElementById('zoomValue').textContent === '110%');
    await page.setViewport({width: 500, height: 900});
    assert.equal(await page.$eval('#zoomIn', el => getComputedStyle(el.parentElement).display === 'none'), false);
    const narrowZoom = await page.evaluate(async () => {
        const {DrawingUtils} = await import('/scripts/utils/DrawingUtils.js');
        return new DrawingUtils().getZoomLevel();
    });
    assert.equal(narrowZoom, 1.1);
    await page.setViewport({width: 1280, height: 900});
    await page.click('#zoomReset');
    // Render the real decoded entity near the viewport for a deterministic
    // pixel assertion. This is a QA camera position, never a player estimate.
    await page.evaluate(async () => {
        const {default: settings} = await import('/scripts/utils/SettingsSync.js');
        // Fresh profiles start with all resource cells disabled. Enable the
        // decoded Fiber T5.1 cell using the same settings API as the UI.
        const cells = {e1: [false, false, false, false, true, false, false, false]};
        settings.setJSON('settingStaticFiberEnchants', cells);
        settings.setBool('settingResourceColorBadges', true);
        window.radarRenderer.setLocalPlayerPosition(-307.5, 59.5);
    });
    await page.waitForFunction(() => {
        const canvas = document.getElementById('drawCanvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true;
        return false;
    }, {timeout: 10000});
    await page.type('#mapZoneSearch', '1001');
    await page.waitForFunction(() => [...document.getElementById('mapZoneSelect').options].some(o => o.value === '1001'));
    await page.select('#mapZoneSelect', '1001');
    await page.click('#mapZoneApply');
    const manual = await page.evaluate(() => ({mapId: window.currentMapId,
        source: document.getElementById('mapIdentityStatus').dataset.source,
        x: window.radarRenderer.lpX, y: window.radarRenderer.lpY,
        positionKnown: window.radarRenderer.hasLocalPlayerPosition,
        resource: window.harvestablesHandler.harvestableList.some(r => r.id === 2246)}));
    assert.deepEqual(manual, {mapId: '1001', source: 'manual', x: -307.5, y: 59.5, positionKnown: true, resource: true});
    await page.click('#mapZoneClear');
    await page.waitForFunction(() => document.getElementById('mapIdentityStatus').dataset.source === 'unknown');
    await page.click('#mapZoneApply');
    await page.waitForFunction(() => document.getElementById('mapIdentityStatus').dataset.source === 'manual');
    assert.deepEqual(errors, [], 'Browser runtime errors');
    assert.deepEqual(external, [], 'Radar UI made unexpected external HTTP requests');
    const outputDir = path.join(root, '.build/qa');
    mkdirSync(outputDir, {recursive: true});
    await page.screenshot({path: path.join(outputDir, 'offline-radar.png'), fullPage: true});
    // Chest inputs below are synthetic and catalog-derived. They exercise the
    // real WS envelope, queue, router, handlers and renderer; they are not a
    // claim of a new live Albion capture or of decoded encrypted coordinates.
    const chests = await page.evaluate(async () => {
        const {getEventQueue} = await import('/scripts/utils/WebSocketEventQueue.js');
        const {EventCodes} = await import('/scripts/utils/EventCodes.js');
        const queue = getEventQueue();
        const send = parameters => {
            queue.queueRawMessage(JSON.stringify({code: 'event', dictionary: {parameters}}));
            queue.flush(Infinity);
        };
        const treasureName = 'T4_MOB_ROAMING_FOREST_CHEST';
        const entry = [...window.mobsDatabase.mobsById].find(([, info]) => info.uniqueName === treasureName && info.category === 'chest');
        if (!entry) throw new Error('Synthetic chest QA needs the existing world-treasure catalog entry');
        send({0: 99001, 1: [-292, 59.5], 3: 'KEEPER_DYNAMIC_CAMP_PERSONAL_SMALL_LC',
            4: 'SWAMP_RED_LOOTCHEST_DYNAMIC_CAMP_KEEPER_SMALL', 5: 4, 252: EventCodes.NewLootChest});
        send({0: 99002, 1: [-322, 59.5], 3: 'AVALON_ELITE_RARE_MERGED',
            4: 'MISTS_GREEN_LOOTCHEST_MODEL_BLUE', 5: 6, 252: EventCodes.NewLootChest});
        send({0: 99003, 1: entry[0], 2: 255, 7: [-307.5, 74.5], 13: 1, 252: EventCodes.NewMob});
        send({0: 99004, 1: ['bad', 1], 3: 'AVALON_SMALL_SOLO_BASE', 252: EventCodes.NewLootChest});
        const observations = window.handlers.chests.chestsList.map(c => ({id: c.id, family: c.family,
            rarity: c.rarity, rawState: c.rawState, source: c.source, typeName: c.typeName, modelName: c.modelName}));
        const treasureAsMob = window.mobsHandler.mobsList.some(m => m.id === 99003);
        // Repeated spawn must update the same object, without losing metadata.
        send({0: 99001, 1: [-290, 59.5], 3: 'KEEPER_DYNAMIC_CAMP_PERSONAL_SMALL_LC',
            4: 'updated-model', 5: 6, 252: EventCodes.NewLootChest});
        send({0: 99001, 1: 8, 252: EventCodes.UpdateLootChest});
        send({0: 99001, 252: EventCodes.LootChestOpened});
        const updated = window.handlers.chests.chestsList.find(c => c.id === 99001);
        return {provenance: 'synthetic event envelopes, existing local catalog; not a live capture',
            observations, treasureAsMob, updated: {id: updated.id, x: updated.posX, y: updated.posY,
                modelName: updated.modelName, rawState: updated.rawState, rarity: updated.rarity,
                opened: updated.opened, openedAt: updated.openedAt, count: window.handlers.chests.chestsList.length}};
    });
    assert.deepEqual(chests.observations.map(c => [c.id, c.family, c.rarity, c.rawState, c.source]), [
        [99001, 'camp', null, 4, 'loot-chest'], [99002, 'avalon', null, 6, 'loot-chest'],
        [99003, 'small-treasure', null, null, 'mob']]);
    assert.equal(chests.observations[1].typeName, 'AVALON_ELITE_RARE_MERGED');
    assert.equal(chests.observations[1].modelName, 'MISTS_GREEN_LOOTCHEST_MODEL_BLUE');
    assert.equal(chests.treasureAsMob, false);
    assert.deepEqual({...chests.updated, openedAt: undefined}, {id: 99001, x: -290, y: 59.5,
        modelName: 'updated-model', rawState: 8, rarity: null, opened: true, openedAt: undefined, count: 3});
    assert.ok(chests.updated.openedAt > 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    chests.visibleMarkers = await page.evaluate(() => {
        const canvas = document.getElementById('drawCanvas');
        const ctx = canvas.getContext('2d');
        const drawing = window.radarRenderer.drawings.chestsDrawing;
        return window.handlers.chests.chestsList.filter(chest => {
            const point = drawing.transformPoint(chest.hX, chest.hY);
            const pixels = ctx.getImageData(Math.floor(point.x) - 3, Math.floor(point.y) - 3, 7, 7).data;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true;
            return false;
        }).map(chest => chest.id);
    });
    assert.deepEqual(chests.visibleMarkers, [99001, 99002, 99003], 'Every observed chest must paint its own canvas marker');
    await page.screenshot({path: path.join(outputDir, 'offline-chests.png'), fullPage: true});
    const afterLeave = await page.evaluate(async () => {
        const {getEventQueue} = await import('/scripts/utils/WebSocketEventQueue.js');
        const {EventCodes} = await import('/scripts/utils/EventCodes.js');
        const queue = getEventQueue();
        queue.queueRawMessage(JSON.stringify({code: 'event', dictionary: {parameters: {0: 99002, 252: EventCodes.Leave}}}));
        queue.flush(Infinity);
        return window.handlers.chests.chestsList.map(c => c.id);
    });
    assert.deepEqual(afterLeave, [99001, 99003]);
    await page.evaluate(async () => {
        const {getEventQueue} = await import('/scripts/utils/WebSocketEventQueue.js');
        getEventQueue().queueRawMessage(JSON.stringify({type: 'stream-reset', reason: 'queue-overflow'}));
    });
    const reset = await page.evaluate(() => ({resources: window.harvestablesHandler.harvestableList.length,
        chests: window.handlers.chests.chestsList.length,
        warning: !document.getElementById('streamHealth').hidden,
        reason: document.getElementById('streamHealth').dataset.reason,
        mapSource: document.getElementById('mapIdentityStatus').dataset.source,
        positionKnown: window.radarRenderer.hasLocalPlayerPosition}));
    assert.equal(reset.resources, 0);
    assert.equal(reset.chests, 0);
    assert.equal(reset.warning, true);
    assert.equal(reset.reason, 'queue-overflow');
    assert.equal(reset.positionKnown, false);
    assert.equal(reset.mapSource, 'unknown');
    const navigate = async (href, targetPage) => {
        await page.waitForFunction(href => {
            const link = document.querySelector(`#desktop-nav a[href="${href}"]`);
            if (!link) return false;
            const box = link.getBoundingClientRect();
            return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('a') === link;
        }, {timeout: 10000}, href);
        await page.click(`#desktop-nav a[href="${href}"]`);
        await page.waitForFunction(targetPage => document.getElementById('page-content')?.dataset.page === targetPage &&
            getComputedStyle(document.getElementById('page-content')).opacity === '1' &&
            !document.querySelector('.htmx-request, .htmx-settling'), {timeout: 10000}, targetPage);
    };
    await navigate('/chests', 'chests');
    const chestFilters = await page.evaluate(() => ['settingChestUnknown', 'settingChestAvalon', 'settingChestCamp',
        'settingChestSmallTreasure', 'settingChestOther'].map(id => ({id, checked: document.getElementById(id)?.checked})));
    assert.ok(chestFilters.every(filter => filter.checked === true));
    const clickCheckbox = async id => {
        await page.$eval(`#${id}`, el => el.scrollIntoView({block: 'center'}));
        await page.waitForFunction(id => {
            const input = document.getElementById(id);
            const box = input.getBoundingClientRect();
            return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input;
        }, {timeout: 10000}, id);
        await page.click(`#${id}`);
    };
    await clickCheckbox('settingChestCamp');
    assert.equal(await page.$eval('#settingChestCamp', el => el.checked), false);
    await navigate('/settings', 'settings');
    await navigate('/chests', 'chests');
    assert.equal(await page.$eval('#settingChestCamp', el => el.checked), false, 'Explicit family preference must survive page reentry');
    await clickCheckbox('settingChestCamp');
    await page.waitForFunction(() => {
        const link = document.querySelector('#desktop-nav a[href="/settings"]');
        const box = link.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('a') === link;
    }, {timeout: 10000});
    await page.click('#desktop-nav a[href="/settings"]');
    await page.waitForFunction(() => document.getElementById('page-content')?.dataset.page === 'settings' &&
        !window.radarRenderer && window.wsConnectionStatus === 'disconnected' &&
        getComputedStyle(document.getElementById('page-content')).opacity === '1' &&
        !document.querySelector('.htmx-request, .htmx-settling'), {timeout: 10000});
    // Verify cleanup also survives reentering radar through an HTMX swap.
    // Native view transitions can still intercept pointer events after HTMX's
    // settle event. Wait until the visible link is actually hit-testable.
    await page.waitForFunction(() => {
        const link = document.querySelector('#desktop-nav a[href="/"]');
        const box = link.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('a') === link;
    }, {timeout: 10000});
    await page.click('#desktop-nav a[href="/"]');
    await page.waitForFunction(() => Boolean(window.radarRenderer) && window.wsConnectionStatus === 'connected', {timeout: 10000});
    await page.waitForFunction(() => window.currentMapId === '1000' &&
        document.getElementById('mapIdentityStatus').dataset.source === 'observed', {timeout: 10000});
    // Exactly one listener must survive page reentry; stored zoom persists.
    await page.$eval('#zoomIn', el => el.scrollIntoView({block: 'center'}));
    await page.waitForFunction(() => {
        const button = document.getElementById('zoomIn');
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === button || button.contains(hit);
    }, {timeout: 10000});
    await page.click('#zoomIn');
    assert.equal(await page.$eval('#zoomValue', el => el.textContent), '110%');
    assert.deepEqual(errors, [], 'Browser runtime errors after navigation');
    assert.deepEqual(external, [], 'Unexpected external HTTP requests after navigation');
    writeFileSync(path.join(outputDir, 'offline-browser.json'), JSON.stringify({result: 'passed', state, reset, bootstrap, manual,
        automationExcluded: removedFeatures, chests: {...chests, afterLeave, filters: chestFilters, filterPersistence: 'passed'},
        zoom: 'buttons, wheel, mobile scale and single listener after HTMX navigation passed',
        navigation: 'radar -> chests -> settings -> chests -> settings -> radar passed', errors, external, serverOutput}, null, 2));
    console.log('Offline browser QA passed: PCAP decoding, synthetic chest lifecycle/catalog classification/filter persistence, map bootstrap, zoom, stream-reset, HTMX cleanup and no external UI HTTP requests.');
} catch (error) {
    const state = page ? await page.evaluate(() => ({status: window.wsConnectionStatus,
        page: document.getElementById('page-content')?.dataset.page,
        pageCount: document.querySelectorAll('#page-content').length,
        lifecycle: window.__qaLifecycle,
        initialized: Boolean(window.radarRenderer), resources: window.harvestablesHandler?.harvestableList?.slice(0, 3),
        resourceIds: window.harvestablesHandler?.harvestableList?.map(r => r.id),
        canvas: (() => { const c = document.getElementById('drawCanvas'); return c ? {w: c.width, h: c.height} : null; })(),
        text: document.body.textContent.slice(-500)})).catch(() => null) : null;
    if (page) {
        mkdirSync(path.join(root, '.build/qa'), {recursive: true});
        await page.screenshot({path: path.join(root, '.build/qa/offline-failure.png'), fullPage: true}).catch(() => {});
    }
    mkdirSync(path.join(root, '.build/qa'), {recursive: true});
    writeFileSync(path.join(root, '.build/qa/offline-browser.json'), JSON.stringify({result: 'failed',
        error: error.message, serverOutput, errors, external, localRequests, state}, null, 2));
    console.error(JSON.stringify({serverOutput, errors, external, localRequests, state}, null, 2));
    throw error;
} finally {
    try {
        if (browser) await browser.close();
    } finally {
        if (server.exitCode === null) {
            const stopped = new Promise(resolve => server.once('exit', resolve));
            server.kill();
            await Promise.race([stopped, delay(5000)]);
        }
    }
}
