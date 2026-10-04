import {afterEach, describe, expect, test} from 'vitest';
import {invalidateRadarState, clearStreamWarning} from './StreamHealth.js';
import {MistsDungeonHandler} from '../handlers/MistsDungeonHandler.js';
import {PlayersHandler} from '../handlers/PlayersHandler.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('Stream state recovery', () => {
    test('lost events clear players, Knightfall portals and cached resource clusters', () => {
        const players = new PlayersHandler();
        players.playersList.push({id: 17});
        const mistsDungeon = new MistsDungeonHandler();
        mistsDungeon.addPortal(18, 1, 2, 'portal');
        const renderer = {cachedClusters: [{id: 19}]};
        invalidateRadarState({players, mistsDungeon}, renderer, 'queue-overflow');
        expect(players.playersList).toEqual([]);
        expect(mistsDungeon.portalList).toEqual([]);
        expect(renderer.cachedClusters).toBeNull();
    });

    test('warns that partial state needs a zone change and clears warning at a fresh map boundary', () => {
        document.body.innerHTML = '<div id="streamHealth" hidden role="status"></div>';
        invalidateRadarState({}, null, 'connection-lost');
        const status = document.getElementById('streamHealth');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toContain('cambiar de zona');
        expect(status.dataset.reason).toBe('connection-lost');
        clearStreamWarning();
        expect(status.hidden).toBe(true);
        expect(status.textContent).toBe('');
    });
});
