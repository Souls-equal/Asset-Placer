/**
 * exporter.js — Unified export for imported terrain + placed assets (Babylon)
 */

window.Exporter = class Exporter {
    constructor(assetManager, terrainManager = null) {
        this.assetManager = assetManager;
        this.terrainManager = terrainManager;
    }

    exportSingleSchem() {
        const blockMap = new Map();

        // Terrain first: assets placed afterwards override terrain blocks on the same coordinates.
        let terrainSkippedForSize = false;
        if (this.terrainManager && this.terrainManager.hasTerrain()) {
            const data = this.terrainManager.terrainData;
            const isHugeStreamingTerrain = data && data.mode === 'heightmap-streaming' && data.totalColumns > 1000000;
            if (isHugeStreamingTerrain) {
                terrainSkippedForSize = true;
                alert(window.I18N ? window.I18N.t('largeTerrainExportSkipped') : 'Large streaming terrain is too big for JSON export in one file. Exporting placed assets only for now.');
            } else {
                for (const b of this.terrainManager.getExportBlocks()) {
                    if (!b || b.id === 0) continue;
                    blockMap.set(`${b.x},${b.y},${b.z}`, {
                        x: b.x,
                        y: b.y,
                        z: b.z,
                        id: b.id,
                        data: b.data || 0
                    });
                }
            }
        }

        for (const instance of this.assetManager.instances) {
            const templateMesh = this.assetManager.templates[instance.name];
            const schemData = templateMesh ? templateMesh.schemData : null;
            if (!schemData || !schemData.blocks) continue;

            const posX = Math.round(instance.position.x);
            const posY = Math.round(instance.position.y);
            const posZ = Math.round(instance.position.z);
            const rotY = instance.rotationY;

            const sizeX = schemData.size ? schemData.size.x : 4;
            const sizeZ = schemData.size ? schemData.size.z : 4;

            for (const block of schemData.blocks) {
                if (!block || block.id === 0) continue;

                let lx = block.x;
                let ly = block.y;
                let lz = block.z;

                let rx = lx, rz = lz;
                if (rotY === 90) {
                    rx = -lz + (sizeZ - 1);
                    rz = lx;
                } else if (rotY === 180) {
                    rx = -lx + (sizeX - 1);
                    rz = -lz + (sizeZ - 1);
                } else if (rotY === 270) {
                    rx = lz;
                    rz = -lx + (sizeX - 1);
                }

                const worldX = posX + rx;
                const worldY = posY + ly;
                const worldZ = posZ + rz;

                blockMap.set(`${worldX},${worldY},${worldZ}`, {
                    x: worldX,
                    y: worldY,
                    z: worldZ,
                    id: block.id,
                    data: block.data || 0
                });
            }
        }

        const allBlocks = Array.from(blockMap.values());

        if (allBlocks.length === 0) {
            alert(window.I18N ? window.I18N.t('noBlocksToExport') : "No blocks to export!");
            return;
        }

        let globalMinX = Infinity, globalMinY = Infinity, globalMinZ = Infinity;
        let globalMaxX = -Infinity, globalMaxY = -Infinity, globalMaxZ = -Infinity;

        for (const b of allBlocks) {
            if (b.x < globalMinX) globalMinX = b.x;
            if (b.y < globalMinY) globalMinY = b.y;
            if (b.z < globalMinZ) globalMinZ = b.z;
            if (b.x > globalMaxX) globalMaxX = b.x;
            if (b.y > globalMaxY) globalMaxY = b.y;
            if (b.z > globalMaxZ) globalMaxZ = b.z;
        }

        const normalizedBlocks = allBlocks.map(b => ({
            x: b.x - globalMinX,
            y: b.y - globalMinY,
            z: b.z - globalMinZ,
            id: b.id,
            data: b.data
        }));

        const exportObj = {
            size: {
                x: globalMaxX - globalMinX + 1,
                y: globalMaxY - globalMinY + 1,
                z: globalMaxZ - globalMinZ + 1
            },
            origin: {
                x: globalMinX,
                y: globalMinY,
                z: globalMinZ
            },
            includesTerrain: !!(this.terrainManager && this.terrainManager.hasTerrain() && !terrainSkippedForSize),
            terrainExportSkipped: terrainSkippedForSize,
            blocks: normalizedBlocks
        };

        this._downloadFile(JSON.stringify(exportObj, null, 2), "bloxd_scene_export.json", "application/json");
    }

    _downloadFile(content, filename, contentType) {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
