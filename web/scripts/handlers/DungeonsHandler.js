import {CATEGORIES} from "../constants/LoggerConstants.js";
import settingsSync from "../utils/SettingsSync.js";

const DungeonType =
{
    Solo: 0,
    Group: 1,
    Corrupted: 2,
    Hellgate: 3
};

class Dungeon
{
    constructor(id, posX, posY, name, type, enchant)
    {
        this.id = id;
        this.posX = posX;
        this.posY = posY;
        this.name = name;
        this.enchant = enchant;

        this.type = type;

        this.drawName = undefined

        this.hY = 0;
        this.hX = 0;
        this.lastUpdateTime = Date.now();

        this.setDrawNameByType();
    }

    touch() {
        this.lastUpdateTime = Date.now();
    }

    setDrawNameByType()
    {
        switch (this.type)
        {
            case DungeonType.Solo:
                this.drawName = "dungeon_" + this.enchant;
                break;

            case DungeonType.Group:
                this.drawName = "group_" + this.enchant;
                break;

            case DungeonType.Corrupted:
                this.drawName = "corrupt";
                break;

            case DungeonType.Hellgate:
                this.drawName = "hellgate";
                break;
        }
    }
}

export class DungeonsHandler
{
    constructor()
    {
        // Import constants once in constructor
        this.dungeonList = [];
    }

    dungeonEvent(parameters)
    {
        // Ultra-detailed debug: Log ALL parameters to identify patterns
        const allParams = {};
        for (let key in parameters) {
            if (parameters.hasOwnProperty(key)) {
                allParams[`param[${key}]`] = parameters[key];
            }
        }

        window.logger?.debug(CATEGORIES.DUNGEONS, 'new_dungeon_all_params', {
            dungeonId: parameters[0],
            position: parameters[1],
            allParameters: allParams,
            parameterCount: Object.keys(parameters).length
        });

        const id = parameters[0];
        const rawPosition = parameters[1];
        const position = rawPosition?.data ?? rawPosition;
        if (!Array.isArray(position) || position.length < 2 ||
            !Number.isFinite(Number(position[0])) || !Number.isFinite(Number(position[1]))) {
            window.logger?.debug(CATEGORIES.DUNGEONS, 'Dungeon_InvalidLocation', {id, rawPosition});
            return;
        }

        // Standard dungeons still use Parameters[3]. Newer Mist/Knightfall layouts
        // can leave [3] empty and provide the portal tag in [16] (or [15] on an
        // intermediate layout). Never let a populated fallback override [3].
        const legacyName = typeof parameters[3] === 'string' ? parameters[3].trim() : '';
        const dragonfireName = typeof parameters[16] === 'string' ? parameters[16].trim() : '';
        const knightfallName = typeof parameters[15] === 'string' ? parameters[15].trim() : '';
        const name = legacyName || dragonfireName || knightfallName;
        const rawEnchant = Number(parameters[9] ?? 0);
        const enchant = Number.isFinite(rawEnchant) ? Math.max(0, Math.min(4, Math.trunc(rawEnchant))) : 0;

        this.addDungeon(id, Number(position[0]), Number(position[1]), name, enchant);
    }

    addDungeon(id, posX, posY, name, enchant) {
        if (!Number.isFinite(Number(posX)) || !Number.isFinite(Number(posY))) return;
        const safeName = typeof name === 'string' ? name : '';
        const normalizedEnchant = Number.isFinite(Number(enchant))
            ? Math.max(0, Math.min(4, Math.trunc(Number(enchant))))
            : 0;

        const upperCaseName = safeName.toUpperCase();
        const lowerCaseName = safeName.toLowerCase();
        // eslint-disable-next-line no-useless-assignment
        let dungeonType = undefined;

        // MISTS portals route through the Mists settings, not Dungeon settings.
        if (upperCaseName.startsWith("MISTS_"))
        {
            const isSolo = upperCaseName.includes("_SOLO_");

            if (isSolo) {
                if (!settingsSync.getBool("settingMistSolo", true) || !settingsSync.getBool("settingMistE" + normalizedEnchant, true)) return;
                dungeonType = DungeonType.Solo;
            } else {
                if (!settingsSync.getBool("settingMistDuo", true) || !settingsSync.getBool("settingMistE" + normalizedEnchant, true)) return;
                dungeonType = DungeonType.Group;
            }
        }
        // Corrupted dungeons have "solo" in their names
        // So check before solo to avoid problems
        // "CORRUPTED_SOLO"
        else if (lowerCaseName.includes("corrupted")) // corrupt
        {
            // Test if corrupt checkbox
            if (!settingsSync.getBool("settingDungeonCorrupted")) return;

            dungeonType = DungeonType.Corrupted;
        }
        else if (lowerCaseName.includes("solo")) // solo
        {
            // Test if solo checkbox
            if (!settingsSync.getBool("settingDungeonSolo") || !settingsSync.getBool('settingDungeonE'+normalizedEnchant)) return;

            dungeonType = DungeonType.Solo;
        }
        // "HELLGATE_2V2_NON_LETHAL"
        else if (lowerCaseName.includes("hellgate")) // hellgate
        {
            if (!settingsSync.getBool('settingDungeonHellgate')) return;

            dungeonType = DungeonType.Hellgate

        }
        else // group
        {
            if (!settingsSync.getBool('settingDungeonDuo') || !settingsSync.getBool('settingDungeonE'+normalizedEnchant)) return;
            dungeonType = DungeonType.Group;
        }

        const existing = this.dungeonList.find(item => item.id === id);
        if (existing) {
            existing.posX = Number(posX);
            existing.posY = Number(posY);
            existing.name = safeName;
            existing.type = dungeonType;
            existing.enchant = normalizedEnchant;
            existing.setDrawNameByType();
            existing.touch();
            return;
        }

        const d = new Dungeon(id, Number(posX), Number(posY), safeName, dungeonType, normalizedEnchant);
        this.dungeonList.push(d);
    }

    removeDungeon(id)
    {
        this.dungeonList = this.dungeonList.filter((dungeon) => dungeon.id !== id);
    }

    Clear() {
        this.dungeonList = [];
    }

    cleanupStaleEntities(maxAgeMs = 120000) {
        const now = Date.now();
        const before = this.dungeonList.length;
        this.dungeonList = this.dungeonList.filter(dungeon =>
            (now - dungeon.lastUpdateTime) < maxAgeMs
        );
        const removed = before - this.dungeonList.length;
        if (removed > 0) {
            window.logger?.debug(CATEGORIES.DUNGEONS, 'dungeon_cleanup', {removed, maxAgeMs});
        }
        return removed;
    }
}