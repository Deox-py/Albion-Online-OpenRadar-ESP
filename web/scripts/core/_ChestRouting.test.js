import {beforeEach, describe, expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as router from './EventRouter.js';
import {ChestsHandler} from '../handlers/ChestsHandler.js';
import {MobsHandler} from '../handlers/MobsHandler.js';
import {MobsDatabase} from '../data/MobsDatabase.js';
import {EventCodes} from '../utils/EventCodes.js';
import {OperationCodes} from '../utils/OperationCodes.js';
import {loadFixture, normalizeParams} from '../__fixtures__/loader.js';

describe('observed chest routing with actual handlers and local catalog', () => {
    let chests;
    let mobs;
    let map;
    beforeEach(() => {
        router.reset();
        window.logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()};
        window.mobsDatabase = new MobsDatabase();
        window.mobsDatabase._parseMobs(JSON.parse(readFileSync('web/ao-bin-dumps/mobs.min.json', 'utf8')));
        chests = new ChestsHandler();
        mobs = new MobsHandler();
        map = {id: -1};
        const remove = () => {};
        router.init({map, radarRenderer: {}, handlers: {
            chestsHandler: chests, mobsHandler: mobs,
            playersHandler: {removePlayer: remove, updateLocalPlayerPosition: remove},
            dungeonsHandler: {removeDungeon: remove}, fishingHandler: {removeFish: remove},
            wispCageHandler: {removeCage: remove},
        }});
    });

    test('the 30 catalogued world treasures route to chests and never duplicate as enemies', async () => {
        const fx = await loadFixture('chests', 'small-treasures.synthetic');
        for (const message of fx.messages) {
            router.onEvent(normalizeParams(message.parameters));
            expect(chests.chestsList.at(-1)).toMatchObject({typeName: message.catalogName,
                family: 'small-treasure', source: 'mob', rarity: null});
        }
        expect(chests.chestsList).toHaveLength(30);
        expect(mobs.mobsList).toHaveLength(0);
    });

    test('ordinary mobs, drones and corrupted hidden chests keep their mob route', () => {
        for (const typeId of [200, 947, 3108]) {
            router.onEvent({0: typeId, 1: typeId, 2: 255, 7: [1, 2], 13: 1000, 252: EventCodes.NewMob});
        }
        expect(mobs.mobsList.map(m => m.typeId)).toEqual([200, 947, 3108]);
        expect(chests.chestsList).toHaveLength(0);
    });

    test('a treasure requires both the exact name and chest catalog category', () => {
        for (const info of [{uniqueName: 'T3_MOB_ROAMING_FOREST_CHEST', category: 'chest'},
            {uniqueName: 'T4_MOB_ROAMING_FOREST_CHEST_BOSS', category: 'chest'},
            {uniqueName: 'T4_MOB_ROAMING_FOREST_CHEST', category: 'standard'}]) {
            window.mobsDatabase.mobsById.set(999, {...info, isHarvestable: false});
            router.onEvent({0: mobs.mobsList.length + 1, 1: 999, 2: 255, 7: [0, 0], 13: 100, 252: EventCodes.NewMob});
        }
        expect(mobs.mobsList).toHaveLength(3);
        expect(chests.chestsList).toHaveLength(0);
    });

    test('a newly identified treasure removes a previous enemy copy of the same ID', () => {
        mobs.AddEnemy(22, 827, 0, 0, 255, 120, 0, null);
        router.onEvent({0: 22, 1: 827, 2: 255, 7: [1, 2], 13: 120, 252: EventCodes.NewMob});
        expect(chests.chestsList).toHaveLength(1);
        expect(mobs.mobsList).toHaveLength(0);
        router.onEvent({0: 22, 252: EventCodes.Leave});
        expect(chests.chestsList).toHaveLength(0);
    });

    test('spawn, raw update and opened signal retain the observed chest until Leave', () => {
        router.onEvent({0: 44, 1: [2, 3], 3: 'AVALON_SMALL_SOLO_BASE', 5: 6, 252: EventCodes.NewLootChest});
        router.onEvent({0: 44, 1: 7, 252: EventCodes.UpdateLootChest});
        router.onEvent({0: 44, 252: EventCodes.LootChestOpened});
        expect(chests.chestsList[0]).toMatchObject({id: 44, rawState: 7, rarity: null, opened: true});
        router.onEvent({0: 44, 252: EventCodes.Leave});
        expect(chests.chestsList).toHaveLength(0);
    });

    test.each(['44', '44junk', 44.5])('Leave rejects an ID that only coerces to an observed ID: %s', id => {
        chests.addChestEvent({0: 44, 1: [2, 3]});
        router.onEvent({0: id, 252: EventCodes.Leave});
        expect(chests.chestsList.map(chest => chest.id)).toEqual([44]);
    });

    test('unvalidated event families cannot create positional chest markers', () => {
        for (const code of [117, 41, 42, 43, 285, 286]) {
            router.onEvent({0: code, 1: [2, 3], 3: 'TREASURE_STANDARD', 252: code});
        }
        expect(chests.chestsList).toHaveLength(0);
    });

    test('zone change clears chest markers through the application clear callback', () => {
        chests.addChestEvent({0: 44, 1: [2, 3]});
        router.onResponse({0: 'another-zone', 253: OperationCodes.ChangeCluster}, () => chests.Clear());
        expect(chests.chestsList).toHaveLength(0);
    });

    test.each(['legacy response', 'Mists joined event'])('an existing %s map transition clears chests', route => {
        map.id = 'previous-zone';
        chests.addChestEvent({0: 44, 1: [2, 3]});
        if (route === 'legacy response') {
            router.onResponse({0: 'next-zone', 253: 35}, () => {});
        } else {
            router.onEvent({2: 'next-zone', 3: true, 252: EventCodes.MistsPlayerJoinedInfo});
        }
        expect(map.id).toBe('next-zone');
        expect(chests.chestsList).toHaveLength(0);
    });

    test('same-zone identity signals retain observed chests', () => {
        map.id = 'same-zone';
        chests.addChestEvent({0: 44, 1: [2, 3]});
        router.onResponse({0: 'same-zone', 253: 35}, () => {});
        router.onEvent({2: 'same-zone', 3: true, 252: EventCodes.MistsPlayerJoinedInfo});
        expect(chests.chestsList.map(chest => chest.id)).toEqual([44]);
    });

    test('router reset clears chest observations before dropping its handler references', () => {
        chests.addChestEvent({0: 44, 1: [2, 3]});
        router.reset();
        expect(chests.chestsList).toHaveLength(0);
    });
});
