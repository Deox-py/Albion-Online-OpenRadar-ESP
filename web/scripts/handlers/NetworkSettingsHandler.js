const BADGES = {
    wifi: '🛜', ethernet: '🔌', exitlag: '🚀', vpn: '🔒', virtual: '🧪', other: '•',
};
const BADGE_LABEL = {
    wifi: 'WiFi', ethernet: 'Ethernet', exitlag: 'ExitLag', vpn: 'VPN', virtual: 'Virtual', other: 'Otros',
};

export class NetworkSettingsHandler {
    constructor(container) {
        this.container = container;
        this.interfaces = [];
        this.state = null;
    }

    async load() {
        const [ifacesRes, stateRes] = await Promise.all([
            fetch('/api/network/interfaces'),
            fetch('/api/network/state'),
        ]);
        if (!ifacesRes.ok || !stateRes.ok) {
            this.container.innerHTML = `<div class="alert alert-error">No se pudo cargar la configuración de red.</div>`;
            return;
        }
        this.interfaces = await ifacesRes.json();
        this.state = await stateRes.json();
        this.render();
    }

    render() {
        const activeNames = new Set((this.state?.captureInterfaces ?? []).map(c => c.name));
        const banner = this.renderBanner();
        const rows = this.interfaces.map(i => this.renderRow(i, activeNames.has(i.name))).join('');
        const lan = (this.state?.lanAddresses ?? []).map(a => {
            const safe = escapeHTML(a);
            return `<li><a data-lan-url href="http://${safe}:5001/" target="_blank" rel="noopener noreferrer" class="link link-primary">http://${safe}:5001/</a></li>`;
        }).join('');
        this.container.innerHTML = `
            ${banner}
            ${this.renderExitLagNotice()}
            <h3 class="text-base font-semibold mt-2">Interfaces de captura</h3>
            <p class="text-sm opacity-70 mb-2">Los paquetes capturados se combinan entre todas las interfaces seleccionadas. Marca al menos una para iniciar la captura.</p>
            <div class="flex flex-col gap-1">${rows}</div>
            <div class="flex gap-2 mt-3">
                <button class="btn btn-sm" data-action="refresh">Actualizar lista</button>
                <button class="btn btn-sm btn-primary" data-action="apply" disabled>Aplicar cambios</button>
            </div>
            <h3 class="text-base font-semibold mt-6">Acceso LAN</h3>
            <p class="text-sm opacity-70">Accesible desde dispositivos de la misma red local. Es independiente de las interfaces de captura seleccionadas arriba.</p>
            <ul class="list-disc pl-5">${lan || '<li class="opacity-60">Acceso LAN desactivado. Inicia OpenRadar con <code>--lan</code> si realmente lo necesitas.</li>'}</ul>
        `;
        this.bindEvents();
    }

    renderExitLagNotice() {
        return `
            <div class="alert alert-info mb-2" data-exitlag-notice>
                <div class="flex flex-col gap-1">
                    <div class="font-semibold">¿Usas ExitLag?</div>
                    <div class="text-sm">
                        Abre <strong>ExitLag &rarr; Configuración &rarr; Opciones avanzadas &rarr; Método de redirección</strong>
                        y selecciona <strong>NDIS (legacy)</strong>.
                    </div>
                    <div class="text-sm">
                        El modo WFP predeterminado oculta el tráfico de Albion de la captura de paquetes; el radar no verá ningún paquete.
                    </div>
                </div>
            </div>
        `;
    }

    renderBanner() {
        if (this.state?.status === 'awaiting_interfaces') {
            return `<div class="alert alert-warning mb-2">⚠ La captura no está activa. Selecciona al menos una interfaz para comenzar.</div>`;
        }
        const n = (this.state?.captureInterfaces ?? []).length;
        return `<div class="alert alert-success mb-2">✓ Capturando en ${n} ${n === 1 ? 'interfaz' : 'interfaces'}.</div>`;
    }

    renderRow(iface, checked) {
        const badge = BADGES[iface.category] ?? BADGES.other;
        const label = BADGE_LABEL[iface.category] ?? BADGE_LABEL.other;
        const unavail = iface.isAvailable ? '' : ' <span class="opacity-60">(no disponible)</span>';
        return `
            <label class="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-base-300/40" data-iface="${escapeHTML(iface.name)}">
                <input type="checkbox" class="checkbox checkbox-sm" ${checked ? 'checked' : ''} ${iface.isAvailable ? '' : 'disabled'}>
                <span class="badge badge-outline">${badge} ${label}</span>
                <span class="flex-1">${escapeHTML(iface.description || iface.name)}${unavail}</span>
                <span class="opacity-60 text-sm">${escapeHTML(iface.address || '')}</span>
            </label>
        `;
    }

    bindEvents() {
        for (const cb of this.container.querySelectorAll('[data-iface] input')) {
            cb.addEventListener('change', () => this.updateApplyState());
        }
        const applyBtn = this.container.querySelector('[data-action="apply"]');
        applyBtn?.addEventListener('click', () => this.apply());
        const refreshBtn = this.container.querySelector('[data-action="refresh"]');
        refreshBtn?.addEventListener('click', () => this.refresh());
    }

    updateApplyState() {
        const selected = [...this.selectedNames()].sort();
        const current = (this.state?.captureInterfaces ?? []).map(c => c.name).sort();
        const same = selected.length === current.length && selected.every((n, i) => n === current[i]);
        const btn = this.container.querySelector('[data-action="apply"]');
        if (btn) btn.disabled = same;
    }

    selectedNames() {
        return [...this.container.querySelectorAll('[data-iface] input:checked')]
            .map(cb => cb.closest('[data-iface]').dataset.iface);
    }

    async apply() {
        const btn = this.container.querySelector('[data-action="apply"]');
        if (btn?.disabled) return;
        if (btn) btn.disabled = true;
        try {
            const names = this.selectedNames();
            const res = await fetch('/api/network/interfaces', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({names}),
            });
            if (!res.ok) {
                const txt = await res.text();
                window.toast?.error?.(`Error al aplicar: ${txt}`);
                if (btn) btn.disabled = false;
                return;
            }
            window.toast?.success?.('Interfaces de captura actualizadas.');
            await this.load();
        } catch (err) {
            window.toast?.error?.(`Error de red: ${err.message ?? err}`);
            if (btn) btn.disabled = false;
        }
    }

    async refresh() {
        try {
            const r = await fetch('/api/network/refresh', {method: 'POST'});
            if (!r.ok) {
                window.toast?.error?.('Error al actualizar.');
                return;
            }
            await this.load();
        } catch (err) {
            window.toast?.error?.(`Error de actualización: ${err.message ?? err}`);
        }
    }
}

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
