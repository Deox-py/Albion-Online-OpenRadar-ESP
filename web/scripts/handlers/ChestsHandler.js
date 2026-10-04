import {CATEGORIES} from "../constants/LoggerConstants.js";

// Taxonomy from the pinned mobs catalog; excludes CD_HIDDEN chests and treasure drones.
const SMALL_TREASURE_NAME = /^T[4-8]_MOB_(?:ROAMING_(?:FOREST|HIGHLAND|SWAMP|MOUNTAIN|STEPPE)|TN_FOREST)_CHEST$/;
const validId = id => Number.isSafeInteger(id) && id >= 0;
const safeName = value => typeof value === 'string' ? value.trim() : '';
const rawNumber = value => Number.isFinite(value) ? value : null;

export function isSmallTreasureInfo(info) {
    return info?.category === 'chest' && typeof info.uniqueName === 'string'
        && SMALL_TREASURE_NAME.test(info.uniqueName);
}

export function getChestFamily(typeName, modelName = '') {
    const names = [safeName(typeName).toUpperCase(), safeName(modelName).toUpperCase()];
    if (names.some(name => SMALL_TREASURE_NAME.test(name))) return 'small-treasure';
    if (names.some(name => name.startsWith('AVALON_'))) return 'avalon';
    if (names.some(name => /DYNAMIC_CAMP|MINI_CAMP|^MISTS_PERSONAL_|_MOBCAMP_/.test(name))) return 'camp';
    return 'other';
}

class Chest {
    constructor(id) {
        this.id = id;
        this.hX = 0;
        this.hY = 0;
        this.opened = false;
        this.openedAt = null;
        this.lastUpdateTime = Date.now();
    }

    touch() {
        this.lastUpdateTime = Date.now();
    }
}

export class ChestsHandler {
    constructor() {
        this.chestsList = [];
    }

    addChest(id, posX, posY, name, rarity = null, metadata = {}) {
        if (!validId(id) || !Number.isFinite(posX) || !Number.isFinite(posY)) return false;
        let chest = this.chestsList.find(entry => entry.id === id);
        if (!chest) {
            chest = new Chest(id);
            this.chestsList.push(chest);
        }
        const typeName = safeName(name);
        const modelName = safeName(metadata.modelName);
        Object.assign(chest, {posX, posY, typeName, modelName,
            chestName: typeName || modelName,
            rarity, rawState: rawNumber(metadata.rawState),
            family: getChestFamily(typeName, modelName),
            source: metadata.source ?? 'loot-chest', typeId: metadata.typeId ?? null});
        chest.touch();
        return true;
    }

    removeChest(id) {
        this.chestsList = this.chestsList.filter(chest => chest.id !== id);
    }

    Clear() {
        this.chestsList = [];
    }

    cleanupStaleEntities(maxAgeMs = 120000) {
        const now = Date.now();
        const before = this.chestsList.length;
        this.chestsList = this.chestsList.filter(chest => (now - chest.lastUpdateTime) < maxAgeMs);
        const removed = before - this.chestsList.length;
        if (removed > 0) window.logger?.debug(CATEGORIES.DUNGEONS, 'chest_cleanup', {removed, maxAgeMs});
        return removed;
    }

    addChestEvent(parameters) {
        const position = parameters?.[1];
        if (!Array.isArray(position) || position.length < 2) return false;
        // P5 is retained as uninterpreted state: no validated Photon rarity slot exists.
        return this.addChest(parameters[0], position[0], position[1], parameters[3], null,
            {modelName: parameters[4], rawState: parameters[5]});
    }

    addSmallTreasureEvent(parameters, info) {
        if (!isSmallTreasureInfo(info)) return false;
        const position = parameters?.[7]?.data ?? parameters?.[7];
        if (!Array.isArray(position) || position.length < 2) return false;
        return this.addChest(parameters[0], position[0], position[1], info.uniqueName, null,
            {source: 'mob', typeId: parameters[1]});
    }

    updateChestEvent(parameters) {
        if (!validId(parameters?.[0]) || !Number.isFinite(parameters?.[1])) return;
        const chest = this.chestsList.find(entry => entry.id === parameters[0]);
        if (!chest) return;
        chest.rawState = parameters[1];
        chest.touch();
    }

    chestOpenedEvent(parameters) {
        if (!validId(parameters?.[0])) return;
        const chest = this.chestsList.find(entry => entry.id === parameters[0]);
        if (!chest) return;
        chest.opened = true;
        chest.openedAt = Date.now();
        chest.touch();
    }
}