import {DrawingUtils} from "../utils/DrawingUtils.js";
import {CATEGORIES} from "../constants/LoggerConstants.js";
import settingsSync from "../utils/SettingsSync.js";
import imageCache from "../utils/ImageCache.js";
import zonesDatabase from "../data/ZonesDatabase.js";

export class MapDrawing extends DrawingUtils
{
    interpolate(curr_map, lpX, lpY , t)
    {
        const hX = lpX;
        const hY = -lpY;

        curr_map.hX = this.lerp(curr_map.hX, hX, t);
        curr_map.hY = this.lerp(curr_map.hY, hY, t);
    }

    draw(ctx, curr_map)
    {
        if (curr_map.id < 0)
            return;

        const zoom = this.getZoomLevel();
        const scaleFactor = 4 * zoom;
        const id = curr_map.id.toString();
        const extent = zonesDatabase.getMapAssetExtent(id);
        const center = zonesDatabase.getMapAssetCenter(id);
        const size = extent * scaleFactor;
        const adjX = (curr_map.hX - center.x) * scaleFactor;
        const adjY = (curr_map.hY + center.y) * scaleFactor;
        this.DrawImageMap(ctx, adjX, adjY, id, size, size);
    }
    DrawImageMap(ctx, x, y, imageName, drawWidth, drawHeight)
    {
        // Fill background => if no map image or corner to prevent glitch textures
        ctx.fillStyle = '#1a1c23';
        ctx.fillRect(0, 0, ctx.width, ctx.height);

        if (!settingsSync.getBool("settingShowMap", true)) return;

        if (imageName === undefined || imageName == "undefined")
            return;

        const src = "/images/Maps/" + imageName + ".webp";

        const preloadedImage = imageCache.GetPreloadedImage(src, "Maps");

        if (preloadedImage === null) {
            this._drawProceduralFallback(ctx);
            return;
        }

        if (preloadedImage)
        {
            ctx.save();

            ctx.scale(1, -1);
            const center = this.getCanvasCenter();
            ctx.translate(center, -center);

            ctx.rotate(-0.785398);
            ctx.translate(-x, y);

            ctx.drawImage(preloadedImage, -drawWidth/2, -drawHeight/2, drawWidth, drawHeight);
            ctx.restore();
        }
        else
        {
            // Keep the radar useful while an asset is loading or when a dynamic
            // instance (for example a Mist) has no static background tile.
            this._drawProceduralFallback(ctx);

            imageCache.preloadImageAndAddToList(src, "Maps")
            .then(() => {
                window.logger?.info(CATEGORIES.MAP, 'map_loaded', {src: src});
            })
            .catch((error) => {
                window.logger?.warn(CATEGORIES.MAP, 'map_load_failed', {src: src, error: error?.message});
            });
        }
    }

    _drawProceduralFallback(ctx)
    {
        const width = ctx.canvas?.width ?? ctx.width ?? 500;
        const height = ctx.canvas?.height ?? ctx.height ?? 500;
        const step = Math.max(32, Math.round(Math.min(width, height) / 8));

        ctx.save();

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
        ctx.lineWidth = 1;
        ctx.setLineDash?.([2, 6]);

        for (let x = step; x < width; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        for (let y = step; y < height; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        ctx.setLineDash?.([]);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';

        const centerX = width / 2;
        const centerY = height / 2;

        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        ctx.restore();
    }
}