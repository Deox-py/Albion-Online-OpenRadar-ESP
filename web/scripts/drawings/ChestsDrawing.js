import {DrawingUtils} from "../utils/DrawingUtils.js";
import settingsSync from "../utils/SettingsSync.js";
import {getChestFamily} from "../handlers/ChestsHandler.js";

const FAMILY_SETTINGS = {
    avalon: 'settingChestAvalon', camp: 'settingChestCamp',
    'small-treasure': 'settingChestSmallTreasure', other: 'settingChestOther',
};
const GENERIC_RARITY = /^(?:TREASURE|LOOTCHEST|CHEST)_(STANDARD|UNCOMMON|RARE|LEGENDARY|GREEN|BLUE|PURPLE|YELLOW)(?:_\d+)?$/;
const GENERIC_COLORS = {
    STANDARD: ['settingChestGreen', 'green'], GREEN: ['settingChestGreen', 'green'],
    UNCOMMON: ['settingChestBlue', 'blue'], BLUE: ['settingChestBlue', 'blue'],
    RARE: ['settingChestPurple', 'rare'], PURPLE: ['settingChestPurple', 'rare'],
    LEGENDARY: ['settingChestYellow', 'legendary'], YELLOW: ['settingChestYellow', 'legendary'],
};

export class ChestsDrawing extends DrawingUtils {
    interpolate(chests, lpX, lpY, t) {
        for (const chest of chests) this.interpolateEntity(chest, lpX, lpY, t);
    }

    invalidate(ctx, chests) {
        for (const chest of chests) {
            const family = chest.family ?? getChestFamily(chest.typeName ?? chest.chestName, chest.modelName);
            if (!settingsSync.getBool(FAMILY_SETTINGS[family] ?? FAMILY_SETTINGS.other, true)) continue;
            const name = typeof (chest.typeName ?? chest.chestName) === 'string'
                ? (chest.typeName ?? chest.chestName).toUpperCase() : '';
            // Only exact generic tags keep their legacy colors. Model names and
            // variable-rarity families (including *_RARE_MERGED) are never color evidence.
            const tag = family === 'other' ? GENERIC_RARITY.exec(name)?.[1] : null;
            const color = tag ? GENERIC_COLORS[tag] : null;
            if (color ? !settingsSync.getBool(color[0]) : !settingsSync.getBool('settingChestUnknown', true)) continue;
            const point = this.transformPoint(chest.hX, chest.hY);
            if (color) this.DrawCustomImage(ctx, point.x, point.y, color[1], 'Resources', 35);
            else this.drawNeutralChest(ctx, point.x, point.y);
        }
    }

    drawNeutralChest(ctx, x, y) {
        const size = this.getMarkerSize(20);
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = '#CBD5E1';
        ctx.fillStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.fillRect(-size / 2, -size / 3, size, size * 2 / 3);
        ctx.strokeRect(-size / 2, -size / 3, size, size * 2 / 3);
        ctx.fillStyle = '#CBD5E1';
        ctx.fillRect(-size / 2, -1, size, 2);
        ctx.fillRect(-2, -4, 4, 8);
        ctx.restore();
    }
}