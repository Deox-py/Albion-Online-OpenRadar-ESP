// A passive stream cannot request missing entity spawns from the game. When
// events are lost, discard unreliable caches and explain the recovery limit.
export function invalidateRadarState(handlers, renderer, reason) {
    for (const handler of Object.values(handlers)) handler?.Clear?.();
    if (handlers.chests) handlers.chests.chestsList = [];
    if (handlers.dungeons) handlers.dungeons.dungeonList = [];
    if (renderer) {
        renderer.cachedClusters = null;
        renderer.invalidateLocalPlayerPosition?.();
    }

    const status = document.getElementById('streamHealth');
    if (!status) return;
    const cause = reason === 'connection-lost' ? 'Se perdió la conexión.' : 'Se perdieron eventos del radar.';
    status.textContent = `${cause} Se descartaron los datos anteriores. La vista puede estar incompleta hasta cambiar de zona.`;
    status.dataset.reason = reason;
    status.hidden = false;
}

export function clearStreamWarning() {
    const status = document.getElementById('streamHealth');
    if (!status) return;
    status.hidden = true;
    status.textContent = '';
    delete status.dataset.reason;
}
