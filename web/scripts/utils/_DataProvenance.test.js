import {afterEach, describe, expect, test, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Buffer} from 'node:buffer';
import {createManifest, publishCatalog, resolveDataRef, sourceBase} from '../../../tools/data-provenance.ts';

const dirs = [];
afterEach(() => { vi.restoreAllMocks(); dirs.splice(0).forEach(dir => fs.rmSync(dir, {recursive: true, force: true})); });
function temporaryDirectory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openradar-provenance-')); dirs.push(dir); return dir; }

describe('catalog provenance', () => {
    test('pins the default download URL and validates explicit immutable revisions', () => {
        expect(sourceBase(resolveDataRef([]))).toBe('https://raw.githubusercontent.com/ao-data/ao-bin-dumps/47e4f5aca4d30b7495afa5a625ce0d5795e32050');
        expect(resolveDataRef(['--ref', 'A'.repeat(40)])).toBe('a'.repeat(40));
        for (const args of [['--ref', 'master'], ['--ref=../main'], ['--ref'], ['--ref', 'f'.repeat(39)], ['--ref', 'f'.repeat(40), '--ref', 'e'.repeat(40)]]) {
            expect(() => resolveDataRef(args)).toThrow();
        }
    });

    test('hashes the exact source and derived bytes with pinned source URLs', () => {
        const manifest = createManifest(resolveDataRef([]), {'items.json': Buffer.from('abc')}, {'items.min.json': Buffer.from('')});
        expect(manifest.sources[0]).toEqual({path: 'items.json', url: expect.stringContaining('/47e4f5aca4d30b7495afa5a625ce0d5795e32050/items.json'), bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'});
        expect(manifest.outputs[0]).toEqual({path: 'items.min.json', bytes: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'});
    });

    test('publishes the complete file set and manifest without replacing unrelated files', () => {
        const dir = temporaryDirectory();
        fs.writeFileSync(path.join(dir, 'unrelated.json'), 'unchanged');
        fs.writeFileSync(path.join(dir, 'items.min.json.gz'), 'stale compressed items');
        const outputs = {'items.min.json': Buffer.from('new items'), 'zones.json': Buffer.from('new zones')};
        const manifest = createManifest(resolveDataRef([]), {'items.json': Buffer.from('source')}, outputs);
        publishCatalog(dir, outputs, manifest);
        expect(fs.readFileSync(path.join(dir, 'items.min.json'), 'utf8')).toBe('new items');
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'source-manifest.json'), 'utf8'))).toEqual(manifest);
        expect(fs.readFileSync(path.join(dir, 'unrelated.json'), 'utf8')).toBe('unchanged');
        expect(fs.readdirSync(dir).sort()).toEqual(['items.min.json', 'source-manifest.json', 'unrelated.json', 'zones.json']);
    });

    test('restores prior files and manifest if publication fails midway', () => {
        const dir = temporaryDirectory();
        fs.writeFileSync(path.join(dir, 'items.min.json'), 'old items');
        fs.writeFileSync(path.join(dir, 'items.min.json.gz'), 'old compressed items');
        fs.writeFileSync(path.join(dir, 'zones.json'), 'old zones');
        fs.writeFileSync(path.join(dir, 'source-manifest.json'), 'old manifest');
        const outputs = {'items.min.json': Buffer.from('new items'), 'zones.json': Buffer.from('new zones')};
        const manifest = createManifest(resolveDataRef([]), {'items.json': Buffer.from('source')}, outputs);
        const rename = fs.renameSync;
        let failed = false;
        vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (!failed && String(from).endsWith('zones.json') && String(from).includes('staged') && String(to) === path.join(dir, 'zones.json')) { failed = true; throw new Error('disk failure'); }
            return rename(from, to);
        });
        expect(() => publishCatalog(dir, outputs, manifest)).toThrow('disk failure');
        expect(fs.readFileSync(path.join(dir, 'items.min.json'), 'utf8')).toBe('old items');
        expect(fs.readFileSync(path.join(dir, 'items.min.json.gz'), 'utf8')).toBe('old compressed items');
        expect(fs.readFileSync(path.join(dir, 'zones.json'), 'utf8')).toBe('old zones');
        expect(fs.readFileSync(path.join(dir, 'source-manifest.json'), 'utf8')).toBe('old manifest');
    });

    test('refuses simultaneous publication while another updater owns the lock', () => {
        const dir = temporaryDirectory();
        fs.writeFileSync(path.join(dir, '.catalog-update.lock'), 'owned');
        fs.writeFileSync(path.join(dir, 'items.min.json'), 'old items');
        const outputs = {'items.min.json': Buffer.from('new items')};
        const manifest = createManifest(resolveDataRef([]), {'items.json': Buffer.from('source')}, outputs);
        expect(() => publishCatalog(dir, outputs, manifest)).toThrow();
        expect(fs.readFileSync(path.join(dir, 'items.min.json'), 'utf8')).toBe('old items');
        expect(fs.readFileSync(path.join(dir, '.catalog-update.lock'), 'utf8')).toBe('owned');
    });
});
