import {DrawingUtils} from "../utils/DrawingUtils.js";
import settingsSync from "../utils/SettingsSync.js";

export class ChestsDrawing extends DrawingUtils {
    interpolate(chests, lpX, lpY, t) {
        for (const chestOne of chests) {
            this.interpolateEntity(chestOne, lpX, lpY, t);
        }
    }

    invalidate(ctx, chests) {
        for (const chestOne of chests) {
            const point = this.transformPoint(chestOne.hX, chestOne.hY);
            const asset = this._resolveChestAsset(chestOne);

            if (asset) {
                if (settingsSync.getBool(asset.setting)) {
                    this.DrawCustomImage(ctx, point.x, point.y, asset.name, "Resources", 35);
                }
                continue;
            }

            // Protocol18 does not currently expose a verified universal rarity field.
            // Keep an already-detected chest visible without inventing a rarity/color.
            if (this._hasAnyChestFilterEnabled()) {
                this._drawUnknownChest(ctx, point.x, point.y);
            }
        }
    }

    _resolveChestAsset(chest) {
        let name = String(chest?.chestName || '').toLowerCase();

        // In Mists, GREEN/YELLOW/BLACK is a zone/PvP tag, not chest rarity.
        // Strip only that leading zone tag before legacy name-based inference.
        name = name.replace(/^mists_(green|yellow|black)_/, 'mists_');

        if (["standard", "green"].some(sub => name.includes(sub))) {
            return {setting: "settingChestGreen", name: "green"};
        }
        if (["uncommon", "blue"].some(sub => name.includes(sub))) {
            return {setting: "settingChestBlue", name: "blue"};
        }
        if (["rare", "purple"].some(sub => name.includes(sub))) {
            return {setting: "settingChestPurple", name: "rare"};
        }
        if (["legendary", "yellow"].some(sub => name.includes(sub))) {
            return {setting: "settingChestYellow", name: "legendary"};
        }

        return null;
    }

    _hasAnyChestFilterEnabled() {
        return [
            "settingChestGreen",
            "settingChestBlue",
            "settingChestPurple",
            "settingChestYellow",
        ].some(key => settingsSync.getBool(key));
    }

    _drawUnknownChest(ctx, x, y) {
        const size = this.getMarkerSize?.(14) || 14;

        ctx.save();
        ctx.fillStyle = 'rgba(17, 24, 39, 0.88)';
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.90)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);

        ctx.beginPath();
        ctx.moveTo(x - size / 2, y - size / 6);
        ctx.lineTo(x + size / 2, y - size / 6);
        ctx.stroke();
        ctx.restore();
    }
}
