import * as EventRouter from '../core/EventRouter.js';
import zonesDatabase from '../data/ZonesDatabase.js';

const MAX_RESULTS = 50;
let activeCleanup = null;
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

// Map identity controls are independent of captured positions and entities.
export function initMapIdentity() {
    activeCleanup?.();
    const status = document.getElementById('mapIdentityStatus');
    const search = document.getElementById('mapZoneSearch');
    const select = document.getElementById('mapZoneSelect');
    const apply = document.getElementById('mapZoneApply');
    const clear = document.getElementById('mapZoneClear');
    const results = document.getElementById('mapZoneResults');
    if (!status || !search || !select || !apply || !clear || !results) return {destroy() {}};

    const entries = Object.entries(zonesDatabase.zones).map(([id, zone]) => ({id, name: zone.name || id}))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const available = zonesDatabase.loaded && entries.length > 0;
    search.disabled = select.disabled = !available;

    function updateStatus(identity = EventRouter.getMapIdentity()) {
        const name = zonesDatabase.getZone(identity.mapId)?.name;
        const label = name ? `${name} (${identity.mapId})` : String(identity.mapId);
        status.dataset.source = identity.source;
        status.dataset.mapId = String(identity.mapId);
        if (identity.source === 'manual') {
            status.textContent = `Zona indicada manualmente: ${label}. Se sustituirá al detectar una zona.`;
        } else if (identity.source === 'observed') {
            status.textContent = `Zona observada: ${label}.${identity.bootstrap ? ' Contexto capturado; la vista de entidades puede estar incompleta.' : ''}`;
        } else {
            const suggestion = EventRouter.getSuggestedMapId();
            status.textContent = 'Zona sin identificar. Selecciona la zona actual o espera una señal capturada.' +
                (suggestion ? ` La selección guardada (${suggestion}) es una sugerencia; confirma la zona actual.` : '');
        }
    }

    function updateApply() { apply.disabled = !available || !select.value; }

    function filter() {
        const query = normalize(search.value.trim());
        const matches = entries.filter(zone => normalize(`${zone.name} ${zone.id}`).includes(query));
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Selecciona una zona conocida';
        select.append(placeholder);
        for (const zone of matches.slice(0, MAX_RESULTS)) {
            const option = document.createElement('option');
            option.value = zone.id;
            option.textContent = `${zone.name} (${zone.id})`;
            select.append(option);
        }
        results.textContent = available ? `${Math.min(matches.length, MAX_RESULTS)} de ${matches.length} zonas${matches.length > MAX_RESULTS ? '; escribe para filtrar' : ''}.` :
            'Base de zonas no disponible. Espera una señal capturada.';
        updateApply();
    }

    const applySelection = () => EventRouter.applyManualMapIdentity(select.value);
    const clearSelection = () => EventRouter.clearMapIdentity();
    search.addEventListener('input', filter);
    select.addEventListener('change', updateApply);
    apply.addEventListener('click', applySelection);
    clear.addEventListener('click', clearSelection);
    EventRouter.setMapIdentityCallback(updateStatus);
    const suggestion = EventRouter.getSuggestedMapId();
    if (suggestion) search.value = suggestion;
    filter();
    if (suggestion) select.value = suggestion;
    updateApply();
    updateStatus();

    let destroyed = false;
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        search.removeEventListener('input', filter);
        select.removeEventListener('change', updateApply);
        apply.removeEventListener('click', applySelection);
        clear.removeEventListener('click', clearSelection);
        if (activeCleanup === destroy) {
            EventRouter.setMapIdentityCallback(null);
            activeCleanup = null;
        }
    }
    activeCleanup = destroy;
    return {destroy};
}
