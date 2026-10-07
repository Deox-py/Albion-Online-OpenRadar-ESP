export const MIN_RADAR_ZOOM = 0.1;
export const MAX_RADAR_ZOOM = 3;

export function normalizeRadarZoom(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.max(MIN_RADAR_ZOOM, Math.min(MAX_RADAR_ZOOM, value));
}

// UI zoom scales the local drawing only. All listeners belong to this page.
export class RadarZoomController {
    constructor(root, settings) {
        this.settings = settings;
        this.cleanups = [];
        this.wheelDelta = 0;
        this.slider = root.getElementById('settingRadarZoom');
        this.label = root.getElementById('zoomValue');
        this.zoomIn = root.getElementById('zoomIn');
        this.zoomOut = root.getElementById('zoomOut');
        const canvas = root.getElementById('canvasContainer');
        const bind = (node, name, fn, options) => {
            if (!node) return;
            node.addEventListener(name, fn, options);
            this.cleanups.push(() => node.removeEventListener(name, fn, options));
        };
        bind(this.slider, 'input', () => this.setZoom(Number(this.slider.value)));
        bind(this.zoomIn, 'click', () => this.setZoom(this.getZoom() + 0.1));
        bind(this.zoomOut, 'click', () => this.setZoom(this.getZoom() - 0.1));
        bind(root.getElementById('zoomReset'), 'click', () => {
            this.wheelDelta = 0;
            this.setZoom(1);
        });
        bind(canvas, 'wheel', event => {
            // Leave Ctrl+wheel to the browser's accessibility/page zoom.
            if (event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
            event.preventDefault();
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (canvas.clientHeight || 500) : 1;
            const pixels = Math.max(-200, Math.min(200, event.deltaY * unit));
            this.wheelDelta += pixels;
            const steps = Math.trunc(this.wheelDelta / 40);
            if (!steps) return;
            this.wheelDelta %= 40;
            this.setZoom(this.getZoom() - Math.max(-5, Math.min(5, steps)) * 0.1);
        }, {passive: false});
        this.onChange = () => this.updateDisplay();
        settings.on('settingRadarZoom', this.onChange);
        this.cleanups.push(() => settings.off('settingRadarZoom', this.onChange));
        this.updateDisplay();
    }

    getZoom() { return normalizeRadarZoom(this.settings.getFloat('settingRadarZoom')); }

    setZoom(value) {
        const finite = Number.isFinite(value) ? value : 1;
        const next = Math.round(Math.max(MIN_RADAR_ZOOM, Math.min(MAX_RADAR_ZOOM, finite)) * 10) / 10;
        if (next !== this.settings.getFloat('settingRadarZoom')) this.settings.setFloat('settingRadarZoom', next);
        this.updateDisplay();
    }

    updateDisplay() {
        const zoom = this.getZoom();
        if (this.label) this.label.textContent = `${Math.round(zoom * 100)}%`;
        if (this.slider) this.slider.value = String(zoom);
        if (this.zoomIn) this.zoomIn.disabled = zoom >= MAX_RADAR_ZOOM;
        if (this.zoomOut) this.zoomOut.disabled = zoom <= MIN_RADAR_ZOOM;
    }

    destroy() {
        this.cleanups.splice(0).forEach(fn => fn());
        this.wheelDelta = 0;
    }
}
