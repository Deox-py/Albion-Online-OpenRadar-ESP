// EventRouter.js - WebSocket event routing to handlers
// Extracted from Utils.js during Phase 1B refactor

import {EventCodes} from '../utils/EventCodes.js';
import {OperationCodes} from '../utils/OperationCodes.js';
import {CATEGORIES} from '../constants/LoggerConstants.js';
import zonesDatabase from '../data/ZonesDatabase.js';
import {isSmallTreasureInfo} from '../handlers/ChestsHandler.js';

function syncMapIsBZ() {
    if (!map) return;
    map.isBZ = zonesDatabase.isBlackZone(map.id);
}

// Map change debouncing
const MAP_CHANGE_DEBOUNCE_MS = 4000;
const MIST_CHOICE_TTL_MS = 30000;
let lastMapChangeTime = 0;
let pendingMistChoice = null;

// Sanctuary chain tracking
const MIST_CHAIN_TTL_MS = 30 * 60 * 1000;
let lastActiveMistOverride = null;

function isSanctuaryId(mapId) {
    return typeof mapId === 'string' && mapId.startsWith('@MISTSDUNGEON@');
}

function isPlainMistId(mapId) {
    return typeof mapId === 'string' && mapId.startsWith('@MISTS@');
}

// Local player position (relative coords)
let lpX = 0.0;
let lpY = 0.0;

// Expose globally for debug access
window.lpX = lpX;
window.lpY = lpY;

// Dependency references (set via init)
let handlers = null;
let map = null;
let radarRenderer = null;
let suggestedMapId = null;
let mapIdentityCallback = null;

export function getMapIdentity() {
    return {mapId: map?.id ?? -1, source: map?.source ?? 'unknown',
        observedAt: map?.observedAt ?? null, bootstrap: map?.bootstrap ?? false};
}

export function setMapIdentityCallback(callback) {
    mapIdentityCallback = callback;
}

export function getSuggestedMapId() {
    return suggestedMapId;
}

function publishMapIdentity() {
    radarRenderer?.setMap?.(map);
    mapIdentityCallback?.(getMapIdentity());
}

function setIdentity(mapId, source, observedAt = null, bootstrap = false) {
    if (!map) return false;
    map.id = mapId;
    map.source = source;
    map.observedAt = observedAt;
    map.bootstrap = bootstrap;
    if (source !== 'observed' || (!isPlainMistId(mapId) && !isSanctuaryId(mapId))) map.mistLethal = null;
    window.currentMapId = mapId;
    syncMapIsBZ();
    persistMapToSession();
    publishMapIdentity();
    return true;
}

export function applyManualMapIdentity(mapId) {
    if (typeof mapId !== 'string' || !Object.hasOwn(zonesDatabase.zones, mapId)) return false;
    // Manual identity cannot supply the origin or risk of a dynamic Mist instance.
    zonesDatabase.clearAllMistOverrides();
    pendingMistChoice = null;
    lastActiveMistOverride = null;
    clearMistOverridePersistence();
    return setIdentity(mapId, 'manual');
}

export function clearMapIdentity() {
    zonesDatabase.clearAllMistOverrides();
    pendingMistChoice = null;
    lastActiveMistOverride = null;
    clearMistOverridePersistence();
    suggestedMapId = null;
    return setIdentity(-1, 'unknown');
}

export function applyObservedMapContext(context) {
    const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 256
        && id.trim() === id && id !== '-1';
    if (!map || !context || !validId(context.mapId)
        || !['join', 'change-cluster', 'mists-player-joined'].includes(context.source)
        || !Number.isSafeInteger(context.observedAt) || context.observedAt <= 0
        || (context.originCluster !== undefined && !validId(context.originCluster))
        || (context.mistLethal !== undefined && typeof context.mistLethal !== 'boolean')) return false;
    pendingMistChoice = null;
    lastActiveMistOverride = null;
    map.mistLethal = typeof context.mistLethal === 'boolean' ? context.mistLethal : null;
    if (isPlainMistId(context.mapId) || isSanctuaryId(context.mapId)) {
        // Use only explicitly captured metadata; a manual zone is not evidence of an origin.
        zonesDatabase.clearMistOverride(context.mapId);
        if (typeof context.originCluster === 'string' && context.originCluster.length) {
            const pvpType = typeof context.mistLethal === 'boolean' ? (context.mistLethal ? 'black' : 'yellow') : 'unknown';
            if (zonesDatabase.setMistOverride(context.mapId, context.originCluster, pvpType)) {
                const resolved = zonesDatabase.getZone(context.mapId);
                lastActiveMistOverride = {mistMapId:context.mapId, originZoneId:context.originCluster,
                    pvpType:resolved.pvpType, ts:context.observedAt};
            }
        }
    } else {
        zonesDatabase.clearAllMistOverrides();
        pendingMistChoice = null;
        lastActiveMistOverride = null;
        clearMistOverridePersistence();
    }
    // Cached identity is partial historical context, never a position or entity replay.
    return setIdentity(context.mapId, 'observed', context.observedAt, true);
}

// Helper: Update local player position (DRY pattern)
function updateLocalPlayerPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        window.logger?.warn(CATEGORIES.PLAYERS, 'InvalidLocalPlayerPosition', {x, y});
        return;
    }
    lpX = x;
    lpY = y;
    window.lpX = lpX;
    window.lpY = lpY;
    handlers?.playersHandler?.updateLocalPlayerPosition(lpX, lpY);
    radarRenderer?.setLocalPlayerPosition?.(lpX, lpY);
}

function persistMapToSession() {
    try {
        sessionStorage.setItem('lastMapDisplayed', JSON.stringify({
            mapId: map.id,
            source: map.source,
            timestamp: Date.now()
        }));
    } catch (e) {
        window.logger?.warn(CATEGORIES.MAP, 'SessionStorageFailed', {error: e?.message});
    }
}

function persistMistOverride(mistMapId, originZoneId, pvpType) {
    try {
        sessionStorage.setItem('activeMistOverride', JSON.stringify({
            mistMapId,
            originZoneId,
            pvpType,
            timestamp: Date.now()
        }));
    } catch (e) {
        window.logger?.warn(CATEGORIES.MAP, 'MistOverridePersistFailed', {error: e?.message});
    }
}

function clearMistOverridePersistence() {
    try {
        sessionStorage.removeItem('activeMistOverride');
    } catch (e) {
        window.logger?.warn(CATEGORIES.MAP, 'MistOverrideClearFailed', {error: e?.message});
    }
}

function resolveMistOriginId(previousMapId) {
    if (typeof previousMapId !== 'string' || previousMapId.length === 0) return null;
    if (!previousMapId.startsWith('@MISTS@')) return previousMapId;
    const prevOverride = zonesDatabase.getZone(previousMapId);
    return prevOverride && typeof prevOverride.originZoneId === 'string'
        ? prevOverride.originZoneId
        : null;
}

function consumePendingMistChoice() {
    if (!pendingMistChoice) return null;
    const age = Date.now() - pendingMistChoice.ts;
    const choice = age <= MIST_CHOICE_TTL_MS ? pendingMistChoice : null;
    pendingMistChoice = null;
    return choice;
}

function applyMapChange(newMapId, logEvent, extraLogFields = {}) {
    radarRenderer?.invalidateLocalPlayerPosition?.();
    const previousMapId = map.id;
    if (typeof newMapId === 'string' && newMapId.length > 0 && newMapId !== previousMapId) {
        handlers?.chestsHandler?.Clear?.();
    }
    const previousSource = map.source;
    const previousMistLethal = map.mistLethal;
    map.id = newMapId;
    map.source = 'observed';
    map.observedAt = Date.now();
    map.bootstrap = false;
    window.currentMapId = map.id;
    lastMapChangeTime = Date.now();

    if (isPlainMistId(newMapId)) {
        const choice = consumePendingMistChoice();
        map.mistLethal = choice ? choice.lethal : (previousSource === 'observed'
            && (isPlainMistId(previousMapId) || isSanctuaryId(previousMapId))
            && lastActiveMistOverride && Date.now() - lastActiveMistOverride.ts <= MIST_CHAIN_TTL_MS
            ? previousMistLethal : null);
        let forcedPvpType = choice ? (choice.lethal ? 'black' : 'yellow') : undefined;
        const explicitOrigin = typeof extraLogFields.originCluster === 'string'
            && extraLogFields.originCluster.length > 0
            ? extraLogFields.originCluster
            : null;
        let originId = explicitOrigin;

        if (!originId && previousSource === 'manual') {
            // A user-selected zone does not prove where this Mist was entered.
        } else if (!originId && isSanctuaryId(previousMapId)) {
            if (lastActiveMistOverride
                && (Date.now() - lastActiveMistOverride.ts) <= MIST_CHAIN_TTL_MS) {
                originId = lastActiveMistOverride.originZoneId;
                if (!forcedPvpType) {
                    forcedPvpType = lastActiveMistOverride.pvpType;
                }
            }
        } else if (!originId && isPlainMistId(previousMapId)) {
            const prevOverride = zonesDatabase.getZone(previousMapId);
            if (prevOverride && typeof prevOverride.originZoneId === 'string') {
                originId = prevOverride.originZoneId;
                if (!forcedPvpType) {
                    forcedPvpType = prevOverride.pvpType;
                }
            }
        } else if (!originId) {
            originId = resolveMistOriginId(previousMapId);
        }

        if (originId && zonesDatabase.setMistOverride(newMapId, originId, forcedPvpType)) {
            const resolved = zonesDatabase.getZone(newMapId);
            lastActiveMistOverride = {
                mistMapId: newMapId,
                originZoneId: originId,
                pvpType: resolved.pvpType,
                ts: Date.now(),
            };
            persistMistOverride(newMapId, originId, resolved.pvpType);
        }
    } else if (isSanctuaryId(newMapId)) {
        if (lastActiveMistOverride
            && (Date.now() - lastActiveMistOverride.ts) <= MIST_CHAIN_TTL_MS) {
            zonesDatabase.setMistOverride(newMapId, lastActiveMistOverride.originZoneId, lastActiveMistOverride.pvpType);
            persistMistOverride(newMapId, lastActiveMistOverride.originZoneId, lastActiveMistOverride.pvpType);
        }
    } else {
        map.mistLethal = null;
        zonesDatabase.clearAllMistOverrides();
        clearMistOverridePersistence();
        pendingMistChoice = null;
        lastActiveMistOverride = null;
    }

    syncMapIsBZ();
    radarRenderer?.setMap?.(map);
    persistMapToSession();
    publishMapIdentity();
    window.logger?.info(CATEGORIES.MAP, logEvent, {
        previousMapId,
        newMapId: map.id,
        ...extraLogFields
    });
}

function decodeJoinPosition(p9) {
    if (p9 && p9.type === 'Buffer') {
        if (!Array.isArray(p9.data) || p9.data.length < 8) {
            window.logger?.warn(CATEGORIES.PLAYERS, 'InvalidJoinPositionBuffer', {});
            return;
        }
        const dataView = new DataView(new Uint8Array(p9.data).buffer);
        updateLocalPlayerPosition(dataView.getFloat32(0, true), dataView.getFloat32(4, true));
        window.logger?.info(CATEGORIES.PLAYERS, 'OnResponse_JoinMap_BufferDecoded', {lpX, lpY});
        return;
    }
    if (Array.isArray(p9)) {
        updateLocalPlayerPosition(p9[0], p9[1]);
        window.logger?.info(CATEGORIES.PLAYERS, 'OnResponse_JoinMap_Array', {lpX, lpY});
        return;
    }
    window.logger?.error(CATEGORIES.PLAYERS, 'OnResponse_JoinMap_UnknownFormat', {
        param9: p9,
        param9Type: typeof p9
    });
}

function handleChangeClusterResponse(Parameters, clearHandlersCallback) {
    const newMapId = Parameters[0];
    if (typeof newMapId !== 'string' || newMapId.length === 0) {
        return;
    }
    if (newMapId === map.id) {
        setIdentity(newMapId, 'observed', Date.now());
        return;
    }
    applyMapChange(newMapId, 'ChangeClusterResponse');
    clearHandlersCallback();
}

function handleLegacyMapChangeResponse(Parameters) {
    const newMapId = Parameters[0];
    const now = Date.now();
    const timeSinceLastChange = now - lastMapChangeTime;
    if (timeSinceLastChange < MAP_CHANGE_DEBOUNCE_MS && map.id !== -1) {
        window.logger?.debug(CATEGORIES.MAP, 'MapChangeDebounced', {
            currentMapId: map.id,
            newMapId,
            timeSinceLastChange
        });
        return;
    }
    if (newMapId === map.id) return;
    applyMapChange(newMapId, 'MapChanged');
}

function handleJoinResponse(Parameters, clearHandlersCallback) {
    radarRenderer?.invalidateLocalPlayerPosition?.();
    if (typeof Parameters[8] === 'string' && Parameters[8].length > 0) {
        applyMapChange(Parameters[8], 'MapChangedFromJoinMap');
    }
    decodeJoinPosition(Parameters[9]);
    clearHandlersCallback();
}

const EVENT_NAMES_BY_CODE = new Map(Object.entries(EventCodes).map(([name, code]) => [code, name]));

// Helper function to get event name (for debugging)
function getEventName(eventCode) {
    return EVENT_NAMES_BY_CODE.get(eventCode) ?? `Unknown_${eventCode}`;
}

export function init(deps) {
    handlers = deps.handlers;
    map = deps.map;
    radarRenderer = deps.radarRenderer;
}

export function setRadarRenderer(renderer) {
    radarRenderer = renderer;
}

export function getLocalPlayerPosition() {
    return {x: lpX, y: lpY};
}

export function _debugGetPendingMistChoice() {
    return pendingMistChoice;
}

export function restoreMistOverrideFromSession() {
    try {
        const saved = sessionStorage.getItem('activeMistOverride');
        if (!saved) return;
        const data = JSON.parse(saved);
        const age = Date.now() - data?.timestamp;
        if (data && typeof data.mistMapId === 'string' && typeof data.originZoneId === 'string'
            && map?.source === 'observed' && map.id === data.mistMapId
            && Number.isSafeInteger(data.timestamp) && age >= 0 && age <= MIST_CHAIN_TTL_MS) {
            zonesDatabase.setMistOverride(data.mistMapId, data.originZoneId, data.pvpType);
            const resolved = zonesDatabase.getZone(data.mistMapId);
            if (resolved) {
                lastActiveMistOverride = {
                    mistMapId: data.mistMapId,
                    originZoneId: data.originZoneId,
                    pvpType: resolved.pvpType,
                    ts: data.timestamp,
                };
            }
            window.logger?.info(CATEGORIES.MAP, 'MistOverrideRestored', {
                mistMapId: data.mistMapId,
                originZoneId: data.originZoneId,
                pvpType: data.pvpType,
                age: Date.now() - (data.timestamp || 0)
            });
        }
    } catch (e) {
        window.logger?.warn(CATEGORIES.MAP, 'MistOverrideRestoreFailed', {error: e?.message});
    }
}

export function restoreMapFromSession() {
    if (!map) return;

    try {
        const savedMap = sessionStorage.getItem('lastMapDisplayed');
        window.logger?.debug(CATEGORIES.MAP, 'SessionRestoreAttempt', {
            hasData: !!savedMap
        });

        if (savedMap) {
            const data = JSON.parse(savedMap);

            if (typeof data?.mapId === 'string' && Object.hasOwn(zonesDatabase.zones, data.mapId)) {
                suggestedMapId = data.mapId;

                window.logger?.info(CATEGORIES.MAP, 'MapRestoredFromSession', {
                    mapId: suggestedMapId,
                    age: Date.now() - (data.timestamp || 0)
                });
            }
        }
    } catch (e) {
        window.logger?.warn(CATEGORIES.MAP, 'SessionRestoreFailed', {error: e?.message});
    }
}

export function onEvent(Parameters) {
    const id = parseInt(Parameters[0]);
    const eventCode = Parameters[252];

    // Raw packet logging
    window.logger?.debug(CATEGORIES.NETWORK, `Event_${eventCode}`, {
        id,
        eventCode,
        allParameters: Parameters
    });

    // Detailed event logging (skip verbose events)
    if (eventCode !== EventCodes.RegenerationHealthChanged) {
        const paramDetails = {};
        for (let key in Parameters) {
            if (Parameters.hasOwnProperty(key) && key !== '252' && key !== '0') {
                paramDetails[`param[${key}]`] = Parameters[key];
            }
        }

        window.logger?.debug(CATEGORIES.NETWORK, `Event_${eventCode}_ID_${id}`, {
            id,
            eventCode,
            eventName: getEventName(eventCode),
            parameterCount: Object.keys(Parameters).length,
            parameters: paramDetails
        });
    }

    const {
        playersHandler, mobsHandler, harvestablesHandler, chestsHandler,
        dungeonsHandler, fishingHandler, wispCageHandler
    } = handlers;

    switch (eventCode) {
        case EventCodes.Leave:
            playersHandler.removePlayer(id);
            mobsHandler.removeMist(id);
            mobsHandler.removeMob(id);
            dungeonsHandler.removeDungeon(id);
            chestsHandler.removeChest(Parameters[0]);
            fishingHandler.removeFish(id);
            wispCageHandler.removeCage(id);
            handlers.mistsDungeonHandler?.removePortal(id);
            break;

        case EventCodes.Move:
            const posX = Parameters[4];
            const posY = Parameters[5];
            mobsHandler.updateMistPosition(id, posX, posY);
            mobsHandler.updateMobPosition(id, posX, posY);
            break;

        case EventCodes.NewCharacter:
            playersHandler.handleNewPlayerEvent(id, Parameters);
            break;

        case EventCodes.NewSimpleHarvestableObjectList:
            harvestablesHandler.newSimpleHarvestableObject(Parameters);
            break;

        case EventCodes.NewHarvestableObject:
            harvestablesHandler.newHarvestableObject(id, Parameters);
            break;

        case EventCodes.HarvestableChangeState:
            harvestablesHandler.HarvestUpdateEvent(Parameters);
            break;

        case EventCodes.HarvestStart:
        case EventCodes.HarvestCancel:
            // Handled by HarvestablesHandler via database validation
            break;

        case EventCodes.HarvestFinished:
            harvestablesHandler.harvestFinished(Parameters);
            break;

        case EventCodes.InventoryPutItem:
        case EventCodes.InventoryDeleteItem:
        case EventCodes.InventoryState:
        case EventCodes.NewSimpleItem:
        case EventCodes.NewEquipmentItem:
        case EventCodes.NewJournalItem:
        case EventCodes.UpdateFame:
        case EventCodes.UpdateMoney:
            // Inventory/economy events - not currently used
            break;

        case EventCodes.MobChangeState:
            mobsHandler.updateEnchantEvent(Parameters);
            break;

        case EventCodes.RegenerationHealthChanged: {
            const mobInfo = mobsHandler.debugLogMobById(Parameters[0]);
            window.logger?.debug(CATEGORIES.MOBS, 'regen_health_changed', {
                eventCode: EventCodes.RegenerationHealthChanged,
                id: Parameters[0],
                mobInfo,
                allParameters: Parameters
            });
        }
            playersHandler.UpdatePlayerHealth(Parameters);
            mobsHandler.updateMobHealthRegen(Parameters);
            break;

        case EventCodes.HealthUpdate: {
            const mobInfo = mobsHandler.debugLogMobById(Parameters[0]);
            window.logger?.debug(CATEGORIES.MOBS, 'health_update', {
                eventCode: EventCodes.HealthUpdate,
                id: Parameters[0],
                mobInfo,
                allParameters: Parameters
            });
        }
            playersHandler.UpdatePlayerLooseHealth(Parameters);
            mobsHandler.updateMobHealth(Parameters);
            break;

        case EventCodes.HealthUpdates:
            window.logger?.debug(CATEGORIES.MOBS, 'bulk_hp_update', {
                eventCode: EventCodes.HealthUpdates,
                allParameters: Parameters
            });
            mobsHandler.updateMobHealthBulk(Parameters);
            break;

        case EventCodes.CharacterEquipmentChanged:
            playersHandler.updateItems(id, Parameters);
            break;

        case EventCodes.NewMob: {
            const info = window.mobsDatabase?.getMobInfo(Parameters[1]);
            if (isSmallTreasureInfo(info)) {
                if (chestsHandler.addSmallTreasureEvent(Parameters, info)) mobsHandler.removeMob(id);
            } else {
                mobsHandler.NewMobEvent(Parameters);
            }
            break;
        }

        case EventCodes.Mounted:
            playersHandler.handleMountedPlayerEvent(id, Parameters);
            break;

        case EventCodes.NewRandomDungeonExit: {
            // Dragonfire inserted a parameter at [4]; the Mists tag moved from [15] to [16].
            const tag = Parameters[16];
            if (typeof tag === 'string' && tag.startsWith('MISTS_DUNGEON')) {
                const pos = Parameters[1];
                if (Array.isArray(pos) && pos.length === 2) {
                    handlers.mistsDungeonHandler?.addPortal(Parameters[0], pos[0], pos[1], tag);
                }
            } else {
                dungeonsHandler.dungeonEvent(Parameters);
            }
            break;
        }

        case EventCodes.NewLootChest:
            chestsHandler.addChestEvent(Parameters);
            break;

        case EventCodes.UpdateLootChest:
            chestsHandler.updateChestEvent(Parameters);
            break;

        case EventCodes.LootChestOpened:
            chestsHandler.chestOpenedEvent(Parameters);
            break;

        case EventCodes.NewCagedObject:
            wispCageHandler.newCageEvent(Parameters);
            break;

        case EventCodes.CagedObjectStateUpdated:
            wispCageHandler.cageOpenedEvent(Parameters);
            break;

        case EventCodes.NewFishingZoneObject:
            fishingHandler.newFishEvent(Parameters);
            break;

        case EventCodes.FishingFinished:
            fishingHandler.fishingEnd(Parameters);
            break;

        case EventCodes.ChangeFlaggingFinished:
            playersHandler.updatePlayerFaction(Parameters[0], Parameters[1]);
            break;

        case EventCodes.MistsPlayerJoinedInfo: {
            const newMapId = Parameters[2];
            if (Parameters[3] === true && typeof newMapId === 'string' && newMapId.length > 0) {
                if (newMapId !== map.id) {
                    applyMapChange(newMapId, 'MistsPlayerJoinedInfo', {originCluster: Parameters[4]});
                } else {
                    if (isPlainMistId(newMapId) || isSanctuaryId(newMapId)) {
                        const choice = consumePendingMistChoice();
                        if (choice) map.mistLethal = choice.lethal;
                        const pvpType = typeof map.mistLethal === 'boolean' ? (map.mistLethal ? 'black' : 'yellow') : 'unknown';
                        if (typeof Parameters[4] === 'string' && zonesDatabase.setMistOverride(newMapId, Parameters[4], pvpType)) {
                            lastActiveMistOverride = {mistMapId:newMapId,originZoneId:Parameters[4],pvpType,ts:Date.now()};
                            persistMistOverride(newMapId,Parameters[4],pvpType);
                        }
                    }
                    setIdentity(newMapId, 'observed', Date.now());
                }
            }
            break;
        }

        case EventCodes.NewMistsImmediateReturnExit:
        case EventCodes.NewMistsStaticEntrance:
        case EventCodes.MistsEntranceDataChanged:
            // Passive diagnostics only. These post-Dragonfire events are not yet
            // used as positional signals because their payload semantics are not
            // fully verified. Logging them helps future protocol fixes safely.
            window.logger?.debug(CATEGORIES.MAP, 'MistsAuxEvent', {eventCode, parameters: Parameters});
            break;

    }
}

export function onRequest(Parameters) {
    // 22 = OperationCodes.Move. 21 = legacy pre-Protocol18 Move (upstream 21 is now GetShopTilesForCategory).
    if (Parameters[253] == 21 || Parameters[253] == OperationCodes.Move) {
        if (Array.isArray(Parameters[1]) && Parameters[1].length === 2) {
            updateLocalPlayerPosition(Parameters[1][0], Parameters[1][1]);
            window.logger?.debug(CATEGORIES.PLAYERS, 'Operation21_LocalPlayer', {lpX, lpY});
        }
        // Legacy Buffer handling
        else if (Parameters[1] && Parameters[1].type === 'Buffer') {
            if (!Array.isArray(Parameters[1].data) || Parameters[1].data.length < 8) {
                window.logger?.warn(CATEGORIES.PLAYERS, 'InvalidMovePositionBuffer', {});
                return;
            }
            const uint8Array = new Uint8Array(Parameters[1].data);
            const dataView = new DataView(uint8Array.buffer);
            updateLocalPlayerPosition(dataView.getFloat32(0, true), dataView.getFloat32(4, true));
        } else {
            window.logger?.error(CATEGORIES.PLAYERS, 'OnRequest_Move_UnknownFormat', {
                param1: Parameters[1],
                param1Type: typeof Parameters[1]
            });
        }
    }

    if (Parameters[253] == OperationCodes.MistsUseStaticEntrance && Parameters[1] == 8) {
        pendingMistChoice = {
            ts: Date.now(),
            lethal: Parameters[2] !== undefined,
        };
        window.logger?.info(CATEGORIES.MAP, 'MistChoicePending', {
            lethal: pendingMistChoice.lethal,
            mode: Parameters[2] ?? null,
        });
    }
}

export function onResponse(Parameters, clearHandlersCallback) {
    if (Parameters[253] == OperationCodes.ChangeCluster) {
        handleChangeClusterResponse(Parameters, clearHandlersCallback);
        return;
    }
    // upstream 35 = InventoryStack; this branch treats it as a map-change response, semantics diverge.
    if (Parameters[253] == 35) {
        handleLegacyMapChangeResponse(Parameters);
        return;
    }
    if (Parameters[253] == OperationCodes.Join) {
        handleJoinResponse(Parameters, clearHandlersCallback);
    }
}

export function reset() {
    handlers?.chestsHandler?.Clear?.();
    lpX = 0.0;
    lpY = 0.0;
    window.lpX = 0;
    window.lpY = 0;
    lastMapChangeTime = 0;
    pendingMistChoice = null;
    lastActiveMistOverride = null;
    suggestedMapId = null;
    mapIdentityCallback = null;

    // Clear references to prevent memory leaks
    handlers = null;
    map = null;
    radarRenderer = null;
}

export function _debugGetLastActiveMistOverride() {
    return lastActiveMistOverride;
}
