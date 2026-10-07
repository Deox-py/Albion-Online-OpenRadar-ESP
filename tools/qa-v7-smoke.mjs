import assert from 'node:assert/strict';

class StorageMock {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const noop = () => {};
globalThis.localStorage = new StorageMock();
globalThis.sessionStorage = new StorageMock();
globalThis.BroadcastChannel = undefined;
globalThis.window = {
  addEventListener: noop,
  removeEventListener: noop,
  logger: {debug: noop, info: noop, warn: noop, error: noop},
  toast: {warning: noop},
  currentMapId: 'black-test',
};
globalThis.document = {
  hidden: false,
  body: {appendChild: noop},
  createElement: () => ({className: '', style: {}, remove: noop}),
};
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.fetch = async () => ({ok: true, status: 204});

const settingsSync = (await import('../web/scripts/utils/SettingsSync.js')).default;
const zonesDatabase = (await import('../web/scripts/data/ZonesDatabase.js')).default;
const {HarvestablesHandler} = await import('../web/scripts/handlers/HarvestablesHandler.js');
const {MobsHandler} = await import('../web/scripts/handlers/MobsHandler.js');
const {PlayersHandler} = await import('../web/scripts/handlers/PlayersHandler.js');
const {DungeonsHandler} = await import('../web/scripts/handlers/DungeonsHandler.js');
const {WispCageHandler} = await import('../web/scripts/handlers/WispCageHandler.js');
const EventRouter = await import('../web/scripts/core/EventRouter.js');
const {MapDrawing} = await import('../web/scripts/drawings/MapsDrawing.js');

// Stable default setting surface for the smoke run.
for (const [k, v] of Object.entries({
  settingShowPlayers: 'true',
  settingDangerousPlayers: 'true',
  settingFactionPlayers: 'true',
  settingPassivePlayers: 'true',
  settingSound: 'false',
  settingFlash: 'false',
  settingMaxPlayersDisplay: '100',
  settingShowMap: 'true',
})) localStorage.setItem(k, v);
settingsSync.cache.clear();

zonesDatabase.zones = {
  'black-test': {name: 'Black test', type: 'OPENPVP_BLACK', pvpType: 'black', tier: 6, bounds: {min: [-415,-415], max: [415,415]}},
  '0212': {name: 'Origin', type: 'OPENPVP_BLACK', pvpType: 'black', tier: 6, bounds: {min: [-415,-415], max: [415,415]}},
  '1234': {name: 'Subzone base', type: 'OPENPVP_BLACK', pvpType: 'black', tier: 6, bounds: {min: [-415,-415], max: [415,415]}},
};
zonesDatabase.loaded = true;

// 1) Harvestable: static sentinel must stay static, wrapped coordinates accepted,
//    full metadata refreshed and 100-unit resource retained by new default range.
window.harvestablesDatabase = {
  isLoaded: true,
  isValidResourceByTypeNumber: () => true,
  getResourceTypeFromTypeNumber: (n) => n <= 5 ? 'WOOD' : n <= 10 ? 'ROCK' : n <= 15 ? 'FIBER' : n <= 22 ? 'HIDE' : 'ORE',
};
window.mobsDatabase = {isLoaded: false, getResourceInfo: () => null, getMobInfo: () => null};
const harvest = new HarvestablesHandler();
harvest.newHarvestableObject(10, {5: 14, 6: -1, 7: 4, 8: {data:[100,0]}, 10: 2, 11: 0});
assert.equal(harvest.getSize(), 1);
assert.equal(harvest.getHarvestableList()[0].posX, 100);
harvest.removeNotInRange(0, 0);
assert.equal(harvest.getSize(), 1, '100-unit resource should survive default retention range');
harvest.UpdateHarvestable(10, 14, 5, 105, 1, 1, 3, -1);
const h = harvest.getHarvestableList()[0];
assert.deepEqual({tier:h.tier,posX:h.posX,posY:h.posY,charges:h.charges,size:h.size}, {tier:5,posX:105,posY:1,charges:1,size:3});
harvest.removeNotInRange(0, 0, 80);
assert.equal(harvest.getSize(), 0, 'explicit 80-unit range should evict 105-unit resource');

// 2) Event39 batch: Buffer-shaped positions accepted; truncated arrays rejected atomically.
const batch = new HarvestablesHandler();
batch.newSimpleHarvestableObject({0:[1,2],1:{data:[14,14]},2:{data:[4,5]},3:{data:[10,20,30,40]},4:{data:[2,3]}});
assert.equal(batch.getSize(), 2);
const invalidBatch = new HarvestablesHandler();
invalidBatch.newSimpleHarvestableObject({0:[1,2],1:{data:[14]},2:{data:[4,5]},3:{data:[10,20,30,40]},4:{data:[2,3]}});
assert.equal(invalidBatch.getSize(), 0);

// 3) Mist spawn: Dragonfire portal field, wrapped/valid position and enchant clamp.
const mobs = new MobsHandler();
const portalParams = {0: 77, 1: 116, 2: 255, 7: [-12.5, 22.25], 13: 1, 19: 0, 33: 'MISTS_SOLO_BLACK', 34: 9};
mobs.NewMobEvent(portalParams);
assert.equal(mobs.mistList.length, 1);
assert.equal(mobs.mistList[0].type, 0);
assert.equal(mobs.mistList[0].enchant, 4);
portalParams[7] = [-10, 20]; portalParams[34] = 2;
mobs.NewMobEvent(portalParams);
assert.equal(mobs.mistList.length, 1, 'duplicate Mist id should upsert, not duplicate');
assert.equal(mobs.mistList[0].enchant, 2);
assert.equal(mobs.mistList[0].posX, -10);

// 4) Player cache: hiding UI no longer loses detection state; display cap is independent.
localStorage.setItem('settingShowPlayers', 'false'); settingsSync.cache.clear();
const players = new PlayersHandler();
players.handleNewPlayerEvent(1, {1:'A',8:'',53:0,51:null,40:[],43:[]});
assert.equal(players.getSize(), 1);
localStorage.setItem('settingShowPlayers', 'true');
localStorage.setItem('settingMaxPlayersDisplay', '2'); settingsSync.cache.clear();
players.handleNewPlayerEvent(2, {1:'B',8:'',53:0,51:null,40:[],43:[]});
players.handleNewPlayerEvent(3, {1:'C',8:'',53:0,51:null,40:[],43:[]});
assert.equal(players.getSize(), 3);
assert.equal(players.getFilteredPlayers().length, 2);

// 5) MistsPlayerJoinedInfo: explicit originCluster must drive the override even if previous map is unknown.
const handlers = {
  playersHandler: {updateLocalPlayerPosition:noop,removePlayer:noop,handleNewPlayerEvent:noop,handleMountedPlayerEvent:noop,UpdatePlayerHealth:noop,UpdatePlayerLooseHealth:noop,updateItems:noop,updatePlayerFaction:noop},
  mobsHandler: {updateMistPosition:noop,updateMobPosition:noop,removeMist:noop,removeMob:noop,updateEnchantEvent:noop,NewMobEvent:noop,updateMobHealth:noop,updateMobHealthRegen:noop,updateMobHealthBulk:noop},
  harvestablesHandler: {newSimpleHarvestableObject:noop,newHarvestableObject:noop,HarvestUpdateEvent:noop,harvestFinished:noop},
  chestsHandler:{removeChest:noop,addChestEvent:noop}, dungeonsHandler:{removeDungeon:noop,dungeonEvent:noop},
  fishingHandler:{removeFish:noop,newFishEvent:noop,fishingEnd:noop}, wispCageHandler:{removeCage:noop,newCageEvent:noop,cageOpenedEvent:noop},
  mistsDungeonHandler:{removePortal:noop,addPortal:noop},
};
const map = {id:'UNKNOWN_PREVIOUS',hX:0,hY:0,isBZ:false};
EventRouter.reset();
EventRouter.init({handlers,map,radarRenderer:{setMap:noop,setLocalPlayerPosition:noop}});
EventRouter.onEvent({0:1,2:'@MISTS@test-v7',3:true,4:'0212',252:522});
assert.equal(map.id, '@MISTS@test-v7');
assert.equal(zonesDatabase.getZone('@MISTS@test-v7')?.originZoneId, '0212');
assert.equal(zonesDatabase.getPvpType('@MISTS@test-v7'), 'black');

// 6) Map asset resolver: numeric compound zones use their base image only.
const md = new MapDrawing();
md.getZoomLevel = () => 1;
let assetSeen = null;
md.DrawImageMap = (_ctx,_x,_y,id) => { assetSeen = id; };
md.draw({}, {id:'1234-5',hX:0,hY:0});
assert.equal(assetSeen, '1234');
md.draw({}, {id:'TNL-120',hX:0,hY:0});
assert.equal(assetSeen, 'TNL-120');

// 7) Experimental Mists defaults: useful passive Mists/cage detection works from a clean profile,
//    malformed positions are rejected and duplicate IDs are updated instead of duplicated.
for (const key of ['settingMistSolo','settingMistDuo','settingMistE0','settingMistE1','settingMistE2','settingMistE3','settingMistE4','settingCage']) {
  localStorage.removeItem(key);
}
settingsSync.cache.clear();
const dungeons = new DungeonsHandler();
dungeons.dungeonEvent({0:501,1:{data:[15,25]},9:7,16:'MISTS_SOLO_BLACK'});
assert.equal(dungeons.dungeonList.length, 1);
assert.equal(dungeons.dungeonList[0].enchant, 4);
dungeons.dungeonEvent({0:501,1:[20,30],9:2,16:'MISTS_SOLO_BLACK'});
assert.equal(dungeons.dungeonList.length, 1);
assert.equal(dungeons.dungeonList[0].posX, 20);
assert.equal(dungeons.dungeonList[0].enchant, 2);
dungeons.dungeonEvent({0:502,1:['bad',30],9:1,16:'MISTS_DUO_BLACK'});
assert.equal(dungeons.dungeonList.length, 1, 'invalid Mist dungeon coordinates must be rejected');

// Standard dungeon metadata in Parameters[3] must win over Mist fallback fields.
localStorage.setItem('settingDungeonCorrupted', 'true');
settingsSync.cache.clear();
dungeons.dungeonEvent({0:503,1:[1,2],3:'CORRUPTED_SOLO_NONLETHAL',9:0,16:'IRRELEVANT'});
assert.equal(dungeons.dungeonList.find(d => d.id === 503)?.drawName, 'corrupt');

const cages = new WispCageHandler();
cages.newCageEvent({0:601,2:{data:[5,6]},4:'MISTS_CAGE'});
assert.equal(cages.cages.length, 1);
cages.newCageEvent({0:601,2:[7,8],4:'MISTS_CAGE_UPDATED'});
assert.equal(cages.cages.length, 1);
assert.equal(cages.cages[0].posX, 7);
cages.newCageEvent({0:602,2:[Infinity,8],4:'BAD'});
assert.equal(cages.cages.length, 1, 'invalid cage coordinates must be rejected');

console.log('QA V7 smoke: 7 grupos OK');
