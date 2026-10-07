import {afterEach, describe, expect, test, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Buffer} from 'node:buffer';
import {updateCatalogs} from '../../../tools/update-ao-data.ts';

vi.mock('../../../tools/common', () => ({DownloadStatus: {SUCCESS: 'success'}, downloadFile: () => { throw new Error('Unexpected real network request'); }}));

const dirs = [];
afterEach(() => { vi.restoreAllMocks(); dirs.splice(0).forEach(dir => fs.rmSync(dir, {recursive: true, force: true})); });
const pin = '47e4f5aca4d30b7495afa5a625ce0d5795e32050';
const sources = {
    'items.json': JSON.stringify({items: {simpleitem: {'@uniquename': 'T1_FOO', '@itempower': '100'}}}),
    'formatted/items.txt': '2: T1_FOO : Example Item',
    'mobs.json': JSON.stringify({Mobs: {Mob: [{'@uniquename': 'T1_MOB', '@tier': '1'}]}}),
    'spells.json': JSON.stringify({spells: {activespell: {'@uniquename': 'TEST_SPELL'}}}),
    'harvestables.json': JSON.stringify({'AO-Harvestables': {Harvestable: {'@resource': 'WOOD', Tier: {'@tier': '1', '@item': 'T1_WOOD'}}}}),
    'cluster/world.json': JSON.stringify({world: {clusters: {cluster: [{'@id': '1', '@type': 'SAFEAREA'}]}}}),
};

describe('reproducible catalog updater', () => {
    test('downloads one immutable revision and publishes hashes after every catalog succeeds', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openradar-updater-'));
        dirs.push(directory);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const seen = [];
        const download = async url => {
            seen.push(url);
            const prefix = `https://raw.githubusercontent.com/ao-data/ao-bin-dumps/${pin}/`;
            if (!url.startsWith(prefix)) throw new Error('Unpinned source');
            const content = sources[url.slice(prefix.length)];
            if (content === undefined) throw new Error('Unknown source');
            return {status: 'success', buffer: Buffer.from(content)};
        };
        await updateCatalogs({ref: pin, outputDir: directory, download});
        expect(seen).toHaveLength(6);
        expect(JSON.parse(fs.readFileSync(path.join(directory, 'items.min.json'), 'utf8'))[2]).toEqual({n: 'T1_FOO', p: 100, t: 'simpleitem'});
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'source-manifest.json'), 'utf8'));
        expect(manifest.sources.map(source => source.path).sort()).toEqual(Object.keys(sources).sort());
        expect(manifest.outputs).toHaveLength(5);
        expect(manifest.ref).toBe(pin);
    });

    test('does not overwrite existing catalogs or a manifest when a later source fails', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openradar-updater-'));
        dirs.push(directory);
        fs.writeFileSync(path.join(directory, 'items.min.json'), 'old items');
        fs.writeFileSync(path.join(directory, 'source-manifest.json'), 'old manifest');
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const download = async url => {
            if (url.endsWith('/cluster/world.json')) return {status: 'fail', message: 'offline'};
            return {status: 'success', buffer: Buffer.from(sources[url.split(`/${pin}/`)[1]])};
        };
        await expect(updateCatalogs({ref: pin, outputDir: directory, download})).rejects.toThrow();
        expect(fs.readFileSync(path.join(directory, 'items.min.json'), 'utf8')).toBe('old items');
        expect(fs.readFileSync(path.join(directory, 'source-manifest.json'), 'utf8')).toBe('old manifest');
        expect(fs.readdirSync(directory).sort()).toEqual(['items.min.json', 'source-manifest.json']);
    });
});
