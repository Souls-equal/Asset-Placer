/**
 * parser.js — Parseur de schematics Bloxd.io (Babylon)
 */

window.parseSchem = function(data) {
    let parsed;
    if (typeof data === 'string') {
        try {
            parsed = JSON.parse(data);
        } catch (e) {
            throw new Error("Erreur de parsing JSON du schematic : " + e.message);
        }
    } else {
        parsed = data;
    }

    let blocks = [];
    let size = { x: 0, y: 0, z: 0 };

    if (Array.isArray(parsed)) {
        blocks = parsed;
    } else if (parsed && Array.isArray(parsed.blocks)) {
        blocks = parsed.blocks;
        if (parsed.size) size = parsed.size;
    } else if (parsed && parsed.data) {
        blocks = parsed.data;
    }

    if (size.x === 0 && blocks.length > 0) {
        let maxX = 0, maxY = 0, maxZ = 0;
        let minX = 0, minY = 0, minZ = 0;
        for (const b of blocks) {
            if (b.x > maxX) maxX = b.x;
            if (b.y > maxY) maxY = b.y;
            if (b.z > maxZ) maxZ = b.z;
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.z < minZ) minZ = b.z;
        }
        size = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 };
    }

    return { size, blocks };
};
