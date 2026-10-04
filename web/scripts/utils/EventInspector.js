const MAX_RAW_CHARS = 65536;
const MAX_BATCH_EVENTS = 100;
const MAX_RECORDS_PER_SECOND = 200;
const MAX_FRAMES_PER_SECOND = 60;
const KINDS = new Set(['event', 'request', 'response']);
const SENSITIVE_KEY = /password|token|secret|authorization|cookie/i;

// Copies only a finite part of the already-decoded event. Numeric Photon
// parameter keys have unknown semantics: payload sharing requires user opt-in.
function boundedCopy(value, depth = 0, budget = {nodes: 128}) {
    if (--budget.nodes < 0 || depth > 4) return '[bounded]';
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value.slice(0, 256);
    if (Array.isArray(value)) return value.slice(0, 16).map(item => boundedCopy(item, depth + 1, budget));
    if (!value || typeof value !== 'object') return '[unsupported]';
    const output = Object.create(null);
    let count = 0;
    for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (++count > 16 || budget.nodes <= 0) break;
        const safeKey = key.slice(0, 64);
        output[safeKey] = SENSITIVE_KEY.test(key) ? '[redacted]' : boundedCopy(value[key], depth + 1, budget);
    }
    return output;
}

export class EventInspector {
    constructor({root = null, maxEvents = 500} = {}) {
        this.root = root;
        this.maxEvents = Number.isSafeInteger(maxEvents) ? Math.max(1, Math.min(1000, maxEvents)) : 500;
        this.enabled = false;
        this.includePayload = false;
        this.destroyed = false;
        this.records = [];
        this.dropped = 0;
        this.windowStart = 0;
        this.framesThisWindow = 0;
        this.recordsThisWindow = 0;
        this.renderTimer = null;
        this.cleanups = [];
        const bind = (selector, type, callback) => {
            const element = root?.querySelector(selector);
            if (!element) return;
            element.addEventListener(type, callback);
            this.cleanups.push(() => element.removeEventListener(type, callback));
        };
        bind('[data-inspector-enable]', 'change', event => this.setEnabled(event.target.checked));
        bind('[data-inspector-payload]', 'change', event => this.setIncludePayload(event.target.checked));
        bind('[data-inspector-clear]', 'click', () => this.clear());
        bind('[data-inspector-export]', 'click', () => this.download());
        this.render();
    }

    setEnabled(enabled) {
        if (this.destroyed) return;
        this.enabled = enabled === true;
        if (!this.enabled) {
            this.includePayload = false;
            this.clear();
        }
        this.render();
    }

    setIncludePayload(enabled) {
        if (this.destroyed) return;
        this.includePayload = this.enabled && enabled === true;
        if (!this.includePayload) {
            this.records = this.records.map(serialized => {
                const record = JSON.parse(serialized);
                delete record.parameters;
                return JSON.stringify(record);
            });
        }
        this.render();
    }

    receive(raw) {
        if (!this.enabled || this.destroyed) return;
        const now = Date.now();
        if (now - this.windowStart >= 1000 || now < this.windowStart) {
            this.windowStart = now;
            this.framesThisWindow = 0;
            this.recordsThisWindow = 0;
        }
        if (++this.framesThisWindow > MAX_FRAMES_PER_SECOND || typeof raw !== 'string' || raw.length > MAX_RAW_CHARS) {
            this.dropped++;
            this.scheduleRender();
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            const messages = parsed?.type === 'batch' ? parsed.messages : [parsed];
            if (!Array.isArray(messages)) throw new Error('invalid batch');
            this.dropped += Math.max(0, messages.length - MAX_BATCH_EVENTS);
            for (const message of messages.slice(0, MAX_BATCH_EVENTS)) {
                if (this.recordsThisWindow >= MAX_RECORDS_PER_SECOND) { this.dropped++; continue; }
                if (!message || !KINDS.has(message.code)) { this.dropped++; continue; }
                const dictionary = typeof message.dictionary === 'string' ? JSON.parse(message.dictionary) : message.dictionary;
                const parameters = dictionary?.parameters;
                if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) { this.dropped++; continue; }
                const code = parameters[message.code === 'event' ? 252 : 253];
                const record = {
                    schemaVersion: 1, receivedAt: new Date(now).toISOString(), kind: message.code,
                    code: Number.isSafeInteger(code) ? code : null,
                };
                if (this.includePayload) record.parameters = boundedCopy(parameters);
                let serialized = JSON.stringify(record);
                if (serialized.length > 8192) {
                    record.parameters = '[bounded]';
                    serialized = JSON.stringify(record);
                }
                if (this.records.length >= this.maxEvents) { this.records.shift(); this.dropped++; }
                this.records.push(serialized);
                this.recordsThisWindow++;
            }
        } catch {
            this.dropped++;
        }
        this.scheduleRender();
    }

    exportJSONL() { return this.records.length ? this.records.join('\n') + '\n' : ''; }

    download() {
        if (this.destroyed || !this.records.length) return;
        const url = URL.createObjectURL(new Blob([this.exportJSONL()], {type: 'application/x-ndjson'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = `openradar-events-${Date.now()}.jsonl`;
        document.body.appendChild(link);
        try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
    }

    clear() {
        this.records = [];
        this.dropped = 0;
        this.render();
    }

    scheduleRender() {
        if (!this.root || this.renderTimer !== null) return;
        this.renderTimer = setTimeout(() => { this.renderTimer = null; this.render(); }, 250);
    }

    render() {
        if (!this.root || this.destroyed) return;
        const enabled = this.root.querySelector('[data-inspector-enable]');
        if (enabled) enabled.checked = this.enabled;
        const payload = this.root.querySelector('[data-inspector-payload]');
        if (payload) { payload.checked = this.includePayload; payload.disabled = !this.enabled; }
        const status = this.root.querySelector('[data-inspector-status]');
        if (status) status.textContent = `${this.enabled ? 'Activo' : 'Desactivado'} · ${this.records.length}/${this.maxEvents} eventos · ${this.dropped} omitidos`;
        const preview = this.root.querySelector('[data-inspector-preview]');
        // Preview metadata only; payload remains in the explicitly requested export.
        if (preview) preview.textContent = this.records.slice(-10).map(serialized => {
            const record = JSON.parse(serialized);
            return `${record.receivedAt} ${record.kind} código ${record.code ?? '—'}`;
        }).join('\n');
        const button = this.root.querySelector('[data-inspector-export]');
        if (button) button.disabled = this.records.length === 0;
    }

    destroy() {
        this.enabled = false;
        this.includePayload = false;
        this.clear();
        this.destroyed = true;
        if (this.renderTimer !== null) clearTimeout(this.renderTimer);
        this.renderTimer = null;
        this.cleanups.forEach(cleanup => cleanup());
        this.cleanups = [];
        this.root = null;
    }
}
