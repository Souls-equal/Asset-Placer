/**
 * schematicLibraryLoader.js — Load user schematics from schematics/manifest.json.
 *
 * No automatic folder scanning is used anymore.
 * This is GitHub Pages friendly: every schematic is explicitly listed in the root manifest,
 * with optional metadata for future filtering (type, biome, categories, display name).
 *
 * Project layout is intentionally flat: JS/CSS/HTML are at the root, and the only folder is
 * `schematics/`, containing schematic files only. The manifest is therefore at root: manifest.json.
 *
 * Supported manifest shapes:
 *
 * 1) Recommended:
 * {
 *   "schematics": [
 *     { "file": "oak.bloxdschem", "name": "Oak Tree", "type": "tree", "biome": "classic" },
 *     { "file": "snow_cabin.bloxdschem", "type": ["house"], "biome": ["snow"] }
 *   ]
 * }
 *
 * 2) Legacy/simple:
 * { "files": ["house.bloxdschem", "tree.json"] }
 *
 * 3) Bare array:
 * ["house.bloxdschem", { "file": "tree.bloxdschem", "type": "tree" }]
 */

window.SchematicLibraryLoader = class SchematicLibraryLoader {
    constructor(scene, assetManager, libraryUI) {
        this.scene = scene;
        this.assetManager = assetManager;
        this.libraryUI = libraryUI;
        this.supportedExtensions = ['.bloxdschem', '.json', '.schem'];
        this.maxPreviewBlocks = 120000;
        this.manifestPath = 'manifest.json';
    }

    async loadFromProjectFolder() {
        const entries = await this._loadManifestEntries();
        if (!entries.length) {
            console.info('[SchematicLibrary] No schematics listed in schematics/manifest.json.');
            return 0;
        }

        console.info(`[SchematicLibrary] Loading ${entries.length} manifest schematic(s)...`, entries);
        let loaded = 0;

        for (const entry of entries) {
            try {
                const normalizedPath = this._normalizePath(entry.file || entry.path || entry.url || entry.src);
                if (!this._isSupported(normalizedPath)) {
                    console.warn(`[SchematicLibrary] Unsupported file skipped: ${normalizedPath}`);
                    continue;
                }

                const schem = await this._loadSchematic(normalizedPath);
                if (!schem || !schem.blocks || !schem.blocks.length) {
                    console.warn(`[SchematicLibrary] Empty schematic skipped: ${normalizedPath}`);
                    continue;
                }

                if (schem.blocks.length > this.maxPreviewBlocks) {
                    console.warn(
                        `[SchematicLibrary] ${normalizedPath} has ${schem.blocks.length.toLocaleString()} blocks. ` +
                        `It was loaded anyway, but very large assets can be slow in the current asset preview system.`
                    );
                }

                const baseName = entry.name || this._nameFromPath(normalizedPath);
                const uniqueName = this._makeUniqueTemplateName(baseName);
                const sourceMesh = window.createMeshFromSchem(this.scene, schem);
                if (!sourceMesh) {
                    console.warn(`[SchematicLibrary] Could not create preview mesh for: ${normalizedPath}`);
                    continue;
                }

                const meta = this._normalizeMetadata(entry, normalizedPath);
                this.assetManager.registerTemplate(uniqueName, sourceMesh, schem, meta);
                loaded++;

                if (this.libraryUI && typeof this.libraryUI.populateLibrary === 'function') {
                    this.libraryUI.populateLibrary();
                }

                await this._yieldToBrowser();
            } catch (err) {
                console.error(`[SchematicLibrary] Failed to load manifest entry:`, entry, err);
            }
        }

        console.info(`[SchematicLibrary] Loaded ${loaded}/${entries.length} user schematic(s).`);
        return loaded;
    }

    async _loadManifestEntries() {
        let data;
        try {
            const res = await fetch(this.manifestPath, { cache: 'no-store' });
            if (!res.ok) {
                console.warn(`[SchematicLibrary] Missing root manifest: ${this.manifestPath} (HTTP ${res.status})`);
                return [];
            }
            data = await res.json();
        } catch (err) {
            console.warn(`[SchematicLibrary] Could not read ${this.manifestPath}. Use a local server or GitHub Pages, not file://.`, err);
            return [];
        }

        const rawEntries = Array.isArray(data)
            ? data
            : (Array.isArray(data.schematics) ? data.schematics : (Array.isArray(data.files) ? data.files : []));

        const entries = rawEntries
            .map(item => typeof item === 'string' ? { file: item } : item)
            .filter(item => item && (item.file || item.path || item.url || item.src));

        const seen = new Set();
        const unique = [];
        for (const entry of entries) {
            const key = this._normalizePath(entry.file || entry.path || entry.url || entry.src).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(entry);
        }

        return unique;
    }

    _normalizeMetadata(entry, sourcePath) {
        const asArray = (value) => {
            if (value === undefined || value === null || value === '') return [];
            return Array.isArray(value) ? value.map(String).filter(Boolean) : [String(value)];
        };

        const type = asArray(entry.type || entry.types);
        const biome = asArray(entry.biome || entry.biomes);
        const categories = [
            ...asArray(entry.category || entry.categories),
            ...type.map(v => `type:${v}`),
            ...biome.map(v => `biome:${v}`)
        ];

        return {
            sourcePath,
            type,
            biome,
            categories,
            author: entry.author || '',
            description: entry.description || '',
            tags: asArray(entry.tags)
        };
    }

    _normalizePath(path) {
        let p = String(path || '').replace(/\\/g, '/').replace(/^\.\//, '');
        if (!p.startsWith('schematics/')) p = `schematics/${p}`;
        return p;
    }

    _isSupported(path) {
        const lower = path.toLowerCase();
        return this.supportedExtensions.some(ext => lower.endsWith(ext));
    }

    async _loadSchematic(path) {
        const lower = path.toLowerCase();

        if (lower.endsWith('.bloxdschem')) {
            if (!window.BloxdIO || typeof window.BloxdIO.parseSchem !== 'function') {
                throw new Error('BloxdIO parser is not loaded.');
            }
            const res = await fetch(path, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = await res.arrayBuffer();
            const parsed = window.BloxdIO.parseSchem(buffer);
            return this._convertBloxdSchemToBlockList(parsed);
        }

        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        return window.parseSchem(text);
    }

    _convertBloxdSchemToBlockList(parsed) {
        const blocks = [];
        const CHUNK = window.BloxdIO.CHUNK || 32;
        const AIR_ID = window.BloxdIO.AIR_ID || 0;

        parsed.blocks.forEach((arr, key) => {
            const [cx, cy, cz] = key.split(',').map(Number);
            const bx0 = cx * CHUNK;
            const by0 = cy * CHUNK;
            const bz0 = cz * CHUNK;

            for (let lx = 0; lx < CHUNK; lx++) {
                for (let ly = 0; ly < CHUNK; ly++) {
                    for (let lz = 0; lz < CHUNK; lz++) {
                        const id = arr[lx * 1024 + ly * 32 + lz];
                        if (id === AIR_ID) continue;
                        blocks.push({ x: bx0 + lx, y: by0 + ly, z: bz0 + lz, id, data: 0 });
                    }
                }
            }
        });

        return { size: parsed.size, blocks };
    }

    _nameFromPath(path) {
        const file = path.split('/').pop() || 'Schematic';
        return file.replace(/\.(bloxdschem|json|schem)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Schematic';
    }

    _makeUniqueTemplateName(baseName) {
        let name = baseName;
        let i = 2;
        while (this.assetManager.templates[name]) {
            name = `${baseName} ${i++}`;
        }
        return name;
    }

    _yieldToBrowser() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }
};
