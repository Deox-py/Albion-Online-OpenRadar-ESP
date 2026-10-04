import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const DEFAULT_DATA_REF = '47e4f5aca4d30b7495afa5a625ce0d5795e32050';
export const MANIFEST_NAME = 'source-manifest.json';

function validateRef(ref: string): string {
    if (!/^[a-fA-F0-9]{40}$/.test(ref)) throw new Error('Data ref must be an explicit 40-character Git commit SHA');
    return ref.toLowerCase();
}

export function resolveDataRef(args: string[]): string {
    let ref = DEFAULT_DATA_REF;
    let overridden = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--replace-existing') continue;
        let value: string | undefined;
        if (args[i] === '--ref') value = args[++i];
        else if (args[i].startsWith('--ref=')) value = args[i].slice(6);
        else throw new Error(`Unknown updater argument: ${args[i]}`);
        if (overridden || value === undefined) throw new Error('Supply --ref exactly once with a full commit SHA');
        ref = validateRef(value);
        overridden = true;
    }
    return ref;
}

export function sourceBase(ref: string): string {
    return `https://raw.githubusercontent.com/ao-data/ao-bin-dumps/${validateRef(ref)}`;
}

interface HashedFile {path: string; bytes: number; sha256: string;}
export interface DataManifest {
    schemaVersion: 1;
    repository: string;
    ref: string;
    generator: string;
    sources: (HashedFile & {url: string})[];
    outputs: HashedFile[];
}

function hashFile(name: string, bytes: Uint8Array): HashedFile {
    return {path: name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex')};
}

export function createManifest(ref: string, sources: Record<string, Uint8Array>, outputs: Record<string, Uint8Array>): DataManifest {
    const base = sourceBase(ref);
    return {
        schemaVersion: 1,
        repository: 'https://github.com/ao-data/ao-bin-dumps',
        ref: validateRef(ref),
        generator: 'tools/update-ao-data.ts',
        sources: Object.keys(sources).sort().map(name => ({...hashFile(name, sources[name]), url: `${base}/${name}`})),
        outputs: Object.keys(outputs).sort().map(name => hashFile(name, outputs[name])),
    };
}

// Stage the whole update before touching published files. Move the previous
// manifest away first and publish the new one last: an interrupted update never
// advertises a complete set of hashes for only partially replaced catalogs.
// Ordinary errors roll all files back. Preserve the recovery directory if
// rollback itself fails, so existing bytes remain recoverable.
export function publishCatalog(directory: string, outputs: Record<string, Uint8Array>, manifest: DataManifest): void {
    const target = path.resolve(directory);
    fs.mkdirSync(target, {recursive: true});
    const lockPath = path.join(target, '.catalog-update.lock');
    const lock = fs.openSync(lockPath, 'wx');
    try { publishUnlocked(target, outputs, manifest); }
    finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

function publishUnlocked(directory: string, outputs: Record<string, Uint8Array>, manifest: DataManifest): void {
    const names = Object.keys(outputs).sort();
    if (!names.length || names.some(name => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name === MANIFEST_NAME)) {
        throw new Error('Catalog output names must be plain filenames');
    }
    if (JSON.stringify(manifest.outputs) !== JSON.stringify(names.map(name => hashFile(name, outputs[name])))) {
        throw new Error('Manifest does not match catalog output bytes');
    }
    const target = path.resolve(directory);
    fs.mkdirSync(target, {recursive: true});
    // Old compressed variants would otherwise serve an earlier catalog even
    // after the JSON update. Remove them transactionally; compression is a
    // separate explicit step and can regenerate the new variants afterwards.
    const staleSidecars = [...names, MANIFEST_NAME].map(name => name + '.gz');
    const replaced = [MANIFEST_NAME, ...names, ...staleSidecars];
    for (const name of replaced) {
        const file = path.join(target, name);
        if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error(`Catalog target is not a regular file: ${file}`);
    }
    const parent = path.dirname(target);
    const transaction = fs.mkdtempSync(path.join(parent, '.openradar-staged-'));
    const backup = path.join(transaction, 'backup');
    const moved: string[] = [];
    const installed: string[] = [];
    let cleanable = false;
    try {
        fs.mkdirSync(backup);
        for (const name of names) fs.writeFileSync(path.join(transaction, name), outputs[name]);
        fs.writeFileSync(path.join(transaction, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n');
        for (const name of replaced) {
            if (fs.existsSync(path.join(target, name))) {
                fs.renameSync(path.join(target, name), path.join(backup, name));
                moved.push(name);
            }
        }
        for (const name of [...names, MANIFEST_NAME]) {
            fs.renameSync(path.join(transaction, name), path.join(target, name));
            installed.push(name);
        }
        cleanable = true;
    } catch (failure) {
        const recoveryErrors: unknown[] = [];
        for (const name of installed.reverse()) {
            try { fs.unlinkSync(path.join(target, name)); } catch (error) { recoveryErrors.push(error); }
        }
        for (const name of moved.filter(name => name !== MANIFEST_NAME)) {
            try { fs.renameSync(path.join(backup, name), path.join(target, name)); } catch (error) { recoveryErrors.push(error); }
        }
        if (!recoveryErrors.length && moved.includes(MANIFEST_NAME)) {
            try { fs.renameSync(path.join(backup, MANIFEST_NAME), path.join(target, MANIFEST_NAME)); } catch (error) { recoveryErrors.push(error); }
        }
        if (recoveryErrors.length) throw new AggregateError([failure, ...recoveryErrors], `Catalog rollback failed; recovery files: ${transaction}`, {cause: failure});
        cleanable = true;
        throw failure;
    } finally {
        if (cleanable && path.dirname(path.resolve(transaction)) === parent && path.basename(transaction).startsWith('.openradar-staged-')) {
            fs.rmSync(transaction, {recursive: true, force: true});
        }
    }
}
