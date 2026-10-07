import {beforeEach, describe, expect, test, vi} from 'vitest';
import {ChestsHandler} from './ChestsHandler.js';

describe('observed chest validation and lifecycle', () => {
    let handler;
    beforeEach(() => {
        handler = new ChestsHandler();
        window.logger = {debug: vi.fn(), warn: vi.fn()};
    });

    test.each([null, undefined, {}, {0: 1}, {0: 1, 1: null}, {0: 1, 1: [0]},
        {0: 1, 1: ['0', 1]}, {0: 1, 1: [false, 1]}, {0: 1, 1: [NaN, 1]},
        {0: 1, 1: [0, Infinity]}, {0: '1', 1: [0, 0]}, {0: NaN, 1: [0, 0]},
        {0: Infinity, 1: [0, 0]}, {0: -1, 1: [0, 0]}, {0: 1.5, 1: [0, 0]}])(
        'rejects invalid observed coordinates or identity without throwing: %j', parameters => {
        expect(() => handler.addChestEvent(parameters)).not.toThrow();
        expect(handler.chestsList).toEqual([]);
    });

    test('missing or malformed names preserve a valid observed chest as unknown', () => {
        handler.addChestEvent({0: 0, 1: [0, -2], 3: 5, 4: null, 5: '4'});
        expect(handler.chestsList[0]).toMatchObject({id: 0, posX: 0, posY: -2,
            typeName: '', modelName: '', rarity: null, rawState: null, family: 'other'});
    });

    test('repeated observation updates position, names and raw state without duplication', () => {
        handler.addChestEvent({0: 9, 1: [1, 2], 3: 'AVALON_SMALL_SOLO_BASE', 4: 'first', 5: 2});
        handler.chestsList[0].lastUpdateTime = 1;
        handler.addChestEvent({0: 9, 1: [3, 4], 3: 'KEEPER_DYNAMIC_CAMP_PERSONAL_SMALL_LC', 4: 'second', 5: 8});
        expect(handler.chestsList).toHaveLength(1);
        expect(handler.chestsList[0]).toMatchObject({posX: 3, posY: 4,
            typeName: 'KEEPER_DYNAMIC_CAMP_PERSONAL_SMALL_LC', modelName: 'second',
            family: 'camp', rarity: null, rawState: 8});
        expect(handler.chestsList[0].lastUpdateTime).toBeGreaterThan(1);
    });

    test('raw updates and explicit opening do not invent rarity, emptiness or removal', () => {
        handler.addChestEvent({0: 9, 1: [1, 2], 3: 'MD_UNDEAD_SOLO_REWARD', 5: 6});
        handler.updateChestEvent({0: 9, 1: 7});
        expect(handler.chestsList[0]).toMatchObject({rawState: 7, rarity: null});
        handler.updateChestEvent({0: 9, 1: 8});
        handler.chestOpenedEvent({0: 9});
        expect(handler.chestsList).toHaveLength(1);
        expect(handler.chestsList[0]).toMatchObject({rawState: 8, rarity: null, opened: true, posX: 1, posY: 2});
        expect(handler.chestsList[0].openedAt).toBeGreaterThan(0);
        expect(handler.chestsList[0]).not.toHaveProperty('empty');
        handler.removeChest(9);
        expect(handler.chestsList).toHaveLength(0);
    });

    test('malformed updates and unknown IDs cannot create or alter an observed chest', () => {
        handler.addChestEvent({0: 9, 1: [1, 2], 5: 4});
        for (const p of [null, {}, {0: '9', 1: 7}, {0: 9, 1: '7'}, {0: 9, 1: NaN}, {0: 9, 1: Infinity}, {0: 50, 1: 7}]) {
            expect(() => handler.updateChestEvent(p)).not.toThrow();
        }
        for (const p of [null, {}, {0: '9'}, {0: NaN}, {0: 50}]) {
            expect(() => handler.chestOpenedEvent(p)).not.toThrow();
        }
        expect(handler.chestsList).toHaveLength(1);
        expect(handler.chestsList[0]).toMatchObject({rawState: 4, rarity: null, opened: false});
    });
});
