import path from 'path';
import {pathToFileURL} from 'node:url';
import {downloadFile, DownloadStatus} from "./common";
import {createManifest, DEFAULT_DATA_REF, publishCatalog, resolveDataRef, sourceBase} from './data-provenance';

const OUTPUT_DIR = 'web/ao-bin-dumps';

interface UpdateContext {
    base: string;
    download: typeof downloadFile;
    sources: Record<string, Buffer>;
    outputs: Record<string, Buffer>;
}

async function downloadSource(ctx: UpdateContext, filename: string) {
    const result = await ctx.download(`${ctx.base}/${filename}`);
    if (result.status === DownloadStatus.SUCCESS && result.buffer) ctx.sources[filename] = Buffer.from(result.buffer);
    return result;
}

// Zone types and their PvP classification
type PvpType = 'safe' | 'yellow' | 'red' | 'black';

interface ZoneInfo {
    name: string;
    type: string;
    pvpType: PvpType;
    tier: number;
    file: string;
    bounds?: {min: [number, number], max: [number, number]};
}

// ============================================================================
// Minified Data Structures
// ============================================================================

/**
 * Minified item: { n: name, p: itempower }
 * Index in array = sequential ID (1-based in original, 0-based in minified)
 */
interface MinifiedItem {
    n: string;
    p: number;
    t?: string;
    cat?: string;
    slot?: string;
    h2?: boolean;
}

/**
 * Minified mob: { u: uniqueName, t: tier, c: category, n: namelocatag, l?: lootType, lt?: lootTier }
 * Index in array = typeId - MobsDatabase.OFFSET
 */
interface MinifiedMob {
    u: string;
    t: number;
    c?: string;
    n?: string;
    l?: string;
    lt?: number;
    fame?: number;
    hp?: number;
    avatar?: string;
    danger?: string;
}

/**
 * Minified spell: { n: uniqueName, i: uiSprite }
 * Index in array = sequential spell ID
 */
interface MinifiedSpell {
    n: string;  // uniqueName
    i?: string; // uiSprite (icon) - optional
    t?: string; // type (passivespell, activespell, togglespell)
}

/**
 * Minified harvestables with tier details
 */
interface HarvestableTier {
    tier: number;
    item: string;
    respawn: number;
    harvest: number;
    tool: boolean;
    maxcharges?: number;
    startcharges?: number;
    chargeup?: number;
}

type MinifiedHarvestables = Record<string, HarvestableTier[]>;

// ============================================================================
// Minification Functions
// ============================================================================

/**
 * items.txt is the canonical source of (numericId, uniqueName) pairs.
 * items.json only supplies metadata for a uniqueName.
 */
async function buildItemsArray(itemsJsonRaw: any, ctx: UpdateContext): Promise<(MinifiedItem | null)[]> {
    const metaByName = new Map<string, {itempower: number, type: string, cat?: string, slot?: string, h2?: boolean}>();
    const itemsRoot = itemsJsonRaw?.items;

    if (itemsRoot) {
        const itemTypes = [
            'hideoutitem', 'trackingitem', 'farmableitem', 'simpleitem',
            'consumableitem', 'consumablefrominventoryitem', 'equipmentitem',
            'weapon', 'mount', 'furnitureitem', 'journalitem', 'labourercontract',
            'mountskin', 'crystalleagueitem'
        ];

        for (const itemType of itemTypes) {
            if (!itemsRoot[itemType]) continue;
            const arr = Array.isArray(itemsRoot[itemType]) ? itemsRoot[itemType] : [itemsRoot[itemType]];

            for (const item of arr) {
                const uniqueName = item['@uniquename'];
                if (!uniqueName) continue;

                const baseMeta = {
                    itempower: parseInt(item['@itempower'] || '0') || 0,
                    type: itemType,
                    cat: item['@shopcategory'] || undefined,
                    slot: item['@slottype'] || undefined,
                    h2: item['@twohanded'] === 'true' ? true : undefined,
                };
                metaByName.set(uniqueName, baseMeta);

                if (item.enchantments?.enchantment) {
                    const encs = Array.isArray(item.enchantments.enchantment)
                        ? item.enchantments.enchantment
                        : [item.enchantments.enchantment];

                    for (const enchant of encs) {
                        const lvl = parseInt(enchant['@enchantmentlevel'] || '0') || 0;
                        const power = parseInt(enchant['@itempower'] || '0') || 0;
                        const enchName = `${uniqueName}@${lvl}`;
                        metaByName.set(enchName, {
                            ...baseMeta,
                            itempower: power || baseMeta.itempower,
                        });
                    }
                }
            }
        }
    }

    console.log(`📥 Downloading items.txt for canonical IDs...`);
    const txtRes = await downloadSource(ctx, 'formatted/items.txt');
    if (txtRes.status !== DownloadStatus.SUCCESS || !txtRes.buffer) {
        throw new Error(`Failed to download items.txt: ${txtRes.message}`);
    }
    const txtContent = txtRes.buffer.toString('utf-8');

    // Line format: "8952: T7_HEAD_PLATE_AVALON@2   : Avalonian Plate Helmet"
    const result: (MinifiedItem | null)[] = [];
    const lineRe = /^\s*(\d+)\s*:\s*([^\s:]+)/;

    for (const rawLine of txtContent.split(/\r?\n/)) {
        const m = rawLine.match(lineRe);
        if (!m) continue;
        const id = parseInt(m[1], 10);
        const uniqueName = m[2];

        while (result.length < id) result.push(null);

        const meta = metaByName.get(uniqueName);
        const minItem: MinifiedItem = {
            n: uniqueName,
            p: meta?.itempower ?? 0,
        };
        if (meta?.type) minItem.t = meta.type;
        if (meta?.cat) minItem.cat = meta.cat;
        if (meta?.slot) minItem.slot = meta.slot;
        if (meta?.h2) minItem.h2 = meta.h2;

        result[id] = minItem;
    }

    return result;
}

function minifyMobs(rawData: any): MinifiedMob[] {
    const mobs: MinifiedMob[] = [];
    const mobsRoot = rawData?.Mobs || rawData;
    const mobArray = mobsRoot?.Mob || mobsRoot?.Mobs?.Mob || [];

    if (!Array.isArray(mobArray)) return mobs;

    for (const mob of mobArray) {
        const uniqueName = mob['@uniquename'] || '';
        const tier = parseInt(mob['@tier']) || 0;
        const category = mob['@mobtypecategory'] || mob['@category'] || '';
        const namelocatag = mob['@namelocatag'] || '';

        const minMob: MinifiedMob = {
            u: uniqueName,
            t: tier
        };

        // Add category if present
        if (category) {
            minMob.c = category;
        }

        // Add namelocatag if present (useful for display)
        if (namelocatag) {
            minMob.n = namelocatag;
        }

        const fame = parseInt(mob['@fame']) || 0;
        if (fame > 0) minMob.fame = fame;

        const hp = parseInt(mob['@hitpointsmax']) || 0;
        if (hp > 0) minMob.hp = hp;

        if (mob['@avatar']) minMob.avatar = mob['@avatar'];
        if (mob['@dangerstate']) minMob.danger = mob['@dangerstate'];

        const harvestable = mob?.Loot?.Harvestable;
        if (harvestable) {
            const lootType = harvestable['@type'];
            const lootTier = parseInt(harvestable['@tier']) || tier;

            if (lootType) {
                minMob.l = lootType;
                minMob.lt = lootTier;
            }
        }

        mobs.push(minMob);
    }

    return mobs;
}

function minifySpells(rawData: any): MinifiedSpell[] {
    const spells: MinifiedSpell[] = [];
    const spellsRoot = rawData?.spells;
    if (!spellsRoot) return spells;

    // Process in order: passive, active, toggle (same order as SpellsDatabase)
    const spellTypes = ['passivespell', 'activespell', 'togglespell'];

    for (const spellType of spellTypes) {
        if (!spellsRoot[spellType]) continue;

        const typeSpells = Array.isArray(spellsRoot[spellType])
            ? spellsRoot[spellType]
            : [spellsRoot[spellType]];

        for (const spell of typeSpells) {
            const uniqueName = spell['@uniquename'];
            if (!uniqueName) continue;

            const minSpell: MinifiedSpell = {n: uniqueName, t: spellType};

            const uiSprite = spell['@uisprite'];
            if (uiSprite) {
                minSpell.i = uiSprite;
            }

            spells.push(minSpell);
        }
    }

    return spells;
}

function minifyHarvestables(rawData: any): MinifiedHarvestables {
    const result: MinifiedHarvestables = {};
    const aoHarvestables = rawData?.['AO-Harvestables'];
    if (!aoHarvestables?.Harvestable) return result;

    const harvestables = Array.isArray(aoHarvestables.Harvestable)
        ? aoHarvestables.Harvestable
        : [aoHarvestables.Harvestable];

    for (const harvestable of harvestables) {
        const resourceType = harvestable['@resource'];
        if (!resourceType) continue;

        if (!result[resourceType]) {
            result[resourceType] = [];
        }

        if (harvestable.Tier) {
            const tiers = Array.isArray(harvestable.Tier)
                ? harvestable.Tier
                : [harvestable.Tier];

            for (const tierData of tiers) {
                const tier = parseInt(tierData['@tier']);
                if (isNaN(tier)) continue;

                const tierEntry: HarvestableTier = {
                    tier,
                    item: tierData['@item'] || '',
                    respawn: parseInt(tierData['@respawntimeseconds']) || 0,
                    harvest: parseInt(tierData['@harvesttimeseconds']) || 0,
                    tool: tierData['@requirestool'] === 'true'
                };
                const maxcharges = parseInt(tierData['@maxchargesperharvest']);
                if (maxcharges > 0) tierEntry.maxcharges = maxcharges;
                const startcharges = parseInt(tierData['@startcharges']);
                if (startcharges > 0) tierEntry.startcharges = startcharges;
                const chargeup = parseFloat(tierData['@chargeupchance']);
                if (chargeup > 0) tierEntry.chargeup = chargeup;
                result[resourceType].push(tierEntry);
            }
        }
    }

    for (const key of Object.keys(result)) {
        result[key].sort((a, b) => a.tier - b.tier);
    }

    return result;
}

// ============================================================================
// Zone Processing (unchanged)
// ============================================================================

function getPvpType(type: string): PvpType {
    if (!type) return 'safe';
    const t = type.toUpperCase();

    // Safe zones (check first - exceptions)
    if (t.startsWith('PLAYERCITY_')) return 'safe';
    if (t.includes('ISLAND')) return 'safe';
    if (['HIDEOUT', 'TUNNEL_HIDEOUT', 'TUNNEL_HIDEOUT_DEEP'].includes(t)) return 'safe';
    if (['SAFEAREA', 'STARTAREA', 'STARTINGCITY', 'TUTORIAL',
        'PASSAGE_SAFEAREA', 'DUNGEON_SAFEAREA'].includes(t)) return 'safe';
    if (t.includes('EXPEDITION')) return 'safe';
    if (t.startsWith('ARENA_')) return 'safe';
    if (t === 'TUNNEL_ROYAL') return 'safe';

    // Red zones (check before black - TUNNEL_ROYAL_RED)
    if (t.includes('RED')) return 'red';

    // Yellow zones
    if (t.includes('YELLOW')) return 'yellow';
    if (t.includes('HELL') && t.includes('NON_LETHAL')) return 'yellow';

    // Black zones
    if (t.includes('BLACK')) return 'black';
    if (t.startsWith('TUNNEL_')) return 'black';  // Roads of Avalon
    if (t.includes('CORRUPTED_DUNGEON')) return 'black';
    if (t.includes('HELL') && t.includes('LETHAL')) return 'black';

    return 'safe';
}

function extractTier(file: string): number {
    if (!file) return 0;
    const tierMatch = file.match(/_T(\d+)_/);
    return tierMatch ? parseInt(tierMatch[1], 10) : 0;
}

async function processWorldJson(ctx: UpdateContext): Promise<{ success: boolean, zonesCount: number }> {
    console.log('\n📍 Processing world.json for zone data...');

    const res = await downloadSource(ctx, 'cluster/world.json');
    if (res.status !== DownloadStatus.SUCCESS || !res.buffer) {
        console.error(`❌ Failed to download world.json: ${res.message}`);
        return {success: false, zonesCount: 0};
    }

    console.log(`✅ Downloaded world.json (${res.size})`);

    try {
        const worldData = JSON.parse(res.buffer.toString('utf-8'));
        const clusters = worldData?.world?.clusters?.cluster || [];

        if (!Array.isArray(clusters)) {
            console.error('❌ Invalid world.json structure: clusters.cluster is not an array');
            return {success: false, zonesCount: 0};
        }

        const zones: Record<string, ZoneInfo> = {};

        for (const cluster of clusters) {
            const id = cluster['@id'];
            if (!id) continue;
            if (id.toLowerCase().includes('debug')) continue;

            const displayName = cluster['@displayname'] || id;
            const type = cluster['@type'] || '';
            const file = cluster['@file'] || '';
            const filename = file.replace('.cluster.xml', '');

            const zone: ZoneInfo = {
                name: displayName,
                type: type,
                pvpType: getPvpType(type),
                tier: extractTier(file),
                file: filename
            };

            const minAttr = cluster['@minimapBoundsMin'];
            const maxAttr = cluster['@minimapBoundsMax'];
            if (typeof minAttr === 'string' && typeof maxAttr === 'string') {
                const mins = minAttr.trim().split(/\s+/).map(parseFloat);
                const maxs = maxAttr.trim().split(/\s+/).map(parseFloat);
                if (
                    mins.length === 2 && maxs.length === 2 &&
                    mins.every(Number.isFinite) && maxs.every(Number.isFinite)
                ) {
                    zone.bounds = {min: [mins[0], mins[1]], max: [maxs[0], maxs[1]]};
                }
            }

            zones[id] = zone;
        }

        if (!Object.keys(zones).length) throw new Error('No zones in source');
        ctx.outputs['zones.json'] = Buffer.from(JSON.stringify(zones));
        console.log(`💾 Staged zones.json with ${Object.keys(zones).length} zones`);

        const pvpCounts = {safe: 0, yellow: 0, red: 0, black: 0};
        for (const zone of Object.values(zones)) {
            pvpCounts[zone.pvpType]++;
        }
        console.log(`   🛡️ Safe: ${pvpCounts.safe} | 🔶 Yellow: ${pvpCounts.yellow} | ⚔️ Red: ${pvpCounts.red} | 💀 Black: ${pvpCounts.black}`);

        return {success: true, zonesCount: Object.keys(zones).length};
    } catch (error) {
        console.error(`❌ Failed to parse world.json: ${error}`);
        return {success: false, zonesCount: 0};
    }
}

// ============================================================================
// Main Processing
// ============================================================================

interface ProcessResult {
    name: string;
    success: boolean;
    originalSize: number;
    minifiedSize: number;
    itemCount?: number;
}

async function downloadAndMinify<T>(
    ctx: UpdateContext,
    filename: string,
    minifyFn: (data: any) => T,
    outputFilename: string
): Promise<ProcessResult> {
    console.log(`\n📥 Downloading ${filename}...`);

    const res = await downloadSource(ctx, filename);
    if (res.status !== DownloadStatus.SUCCESS || !res.buffer) {
        console.error(`❌ Failed to download ${filename}: ${res.message}`);
        return {name: filename, success: false, originalSize: 0, minifiedSize: 0};
    }

    const originalSize = res.buffer.length;
    console.log(`✅ Downloaded ${filename} (${formatSize(originalSize)})`);

    try {
        const rawData = JSON.parse(res.buffer.toString('utf-8'));
        const minified = minifyFn(rawData);

        const minifiedJson = JSON.stringify(minified);

        const minifiedSize = Buffer.byteLength(minifiedJson);
        const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
        const count = Array.isArray(minified) ? minified.length : Object.keys(minified as object).length;
        if (!count) throw new Error(`No catalog entries in ${filename}`);
        ctx.outputs[outputFilename] = Buffer.from(minifiedJson);

        console.log(`💾 Staged ${outputFilename} (${formatSize(minifiedSize)}, -${reduction}%, ${count} entries)`);

        return {
            name: filename,
            success: true,
            originalSize,
            minifiedSize,
            itemCount: count
        };
    } catch (error) {
        console.error(`❌ Failed to process ${filename}: ${error}`);
        return {name: filename, success: false, originalSize, minifiedSize: 0};
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}


async function downloadAndMinifyItems(ctx: UpdateContext): Promise<ProcessResult> {
    console.log(`\n📥 Downloading items.json...`);
    const res = await downloadSource(ctx, 'items.json');
    if (res.status !== DownloadStatus.SUCCESS || !res.buffer) {
        console.error(`❌ Failed to download items.json: ${res.message}`);
        return {name: 'items.json', success: false, originalSize: 0, minifiedSize: 0};
    }
    const originalSize = res.buffer.length;
    console.log(`✅ Downloaded items.json (${formatSize(originalSize)})`);

    try {
        const rawData = JSON.parse(res.buffer.toString('utf-8'));
        const minified = await buildItemsArray(rawData, ctx);

        const minifiedJson = JSON.stringify(minified);

        const minifiedSize = Buffer.byteLength(minifiedJson);
        const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
        const nonNullCount = minified.filter(x => x !== null).length;
        if (!nonNullCount) throw new Error('No canonical item IDs in source');
        ctx.outputs['items.min.json'] = Buffer.from(minifiedJson);

        console.log(`💾 Staged items.min.json (${formatSize(minifiedSize)}, -${reduction}%, ${nonNullCount} non-null / ${minified.length} total slots)`);

        return {
            name: 'items.json',
            success: true,
            originalSize,
            minifiedSize,
            itemCount: nonNullCount,
        };
    } catch (error) {
        console.error(`❌ Failed to process items.json: ${error}`);
        return {name: 'items.json', success: false, originalSize, minifiedSize: 0};
    }
}

export async function updateCatalogs(options: {ref?: string; outputDir?: string; download?: typeof downloadFile} = {}): Promise<void> {
    const ref = options.ref ?? DEFAULT_DATA_REF;
    const ctx: UpdateContext = {base: sourceBase(ref), download: options.download ?? downloadFile, sources: {}, outputs: {}};
    const outputDir = options.outputDir ?? OUTPUT_DIR;
    console.log('Albion Online Data Updater');
    console.log('==========================');
    console.log('Downloading and minifying game data...\n');

    console.log(`Pinned source revision: ${ref}`);
    console.log('Files are staged in memory; catalogs and source-manifest.json are published only after all sources succeed.');

    const startTime = Date.now();
    const results: ProcessResult[] = [];

    // Process each data file with minification
    results.push(await downloadAndMinifyItems(ctx));
    results.push(await downloadAndMinify(ctx, 'mobs.json', minifyMobs, 'mobs.min.json'));
    results.push(await downloadAndMinify(ctx, 'spells.json', minifySpells, 'spells.min.json'));
    results.push(await downloadAndMinify(ctx, 'harvestables.json', minifyHarvestables, 'harvestables.min.json'));

    // Process zones
    const zonesResult = await processWorldJson(ctx);
    results.push({
        name: 'world.json',
        success: zonesResult.success,
        originalSize: 0,
        minifiedSize: 0,
        itemCount: zonesResult.zonesCount
    });

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary');
    console.log('='.repeat(60));

    let totalOriginal = 0;
    let totalMinified = 0;
    let successCount = 0;
    let failCount = 0;

    for (const r of results) {
        if (r.success) {
            successCount++;
            totalOriginal += r.originalSize;
            totalMinified += r.minifiedSize;
            if (r.originalSize > 0) {
                console.log(`   ✅ ${r.name}: ${formatSize(r.originalSize)} → ${formatSize(r.minifiedSize)} (${r.itemCount} entries)`);
            } else {
                console.log(`   ✅ ${r.name}: ${r.itemCount} entries`);
            }
        } else {
            failCount++;
            console.log(`   ❌ ${r.name}: FAILED`);
        }
    }

    if (totalOriginal > 0) {
        const reduction = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
        console.log(`\n   📦 Total: ${formatSize(totalOriginal)} → ${formatSize(totalMinified)} (${reduction}% reduction)`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n   ⏱️ Completed in ${elapsed}s`);
    console.log(`   ✅ Success: ${successCount} | ❌ Failed: ${failCount}`);

    console.log('\n💡 Note: localization.json and items.xml are fetched on-demand by icon download scripts');
    console.log('='.repeat(60) + '\n');

    if (failCount > 0) throw new Error(`Catalog update aborted: ${failCount} source files failed; published files were preserved`);
    publishCatalog(outputDir, ctx.outputs, createManifest(ref, ctx.sources, ctx.outputs));
    console.log(`Published catalogs and source-manifest.json to ${outputDir}`);
}

async function main(): Promise<void> {
    await updateCatalogs({ref: resolveDataRef(process.argv.slice(2))});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exitCode = 1;
});
