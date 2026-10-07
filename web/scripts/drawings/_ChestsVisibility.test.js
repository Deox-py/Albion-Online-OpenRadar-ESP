import {beforeEach, describe, expect, test, vi} from 'vitest';
import {ChestsHandler} from '../handlers/ChestsHandler.js';
import {ChestsDrawing} from './ChestsDrawing.js';
import settingsSync from '../utils/SettingsSync.js';
import {loadFixture, normalizeParams} from '../__fixtures__/loader.js';

describe('conservative observed chest visibility', () => {
    let drawing;
    let handler;
    let ctx;
    beforeEach(() => {
        localStorage.clear();
        settingsSync.cache.clear();
        drawing = new ChestsDrawing();
        drawing.transformPoint = (x, y) => ({x, y});
        drawing.DrawCustomImage = vi.fn(); // Asset loading is external to classification.
        handler = new ChestsHandler();
        ctx = {save: vi.fn(), restore: vi.fn(), translate: vi.fn(), strokeRect: vi.fn(), fillRect: vi.fn()};
    });

    test('existing camp fixture becomes visible neutrally before the settings page is visited', async () => {
        const fx = await loadFixture('chests', 'spawn');
        handler.addChestEvent(normalizeParams(fx.messages[0].parameters));
        drawing.invalidate(ctx, handler.chestsList);
        expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
        expect(drawing.DrawCustomImage).not.toHaveBeenCalled();
        expect(handler.chestsList[0].rarity).toBeNull();
    });

    test.each(['AVALON_SMALL_SOLO_BASE', 'AVALON_ELITE_RARE_MERGED', 'MISTS_PERSONAL_SMALL_LC'])(
        'family/model and P5 cannot manufacture rarity for %s', typeName => {
        handler.addChestEvent({0: 1, 1: [0, 0], 3: typeName, 4: 'MISTS_GREEN_LOOTCHEST_MODEL_BLUE', 5: 2});
        drawing.invalidate(ctx, handler.chestsList);
        expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
        expect(drawing.DrawCustomImage).not.toHaveBeenCalled();
    });

    test.each(['settingChestUnknown', 'settingChestAvalon', 'settingChestCamp', 'settingChestSmallTreasure', 'settingChestOther'])(
        'an explicitly disabled %s remains hidden', key => {
        const name = {settingChestAvalon: 'AVALON_SMALL_SOLO_BASE', settingChestCamp: 'KEEPER_DYNAMIC_CAMP_PERSONAL_SMALL_LC',
            settingChestSmallTreasure: 'T4_MOB_ROAMING_FOREST_CHEST'}[key] ?? 'unknown';
        handler.addChestEvent({0: 1, 1: [0, 0], 3: name});
        settingsSync.setBool(key, false);
        drawing.invalidate(ctx, handler.chestsList);
        expect(ctx.strokeRect).not.toHaveBeenCalled();
        expect(drawing.DrawCustomImage).not.toHaveBeenCalled();
        settingsSync.setBool(key, true);
        drawing.invalidate(ctx, handler.chestsList);
        expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    });

    test('missing name remains visible without breaking subsequent chest rendering', () => {
        handler.addChestEvent({0: 1, 1: [0, 0]});
        handler.addChestEvent({0: 2, 1: [1, 1], 3: 'TREASURE_STANDARD_01'});
        settingsSync.setBool('settingChestGreen', true);
        expect(() => drawing.invalidate(ctx, handler.chestsList)).not.toThrow();
        expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
        expect(drawing.DrawCustomImage).toHaveBeenCalledWith(ctx, 0, 0, 'green', 'Resources', 35);
    });

    test('generic rarity tag remains governed by its color filter, independently of unknown filter', () => {
        handler.addChestEvent({0: 1, 1: [0, 0], 3: 'TREASURE_UNCOMMON_02'});
        settingsSync.setBool('settingChestUnknown', false);
        settingsSync.setBool('settingChestBlue', true);
        drawing.invalidate(ctx, handler.chestsList);
        expect(drawing.DrawCustomImage).toHaveBeenCalledWith(ctx, 0, 0, 'blue', 'Resources', 35);
        expect(ctx.strokeRect).not.toHaveBeenCalled();
        settingsSync.setBool('settingChestBlue', false);
        drawing.DrawCustomImage.mockClear();
        drawing.invalidate(ctx, handler.chestsList);
        expect(drawing.DrawCustomImage).not.toHaveBeenCalled();
    });
});
