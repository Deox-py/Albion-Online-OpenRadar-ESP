import {CATEGORIES} from "../constants/LoggerConstants.js";
import settingsSync from "../utils/SettingsSync.js";

class Cage
{
    constructor(id, posX, posY, name)
    {
        this.id = id;
        this.posX = posX;
        this.posY = posY;
        this.name = name;
        this.hX = 0;
        this.hY = 0;
        this.lastUpdateTime = Date.now();
    }

    touch() {
        this.lastUpdateTime = Date.now();
    }
}

export class WispCageHandler
{
    constructor()
    {
        this.cages = [];
    }

    newCageEvent(parameters) {
        if (!settingsSync.getBool('settingCage', true)) return;

        const id = parameters[0];
        const rawPosition = parameters[2];
        const position = rawPosition?.data ?? rawPosition;
        const name = parameters[4];

        if (id === undefined || !Array.isArray(position) || position.length < 2 ||
            !Number.isFinite(Number(position[0])) || !Number.isFinite(Number(position[1]))) {
            window.logger?.debug(CATEGORIES.DUNGEONS, 'WispCage_InvalidLocation', {id, rawPosition});
            return;
        }

        const posX = Number(position[0]);
        const posY = Number(position[1]);
        const existing = this.cages.find(c => c.id === id);
        if (existing) {
            existing.posX = posX;
            existing.posY = posY;
            existing.name = name;
            existing.touch();
            return;
        }

        this.cages.push(new Cage(id, posX, posY, name));
    }

    cageOpenedEvent(Parameters)
    {
        if (!settingsSync.getBool('settingCage', true)) return;

        const id = Parameters[0];

        if (!this.cages.some(cage => cage.id === id))
            return;

        this.removeCage(id);
    }

    removeCage(id)
    {
        this.cages = this.cages.filter(cage => cage.id !== id);
    }

    Clear()
    {
        this.cages = [];
    }

    cleanupStaleEntities(maxAgeMs = 120000) {
        const now = Date.now();
        const before = this.cages.length;
        this.cages = this.cages.filter(cage =>
            (now - cage.lastUpdateTime) < maxAgeMs
        );
        const removed = before - this.cages.length;
        if (removed > 0) {
            window.logger?.debug(CATEGORIES.DUNGEONS, 'cage_cleanup', {removed, maxAgeMs});
        }
        return removed;
    }
}