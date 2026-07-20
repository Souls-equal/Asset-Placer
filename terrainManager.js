/**
 * terrainManager.js — Import and render a terrain schematic used as the placement surface.
 *
 * v4.3 adds a large-terrain streaming mode:
 * - small terrains keep the full optimized block mesh;
 * - large terrains are imported as a tiled heightmap and rendered progressively around the camera.
 *
 * This avoids freezing/crashing the page when importing very large terrain schematics.
 */

window.TerrainManager = class TerrainManager {
    constructor(scene, groundMesh, gridMesh) {
        this.scene = scene;
        this.groundMesh = groundMesh || scene.getMeshByName('ground');
        this.gridMesh = gridMesh || scene.getMeshByName('grid');

        this.terrainMesh = null;            // full mode only
        this.terrainData = null;
        this.terrainBlocks = [];            // full mode only
        this.terrainPosition = new BABYLON.Vector3(0, 0, 0);
        this.terrainSelectionProxy = null;
        this.onChanged = null;

        this.mode = 'none';                 // 'none' | 'full' | 'heightmap'
        this.importToken = 0;

        // Large terrain streaming settings.
        this.largeAreaThreshold = 512 * 512;
        this.largeBlockThreshold = 350000;
        this.tileSize = 64;
        this.activeTileRadius = 5;          // 11x11 tiles around the camera, i.e. ~704x704 blocks visible.
        this.tileUnloadPadding = 2;
        this.maxTileBuildsPerFrame = 2;
        this.heightTiles = new Map();       // "tx,tz" -> tile
        this.tileMeshes = new Map();        // "tx,tz" -> BABYLON.Mesh
        this.tileBuildQueue = [];
        this.tileBuildQueued = new Set();
        this.isProcessingTileQueue = false;
        this.heightBounds = null;
        this._lastCameraTileKey = '';
        this._lastTileUpdateTime = 0;

        this._setupStreamingObserver();
    }

    _notifyChanged() {
        if (typeof this.onChanged === 'function') {
            this.onChanged(this.terrainData);
        }
    }

    hasTerrain() {
        return this.mode !== 'none';
    }

    async importTerrainFile(file) {
        if (!file) return null;
        const token = ++this.importToken;
        const extension = (file.name.split('.').pop() || '').toLowerCase();

        this.clearTerrain(false);
        this.importToken = token;
        console.log(`[Terrain] Import started: ${file.name}`);

        if (extension === 'bloxdschem') {
            const buffer = await file.arrayBuffer();
            if (token !== this.importToken) return null;

            const header = this._peekBloxdHeader(buffer);
            const area = Math.max(0, header.size.x) * Math.max(0, header.size.z);
            console.log(`[Terrain] Bloxd schematic header: ${header.size.x} x ${header.size.y} x ${header.size.z} (${area.toLocaleString()} columns)`);

            if (area > this.largeAreaThreshold) {
                return await this._importBloxdAsHeightmap(buffer, file.name, token, header);
            }

            if (!window.BloxdIO || typeof window.BloxdIO.parseSchem !== 'function') {
                throw new Error('BloxdIO parser is not loaded.');
            }
            const parsed = window.BloxdIO.parseSchem(buffer);
            const converted = this._convertBloxdSchemToBlockList(parsed);
            if (converted.blocks.length > this.largeBlockThreshold || converted.size.x * converted.size.z > this.largeAreaThreshold) {
                return await this._importBlockListAsHeightmap(converted, file.name, token);
            }
            return this.setTerrain(converted, file.name);
        }

        const text = await file.text();
        if (token !== this.importToken) return null;
        const parsed = window.parseSchem(text);
        const area = (parsed.size && parsed.size.x ? parsed.size.x : 0) * (parsed.size && parsed.size.z ? parsed.size.z : 0);
        if ((parsed.blocks && parsed.blocks.length > this.largeBlockThreshold) || area > this.largeAreaThreshold) {
            return await this._importBlockListAsHeightmap(parsed, file.name, token);
        }
        return this.setTerrain(parsed, file.name);
    }

    setTerrain(schem, fileName = 'Imported terrain') {
        if (!schem || !Array.isArray(schem.blocks) || schem.blocks.length === 0) {
            throw new Error('The terrain schematic is empty or invalid.');
        }

        this.clearTerrain(false);
        this.mode = 'full';

        const normalized = this._normalizeBlockList(schem.blocks, schem.size);
        this.terrainData = {
            name: fileName,
            mode: 'full',
            size: normalized.size,
            totalBlocks: normalized.blocks.length
        };
        this.terrainBlocks = normalized.blocks;

        const mesh = this._buildOptimizedTerrainMesh(normalized.blocks, normalized.size, fileName);

        this.terrainPosition.set(
            -Math.floor(normalized.size.x / 2),
            0,
            -Math.floor(normalized.size.z / 2)
        );
        mesh.position.copyFrom(this.terrainPosition);
        mesh.computeWorldMatrix(true);

        this.terrainMesh = mesh;
        this._updateTerrainSelectionProxy();
        this._setDefaultGroundVisible(false);
        this._notifyChanged();
        console.log(`[Terrain] Full terrain loaded: ${normalized.blocks.length.toLocaleString()} blocks.`);
        return this.terrainData;
    }

    clearTerrain(showDefaultGround = true) {
        this.importToken++;
        if (this.terrainMesh) {
            if (this.terrainMesh.material) this.terrainMesh.material.dispose();
            this.terrainMesh.dispose();
            this.terrainMesh = null;
        }
        for (const mesh of this.tileMeshes.values()) {
            if (mesh.material) mesh.material.dispose();
            mesh.dispose();
        }
        if (this.terrainSelectionProxy) {
            if (this.terrainSelectionProxy.material) this.terrainSelectionProxy.material.dispose();
            this.terrainSelectionProxy.dispose();
            this.terrainSelectionProxy = null;
        }
        this.tileMeshes.clear();
        this.tileBuildQueue = [];
        this.tileBuildQueued.clear();
        this.heightTiles.clear();
        this.heightBounds = null;
        this._lastCameraTileKey = '';

        this.mode = 'none';
        this.terrainData = null;
        this.terrainBlocks = [];
        this.terrainPosition.set(0, 0, 0);
        if (showDefaultGround) this._setDefaultGroundVisible(true);
        this._notifyChanged();
    }

    getExportBlocks() {
        if (this.mode === 'full') {
            const ox = Math.round(this.terrainPosition.x);
            const oy = Math.round(this.terrainPosition.y);
            const oz = Math.round(this.terrainPosition.z);
            return this.terrainBlocks.map(b => ({
                x: b.x + ox,
                y: b.y + oy,
                z: b.z + oz,
                id: b.id,
                data: b.data || 0,
                source: 'terrain'
            }));
        }

        if (this.mode === 'heightmap') {
            // Heightmap mode intentionally exports the surface blocks only.
            // This avoids allocating gigabytes of JSON for very large terrain volumes.
            const out = [];
            const ox = Math.round(this.terrainPosition.x);
            const oy = Math.round(this.terrainPosition.y);
            const oz = Math.round(this.terrainPosition.z);
            const NEG = this._negHeight();
            for (const tile of this.heightTiles.values()) {
                const baseX = tile.tx * this.tileSize;
                const baseZ = tile.tz * this.tileSize;
                for (let i = 0; i < tile.heights.length; i++) {
                    const h = tile.heights[i];
                    if (h === NEG) continue;
                    const lx = i % this.tileSize;
                    const lz = Math.floor(i / this.tileSize);
                    out.push({
                        x: baseX + lx + ox,
                        y: h + oy,
                        z: baseZ + lz + oz,
                        id: tile.ids[i] || 1,
                        data: 0,
                        source: 'terrain-heightmap'
                    });
                }
            }
            return out;
        }

        return [];
    }

    _setDefaultGroundVisible(visible) {
        if (this.groundMesh) {
            this.groundMesh.setEnabled(visible);
            this.groundMesh.isVisible = visible;
            this.groundMesh.isPickable = visible;
        }
        if (this.gridMesh) {
            this.gridMesh.setEnabled(visible);
            this.gridMesh.isVisible = visible;
            this.gridMesh.isPickable = false;
        }
    }

    _getTerrainCenterWorld() {
        if (this.mode === 'full' && this.terrainData && this.terrainData.size) {
            return new BABYLON.Vector3(
                this.terrainPosition.x + this.terrainData.size.x / 2,
                this.terrainPosition.y,
                this.terrainPosition.z + this.terrainData.size.z / 2
            );
        }

        if (this.mode === 'heightmap' && this.heightBounds) {
            return new BABYLON.Vector3(
                this.terrainPosition.x + (this.heightBounds.minX + this.heightBounds.maxX) / 2,
                this.terrainPosition.y,
                this.terrainPosition.z + (this.heightBounds.minZ + this.heightBounds.maxZ) / 2
            );
        }

        return this.terrainPosition.clone();
    }

    getTerrainFocusInfo() {
        if (!this.hasTerrain()) {
            const p = this.groundMesh ? this.groundMesh.position.clone() : BABYLON.Vector3.Zero();
            return {
                center: p.clone(),
                topCenter: p.add(new BABYLON.Vector3(0, 1, 0)),
                size: { x: 300, y: 1, z: 300 },
                maxY: p.y,
                minY: p.y
            };
        }

        if (this.mode === 'heightmap' && this.heightBounds) {
            const b = this.heightBounds;
            const center = new BABYLON.Vector3(
                this.terrainPosition.x + (b.minX + b.maxX) / 2,
                this.terrainPosition.y + (b.minY + b.maxY) / 2,
                this.terrainPosition.z + (b.minZ + b.maxZ) / 2
            );
            return {
                center,
                topCenter: new BABYLON.Vector3(center.x, this.terrainPosition.y + b.maxY + 1, center.z),
                size: { x: b.maxX - b.minX + 1, y: b.maxY - b.minY + 1, z: b.maxZ - b.minZ + 1 },
                maxY: this.terrainPosition.y + b.maxY,
                minY: this.terrainPosition.y + b.minY
            };
        }

        const size = this.terrainData && this.terrainData.size ? this.terrainData.size : { x: 300, y: 1, z: 300 };
        const center = new BABYLON.Vector3(
            this.terrainPosition.x + size.x / 2,
            this.terrainPosition.y + size.y / 2,
            this.terrainPosition.z + size.z / 2
        );
        return {
            center,
            topCenter: new BABYLON.Vector3(center.x, this.terrainPosition.y + size.y, center.z),
            size,
            maxY: this.terrainPosition.y + size.y,
            minY: this.terrainPosition.y
        };
    }

    _updateTerrainSelectionProxy() {
        if (!this.hasTerrain()) return;

        if (!this.terrainSelectionProxy) {
            this.terrainSelectionProxy = BABYLON.MeshBuilder.CreateBox('terrain_selection_proxy', { size: 1 }, this.scene);
            this.terrainSelectionProxy.id = 'terrain_selection_proxy';
            this.terrainSelectionProxy.isPickable = false;
            this.terrainSelectionProxy.metadata = { isTerrainSelectionProxy: true };

            const mat = new BABYLON.StandardMaterial('terrainSelectionProxyMat', this.scene);
            mat.alpha = 0;
            mat.disableLighting = true;
            this.terrainSelectionProxy.material = mat;
            this.terrainSelectionProxy.visibility = 0;
        }

        this.terrainSelectionProxy.setEnabled(true);
        this.terrainSelectionProxy.position.copyFrom(this._getTerrainCenterWorld());
        this.terrainSelectionProxy.computeWorldMatrix(true);
    }

    setTerrainCenterPosition(x, y, z) {
        if (!this.hasTerrain()) return;

        this._updateTerrainSelectionProxy();
        if (!this.terrainSelectionProxy) return;

        const oldCenter = this.terrainSelectionProxy.position.clone();
        const newCenter = new BABYLON.Vector3(x, y, z);
        const delta = newCenter.subtract(oldCenter);
        if (delta.lengthSquared() < 0.000001) return;

        this.terrainPosition.addInPlace(delta);
        if (this.terrainMesh) {
            this.terrainMesh.position.copyFrom(this.terrainPosition);
            this.terrainMesh.computeWorldMatrix(true);
        }
        for (const mesh of this.tileMeshes.values()) {
            mesh.position.copyFrom(this.terrainPosition);
            mesh.computeWorldMatrix(true);
        }
        this.terrainSelectionProxy.position.copyFrom(newCenter);
        this.terrainSelectionProxy.computeWorldMatrix(true);
        this._notifyChanged();
    }

    getSelectionObject() {
        const manager = this;

        if (!this.hasTerrain()) {
            if (!this.groundMesh) return null;
            return {
                id: 'ground',
                name: 'Ground',
                displayName: 'Ground',
                isTerrainSelection: true,
                isDefaultGroundSelection: true,
                mesh: this.groundMesh,
                _position: this.groundMesh.position.clone(),
                get position() { return this._position; },
                rotationY: 0,
                setPosition(x, y, z) {
                    const p = new BABYLON.Vector3(x, y, z);
                    if (manager.groundMesh.position.subtract(p).lengthSquared() < 0.000001) return;
                    manager.groundMesh.position.copyFrom(p);
                    manager.groundMesh.computeWorldMatrix(true);
                    if (manager.gridMesh) {
                        manager.gridMesh.position.set(p.x, p.y + 0.01, p.z);
                        manager.gridMesh.computeWorldMatrix(true);
                    }
                    this._position.copyFrom(p);
                    manager._notifyChanged();
                },
                setRotation() {},
                syncFromMesh() {
                    this.setPosition(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);
                }
            };
        }

        this._updateTerrainSelectionProxy();
        return {
            id: 'terrain',
            name: this.terrainData && this.terrainData.name ? this.terrainData.name : 'Ground',
            displayName: this.terrainData ? 'Terrain' : 'Ground',
            isTerrainSelection: true,
            mesh: this.terrainSelectionProxy,
            _position: this.terrainSelectionProxy.position.clone(),
            get position() { return this._position; },
            rotationY: 0,
            setPosition(x, y, z) {
                manager.setTerrainCenterPosition(x, y, z);
                this._position.copyFrom(manager.terrainSelectionProxy.position);
            },
            setRotation() {},
            syncFromMesh() {
                manager.setTerrainCenterPosition(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);
                this._position.copyFrom(manager.terrainSelectionProxy.position);
            }
        };
    }

    _setupStreamingObserver() {
        this.scene.onBeforeRenderObservable.add(() => {
            if (this.mode !== 'heightmap') return;
            const now = performance.now();
            if (now - this._lastTileUpdateTime < 250) return;
            this._lastTileUpdateTime = now;
            this._updateActiveHeightTiles(false);
        });
    }

    _negHeight() {
        return -2147483648;
    }

    _floorDiv(a, b) {
        return Math.floor(a / b);
    }

    _mod(a, b) {
        return ((a % b) + b) % b;
    }

    _tileKey(tx, tz) {
        return `${tx},${tz}`;
    }

    _createHeightTile(tx, tz) {
        const key = this._tileKey(tx, tz);
        let tile = this.heightTiles.get(key);
        if (tile) return tile;
        const count = this.tileSize * this.tileSize;
        tile = {
            tx,
            tz,
            heights: new Int32Array(count),
            ids: new Int32Array(count),
            filled: 0
        };
        tile.heights.fill(this._negHeight());
        this.heightTiles.set(key, tile);
        return tile;
    }

    _updateHeightColumn(x, y, z, id) {
        const tx = this._floorDiv(x, this.tileSize);
        const tz = this._floorDiv(z, this.tileSize);
        const lx = this._mod(x, this.tileSize);
        const lz = this._mod(z, this.tileSize);
        const tile = this._createHeightTile(tx, tz);
        const idx = lz * this.tileSize + lx;
        const NEG = this._negHeight();
        if (tile.heights[idx] === NEG) tile.filled++;
        if (y >= tile.heights[idx]) {
            tile.heights[idx] = y;
            tile.ids[idx] = id;
        }

        if (!this.heightBounds) {
            this.heightBounds = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z, columns: 0 };
        } else {
            if (x < this.heightBounds.minX) this.heightBounds.minX = x;
            if (x > this.heightBounds.maxX) this.heightBounds.maxX = x;
            if (y < this.heightBounds.minY) this.heightBounds.minY = y;
            if (y > this.heightBounds.maxY) this.heightBounds.maxY = y;
            if (z < this.heightBounds.minZ) this.heightBounds.minZ = z;
            if (z > this.heightBounds.maxZ) this.heightBounds.maxZ = z;
        }
    }

    _recountHeightColumns() {
        let columns = 0;
        for (const tile of this.heightTiles.values()) columns += tile.filled;
        if (this.heightBounds) this.heightBounds.columns = columns;
        return columns;
    }

    async _importBlockListAsHeightmap(schem, fileName, token) {
        this.clearTerrain(false);
        this.importToken = token;
        this.mode = 'heightmap';
        this._setDefaultGroundVisible(false);

        const blocks = Array.isArray(schem.blocks) ? schem.blocks : [];
        const batch = 50000;
        for (let i = 0; i < blocks.length; i++) {
            if (token !== this.importToken) return null;
            const b = blocks[i];
            if (b && b.id !== 0) {
                this._updateHeightColumn(Math.round(b.x || 0), Math.round(b.y || 0), Math.round(b.z || 0), b.id || 1);
            }
            if (i % batch === 0) {
                console.log(`[Terrain] Heightmap import: ${Math.round((i / Math.max(1, blocks.length)) * 100)}%`);
                await this._yieldToBrowser();
            }
        }

        return this._finalizeHeightmapTerrain(fileName, token);
    }

    async _importBloxdAsHeightmap(buffer, fileName, token, knownHeader = null) {
        this.clearTerrain(false);
        this.importToken = token;
        this.mode = 'heightmap';
        this._setDefaultGroundVisible(false);

        const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const off = { value: 0 };

        for (let i = 0; i < 4; i++) off.value++;
        const name = this._readAvroString(buf, off);
        const px = this._readAvroInt(buf, off);
        const py = this._readAvroInt(buf, off);
        const pz = this._readAvroInt(buf, off);
        const sx = this._readAvroInt(buf, off);
        const sy = this._readAvroInt(buf, off);
        const sz = this._readAvroInt(buf, off);

        console.log(`[Terrain] Large heightmap mode: ${name || fileName} (${sx} x ${sy} x ${sz})`);

        let chunkIndex = 0;
        while (true) {
            if (token !== this.importToken) return null;
            let blockCount = this._readAvroInt(buf, off);
            if (blockCount === 0) break;
            if (blockCount < 0) {
                blockCount = -blockCount;
                this._readAvroInt(buf, off); // byte count
            }
            for (let i = 0; i < blockCount; i++) {
                const cx = this._readAvroInt(buf, off);
                const cy = this._readAvroInt(buf, off);
                const cz = this._readAvroInt(buf, off);
                const rle = this._readAvroBytesView(buf, off);
                this._decodeChunkRLEToHeightmap(rle, px + cx * 32, py + cy * 32, pz + cz * 32);
                chunkIndex++;
                if (chunkIndex % 16 === 0) {
                    console.log(`[Terrain] Decoded ${chunkIndex.toLocaleString()} chunks...`);
                    await this._yieldToBrowser();
                }
            }
        }

        return this._finalizeHeightmapTerrain(fileName, token);
    }

    _finalizeHeightmapTerrain(fileName, token) {
        if (token !== this.importToken) return null;
        const columns = this._recountHeightColumns();
        if (!this.heightBounds || columns === 0) {
            throw new Error('The imported terrain contains no visible columns.');
        }

        const b = this.heightBounds;
        const size = {
            x: b.maxX - b.minX + 1,
            y: b.maxY - b.minY + 1,
            z: b.maxZ - b.minZ + 1
        };

        this.terrainPosition.set(
            -Math.floor((b.minX + b.maxX) / 2),
            0,
            -Math.floor((b.minZ + b.maxZ) / 2)
        );

        this.terrainData = {
            name: fileName,
            mode: 'heightmap-streaming',
            size,
            totalColumns: columns,
            tileSize: this.tileSize,
            activeTileRadius: this.activeTileRadius
        };

        this._updateTerrainSelectionProxy();
        this._notifyChanged();
        console.log(`[Terrain] Heightmap terrain ready: ${columns.toLocaleString()} columns, ${this.heightTiles.size.toLocaleString()} tiles.`);
        this._updateActiveHeightTiles(true);
        return this.terrainData;
    }

    _updateActiveHeightTiles(force) {
        if (!this.heightBounds) return;
        const camera = this.scene.activeCamera;
        if (!camera) return;

        const localX = camera.position.x - this.terrainPosition.x;
        const localZ = camera.position.z - this.terrainPosition.z;
        const ctx = this._floorDiv(localX, this.tileSize);
        const ctz = this._floorDiv(localZ, this.tileSize);
        const camKey = this._tileKey(ctx, ctz);
        if (!force && camKey === this._lastCameraTileKey) return;
        this._lastCameraTileKey = camKey;

        const desired = new Set();
        for (let dz = -this.activeTileRadius; dz <= this.activeTileRadius; dz++) {
            for (let dx = -this.activeTileRadius; dx <= this.activeTileRadius; dx++) {
                const tx = ctx + dx;
                const tz = ctz + dz;
                const key = this._tileKey(tx, tz);
                if (this.heightTiles.has(key)) {
                    desired.add(key);
                    if (!this.tileMeshes.has(key) && !this.tileBuildQueued.has(key)) {
                        this.tileBuildQueue.push(key);
                        this.tileBuildQueued.add(key);
                    }
                }
            }
        }

        const unloadRadius = this.activeTileRadius + this.tileUnloadPadding;
        for (const [key, mesh] of Array.from(this.tileMeshes.entries())) {
            const [tx, tz] = key.split(',').map(Number);
            if (Math.abs(tx - ctx) > unloadRadius || Math.abs(tz - ctz) > unloadRadius) {
                if (mesh.material) mesh.material.dispose();
                mesh.dispose();
                this.tileMeshes.delete(key);
            }
        }

        this._processTileBuildQueue();
    }

    async _processTileBuildQueue() {
        if (this.isProcessingTileQueue) return;
        this.isProcessingTileQueue = true;
        try {
            while (this.tileBuildQueue.length > 0 && this.mode === 'heightmap') {
                for (let i = 0; i < this.maxTileBuildsPerFrame && this.tileBuildQueue.length > 0; i++) {
                    const key = this.tileBuildQueue.shift();
                    this.tileBuildQueued.delete(key);
                    if (this.tileMeshes.has(key)) continue;
                    const tile = this.heightTiles.get(key);
                    if (!tile) continue;
                    const mesh = this._buildHeightTileMesh(tile, key);
                    if (mesh) this.tileMeshes.set(key, mesh);
                }
                await this._yieldToBrowser();
            }
        } finally {
            this.isProcessingTileQueue = false;
        }
    }

    _getHeightAtLocal(x, z) {
        const tx = this._floorDiv(x, this.tileSize);
        const tz = this._floorDiv(z, this.tileSize);
        const tile = this.heightTiles.get(this._tileKey(tx, tz));
        if (!tile) return this._negHeight();
        const lx = this._mod(x, this.tileSize);
        const lz = this._mod(z, this.tileSize);
        return tile.heights[lz * this.tileSize + lx];
    }

    _buildHeightTileMesh(tile, key) {
        if (!tile || tile.filled === 0) return null;
        const positions = [];
        const indices = [];
        const normals = [];
        const colors = [];
        let vertexOffset = 0;
        const NEG = this._negHeight();
        const baseX = tile.tx * this.tileSize;
        const baseZ = tile.tz * this.tileSize;

        const addQuad = (corners, normal, color) => {
            const shaded = this._shadeColor(color, normal);
            for (const c of corners) {
                positions.push(c[0], c[1], c[2]);
                normals.push(normal[0], normal[1], normal[2]);
                colors.push(shaded.r, shaded.g, shaded.b, 1);
            }
            indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3);
            vertexOffset += 4;
        };

        for (let lz = 0; lz < this.tileSize; lz++) {
            for (let lx = 0; lx < this.tileSize; lx++) {
                const idx = lz * this.tileSize + lx;
                const h = tile.heights[idx];
                if (h === NEG) continue;
                const id = tile.ids[idx] || 1;
                const x = baseX + lx;
                const z = baseZ + lz;
                const yTop = h + 1; // top surface of the highest block
                const color = this._getBlockColor01(id);

                // Top face.
                addQuad(
                    [[x, yTop, z], [x + 1, yTop, z], [x + 1, yTop, z + 1], [x, yTop, z + 1]],
                    [0, 1, 0],
                    color
                );

                // Heightmap side faces: if a neighbor column is lower, add a single vertical face.
                // This keeps cliffs and terrain edges visible without generating every hidden voxel face.
                const neighbors = [
                    { dx: 1, dz: 0, normal: [1, 0, 0], corners: (y0, y1) => [[x + 1, y0, z], [x + 1, y1, z], [x + 1, y1, z + 1], [x + 1, y0, z + 1]] },
                    { dx: -1, dz: 0, normal: [-1, 0, 0], corners: (y0, y1) => [[x, y0, z + 1], [x, y1, z + 1], [x, y1, z], [x, y0, z]] },
                    { dx: 0, dz: 1, normal: [0, 0, 1], corners: (y0, y1) => [[x + 1, y0, z + 1], [x + 1, y1, z + 1], [x, y1, z + 1], [x, y0, z + 1]] },
                    { dx: 0, dz: -1, normal: [0, 0, -1], corners: (y0, y1) => [[x, y0, z], [x, y1, z], [x + 1, y1, z], [x + 1, y0, z]] }
                ];

                for (const n of neighbors) {
                    const nh = this._getHeightAtLocal(x + n.dx, z + n.dz);
                    if (nh >= h) continue;
                    const yLow = nh === NEG ? h : nh + 1;
                    const yHigh = h + 1;
                    if (yHigh <= yLow) continue;
                    addQuad(n.corners(yLow, yHigh), n.normal, color);
                }
            }
        }

        if (positions.length === 0) return null;

        const mesh = new BABYLON.Mesh(`terrain_tile_${key}`, this.scene);
        mesh.metadata = { isTerrain: true, isTerrainTile: true, key, mode: 'heightmap' };
        mesh.isPickable = true;
        mesh.position.copyFrom(this.terrainPosition);

        const vertexData = new BABYLON.VertexData();
        vertexData.positions = new Float32Array(positions);
        vertexData.indices = positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
        vertexData.normals = new Float32Array(normals);
        vertexData.colors = new Float32Array(colors);
        vertexData.applyToMesh(mesh);

        const material = new BABYLON.StandardMaterial(`terrainTileMat_${key}`, this.scene);
        material.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
        material.useVertexColors = true;

        // Terrain preview is intentionally unlit: this removes the fake/over-dark shadow look
        // on huge imported maps while preserving the actual block colors.
        material.disableLighting = true;
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        material.backFaceCulling = false;
        if ('twoSidedLighting' in material) material.twoSidedLighting = true;
        mesh.material = material;
        try {
            mesh.enableEdgesRendering();
            mesh.edgesWidth = 0.55;
            mesh.edgesColor = new BABYLON.Color4(0, 0, 0, 0.38);
        } catch (err) {
            // Edges are only a visual aid; never block terrain loading.
        }
        mesh.computeWorldMatrix(true);
        return mesh;
    }

    _yieldToBrowser() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    _peekBloxdHeader(buffer) {
        const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const off = { value: 0 };
        for (let i = 0; i < 4; i++) off.value++;
        const name = this._readAvroString(buf, off);
        const px = this._readAvroInt(buf, off);
        const py = this._readAvroInt(buf, off);
        const pz = this._readAvroInt(buf, off);
        const sx = this._readAvroInt(buf, off);
        const sy = this._readAvroInt(buf, off);
        const sz = this._readAvroInt(buf, off);
        return { name, pos: { x: px, y: py, z: pz }, size: { x: sx, y: sy, z: sz } };
    }

    _readUvarint(buf, off) {
        let x = 0;
        let s = 0;
        for (let i = 0; i < 10; i++) {
            if (off.value >= buf.length) throw new Error('Unexpected end of buffer while reading varint.');
            const b = buf[off.value++];
            if (b < 0x80) return x + b * Math.pow(2, s);
            x += (b & 0x7f) * Math.pow(2, s);
            s += 7;
        }
        throw new Error('Varint is too long.');
    }

    _readAvroInt(buf, off) {
        const zz = this._readUvarint(buf, off);
        return (zz % 2 === 0) ? (zz / 2) : (-(zz + 1) / 2);
    }

    _readAvroString(buf, off) {
        const len = this._readAvroInt(buf, off);
        if (len < 0 || off.value + len > buf.length) throw new Error('Invalid Avro string length.');
        const bytes = buf.subarray(off.value, off.value + len);
        off.value += len;
        return new TextDecoder('utf-8').decode(bytes);
    }

    _readAvroBytesView(buf, off) {
        const len = this._readAvroInt(buf, off);
        if (len < 0 || off.value + len > buf.length) throw new Error('Invalid Avro bytes length.');
        const bytes = buf.subarray(off.value, off.value + len);
        off.value += len;
        return bytes;
    }

    _decodeChunkRLEToHeightmap(rleBytes, bx0, by0, bz0) {
        const off = { value: 0 };
        let cell = 0;
        while (cell < 32768 && off.value < rleBytes.length) {
            const count = this._readUvarint(rleBytes, off);
            const id = this._readUvarint(rleBytes, off);
            if (id === 0) {
                cell += count;
                continue;
            }

            // Very common case for terrain internals: a whole 32³ chunk is the same solid block.
            // For heightmap rendering we only need the top block of each X/Z column, so update
            // 1024 columns instead of iterating 32768 cells.
            if (cell === 0 && count >= 32768) {
                const topY = by0 + 31;
                for (let lx = 0; lx < 32; lx++) {
                    for (let lz = 0; lz < 32; lz++) {
                        this._updateHeightColumn(bx0 + lx, topY, bz0 + lz, id);
                    }
                }
                cell += count;
                continue;
            }

            for (let k = 0; k < count && cell < 32768; k++, cell++) {
                const lx = Math.floor(cell / 1024);
                const rem = cell - lx * 1024;
                const ly = Math.floor(rem / 32);
                const lz = rem - ly * 32;
                this._updateHeightColumn(bx0 + lx, by0 + ly, bz0 + lz, id);
            }
        }
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

    _normalizeBlockList(blocks, inputSize) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        const cleanBlocks = [];

        for (const raw of blocks) {
            if (!raw || raw.id === 0) continue;
            const x = Math.round(raw.x || 0);
            const y = Math.round(raw.y || 0);
            const z = Math.round(raw.z || 0);
            const id = raw.id;
            const data = raw.data || 0;

            cleanBlocks.push({ x, y, z, id, data });
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }

        if (cleanBlocks.length === 0) return { size: { x: 0, y: 0, z: 0 }, blocks: [] };

        const normalized = cleanBlocks.map(b => ({ x: b.x - minX, y: b.y - minY, z: b.z - minZ, id: b.id, data: b.data }));
        const computedSize = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 };
        return { size: computedSize, blocks: normalized };
    }

    _buildOptimizedTerrainMesh(blocks, size, fileName) {
        const occupancy = new Map();
        for (const b of blocks) occupancy.set(`${b.x},${b.y},${b.z}`, b.id);

        const positions = [];
        const indices = [];
        const normals = [];
        const colors = [];
        let vertexOffset = 0;

        const faces = [
            { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], nb: [1, 0, 0] },
            { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], nb: [-1, 0, 0] },
            { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], nb: [0, 1, 0] },
            { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], nb: [0, -1, 0] },
            { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], nb: [0, 0, 1] },
            { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], nb: [0, 0, -1] }
        ];

        for (const block of blocks) {
            for (const face of faces) {
                const nx = block.x + face.nb[0];
                const ny = block.y + face.nb[1];
                const nz = block.z + face.nb[2];
                if (occupancy.has(`${nx},${ny},${nz}`)) continue;

                const color = this._shadeColor(this._getBlockColor01(block.id), face.n);
                for (const corner of face.c) {
                    positions.push(block.x + corner[0], block.y + corner[1], block.z + corner[2]);
                    normals.push(face.n[0], face.n[1], face.n[2]);
                    colors.push(color.r, color.g, color.b, 1);
                }
                indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3);
                vertexOffset += 4;
            }
        }

        const mesh = new BABYLON.Mesh('terrain', this.scene);
        mesh.id = 'terrain';
        mesh.metadata = { isTerrain: true, sourceFile: fileName, size, totalBlocks: blocks.length, mode: 'full' };
        mesh.isPickable = true;

        const vertexData = new BABYLON.VertexData();
        vertexData.positions = new Float32Array(positions);
        vertexData.indices = positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
        vertexData.normals = new Float32Array(normals);
        vertexData.colors = new Float32Array(colors);
        vertexData.applyToMesh(mesh);

        const material = new BABYLON.StandardMaterial('terrainMat', this.scene);
        material.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
        material.useVertexColors = true;

        // Same unlit preview for full terrain mode: avoids harsh black faces/shadow artifacts.
        material.disableLighting = true;
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        material.backFaceCulling = false;
        if ('twoSidedLighting' in material) material.twoSidedLighting = true;
        mesh.material = material;
        try {
            mesh.enableEdgesRendering();
            mesh.edgesWidth = 0.55;
            mesh.edgesColor = new BABYLON.Color4(0, 0, 0, 0.38);
        } catch (err) {
            // Edges are only a visual aid; never block terrain loading.
        }
        return mesh;
    }

    _shadeColor(color, normal) {
        // Editor preview shading: keep terrain unlit globally, but add a small deterministic
        // per-face tint so block heights/edges remain readable without harsh black shadows.
        let factor = 1.0;
        if (normal[1] > 0.5) factor = 1.08;          // top faces a bit brighter
        else if (normal[1] < -0.5) factor = 0.72;    // undersides darker
        else if (normal[0] > 0.5) factor = 0.86;
        else if (normal[0] < -0.5) factor = 0.78;
        else if (normal[2] > 0.5) factor = 0.82;
        else if (normal[2] < -0.5) factor = 0.74;

        return {
            r: Math.min(1, Math.max(0.08, color.r * factor)),
            g: Math.min(1, Math.max(0.08, color.g * factor)),
            b: Math.min(1, Math.max(0.08, color.b * factor))
        };
    }

    _getBlockColor01(id) {
        let r, g, b;

        if (window.BloxdIO && typeof window.BloxdIO.getBlockColor === 'function') {
            let hex = window.BloxdIO.getBlockColor(id);

            // Some palettes map common terrain IDs to almost black colors. In the editor preview,
            // that reads as broken shadows rather than a useful block color. Keep the hue when
            // possible, but lift very dark colors to an inspectable gray.
            if (id === 1 && hex === 0x111111) hex = 0x8a8a8a;

            r = ((hex >> 16) & 255) / 255;
            g = ((hex >> 8) & 255) / 255;
            b = (hex & 255) / 255;
        } else {
            r = ((id * 37) % 200 + 55) / 255;
            g = ((id * 73) % 200 + 55) / 255;
            b = ((id * 109) % 200 + 55) / 255;
        }

        // Gentle preview color correction: avoids pitch-black faces/blocks while preserving contrast.
        const minChannel = 0.18;
        const lift = 0.10;
        r = Math.min(1, Math.max(minChannel, r + lift));
        g = Math.min(1, Math.max(minChannel, g + lift));
        b = Math.min(1, Math.max(minChannel, b + lift));
        return { r, g, b };
    }
};
