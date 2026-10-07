import {beforeEach, afterEach, describe, expect, test} from 'vitest';
import {initMapIdentity} from './MapIdentity.js';
import {MapH} from './Map.js';
import * as EventRouter from '../core/EventRouter.js';
import zonesDatabase from '../data/ZonesDatabase.js';
import {RadarRenderer} from './RadarRenderer.js';

describe('map identity controls', () => {
    let controls;
    let map;
    const element = id => document.getElementById(id);
    const click = id => element(id).click();
    function search(value) { element('mapZoneSearch').value = value; element('mapZoneSearch').dispatchEvent(new Event('input')); }

    beforeEach(() => {
        sessionStorage.clear();
        EventRouter.reset();
        zonesDatabase.clearAllMistOverrides();
        zonesDatabase.zones = {
            '1000': {name: 'Lymhurst', pvpType: 'safe'},
            '1001': {name: 'Bank of Lymhurst', pvpType: 'safe'},
            '0344': {name: 'Willowshade Hills', pvpType: 'red'},
            'other': {name: 'Willowshade Hills', pvpType: 'black'}
        };
        zonesDatabase.loaded = true;
        document.body.innerHTML = '<div id="mapIdentityStatus"></div><input id="mapZoneSearch"><select id="mapZoneSelect"></select><button id="mapZoneApply"></button><button id="mapZoneClear"></button><span id="mapZoneResults"></span><div id="streamHealth">Eventos perdidos</div>';
        map = new MapH(-1);
        EventRouter.init({map, handlers: {}, radarRenderer: null});
    });

    afterEach(() => { controls?.destroy(); controls = null; EventRouter.reset(); document.body.innerHTML = ''; });

    test('starts unknown and only applies the exact selected known ID', () => {
        controls = initMapIdentity();
        expect(element('mapIdentityStatus').dataset.source).toBe('unknown');
        expect(element('mapIdentityStatus').textContent).toContain('Zona sin identificar');
        search('Lymhurst');
        expect([...element('mapZoneSelect').options].map(option => option.value)).toEqual(['', '1001', '1000']);
        element('mapZoneSelect').value = '1001'; element('mapZoneSelect').dispatchEvent(new Event('change')); click('mapZoneApply');
        expect(map.id).toBe('1001');
        expect(element('mapIdentityStatus').dataset.source).toBe('manual');
        search('@MISTS@invented'); click('mapZoneApply');
        expect(map.id).toBe('1001');
        click('mapZoneClear');
        expect(map.id).toBe(-1);
        expect(element('mapIdentityStatus').dataset.source).toBe('unknown');
    });

    test('disambiguates duplicate names with IDs and limits each result page', () => {
        for (let i = 0; i < 100; i++) zonesDatabase.zones[`extra-${i}`] = {name: `Extra ${i}`};
        controls = initMapIdentity();
        expect(element('mapZoneSelect').options.length).toBe(51);
        expect(element('mapZoneResults').textContent).toContain('50 de 104');
        search('Willowshade');
        expect([...element('mapZoneSelect').options].slice(1).map(option => option.textContent)).toEqual(['Willowshade Hills (0344)', 'Willowshade Hills (other)']);
        search('1001'); expect(element('mapZoneSelect').options[1].value).toBe('1001');
    });

    test('saved identity is a suggestion and never restores coordinates or zone certainty', () => {
        sessionStorage.setItem('lastMapDisplayed', JSON.stringify({mapId: '1001', hX: 800, hY: 400, timestamp: 1}));
        EventRouter.restoreMapFromSession();
        controls = initMapIdentity();
        expect(element('mapZoneSelect').value).toBe('1001');
        expect(element('mapIdentityStatus').textContent).toContain('sugerencia');
        expect(map).toMatchObject({id: -1, hX: 0, hY: 0, source: 'unknown'});
    });

    test('observed bootstrap replaces manual status and keeps the independent stream warning', () => {
        controls = initMapIdentity();
        EventRouter.applyManualMapIdentity('1000');
        EventRouter.applyObservedMapContext({mapId: '1000', observedAt: 1234, source: 'join'});
        expect(element('mapIdentityStatus').dataset.source).toBe('observed');
        expect(element('mapIdentityStatus').textContent).toContain('Zona observada: Lymhurst (1000)');
        expect(element('mapIdentityStatus').textContent).toContain('incompleta');
        expect(element('streamHealth').textContent).toBe('Eventos perdidos');
    });

    test('destroy detaches DOM and router listeners, then init attaches once', () => {
        controls = initMapIdentity();
        controls.destroy();
        element('mapZoneSelect').value = '1001'; click('mapZoneApply');
        expect(map.id).toBe(-1);
        element('mapIdentityStatus').textContent = 'detached';
        EventRouter.applyManualMapIdentity('1000');
        expect(element('mapIdentityStatus').textContent).toBe('detached');
        controls = initMapIdentity();
        expect(element('mapIdentityStatus').textContent).toContain('Lymhurst');
    });

    test('missing zone database leaves exact manual selection unavailable', () => {
        zonesDatabase.zones = {}; zonesDatabase.loaded = false;
        controls = initMapIdentity();
        expect(element('mapZoneApply').disabled).toBe(true);
        expect(element('mapZoneResults').textContent).toContain('no disponible');
    });
});

describe('zone identity rendering', () => {
    test('unknown identity is neutral and never claims a safe shield', () => {
        const renderer = new RadarRenderer({handlers: {}, drawings: {}, drawingUtils: {}});
        renderer.setMap(new MapH(-1));
        const text = [];
        const ctx = {canvas: {width: 500}, measureText: value => ({width: value.length}), fillRect() {}, strokeRect() {}, fillText(value) {text.push({value, color: this.fillStyle});}};
        renderer.renderZoneInfo(ctx);
        expect(text).toEqual([{value: 'Zona sin identificar ?', color: '#b6bdc9'}]);
    });

    test('unknown dynamic identity has neutral risk and captured partial provenance', () => {
        const renderer = new RadarRenderer({handlers: {}, drawings: {}, drawingUtils: {}});
        renderer.setMap({id: '@MISTS@actual-captured-id', source: 'observed', bootstrap: true});
        const text = [];
        const ctx = {canvas: {width: 500}, measureText: value => ({width: value.length}), fillRect() {}, strokeRect() {}, fillText(value) {text.push({value, color: this.fillStyle});}};
        renderer.renderZoneInfo(ctx);
        expect(text[0].value).toContain('capturada, parcial');
        expect(text[0].color).toBe('#b6bdc9');
        expect(text[0].value).not.toContain('\u{1F6E1}');
    });
});
