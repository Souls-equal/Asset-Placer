/**
 * bloxd_io.js — Lecture & écriture du format binaire .bloxdschem (Avro v0, RLE LEB128).
 *
 * Format (identique au M2B / Bloxd.io) :
 *   [4 octets]  0x00 0x00 0x00 0x00 (magic/header)
 *   [avro string]  nom
 *   [avro int]  posX
 *   [avro int]  posY
 *   [avro int]  posZ
 *   [avro int]  sizeX  (multiple de 32)
 *   [avro int]  sizeY
 *   [avro int]  sizeZ
 *   [avro array of chunks]
 *     Chaque chunk : { int cx, int cy, int cz, bytes rle }
 *     `rle` = paires LEB128 (count, blockId) couvrant 32768 cellules (32^3),
 *             dans l'ordre localX*1024 + localY*32 + localZ.
 */

(function (global) {
    'use strict';

    /* ------ LEB128 / Avro varints ------ */

    function readUvarint(buf, off) {
        let x = 0, s = 0, b;
        for (let i = 0; i < 10; i++) {
            if (off.value >= buf.length) throw new Error("uvarint: fin de buffer prématurée");
            b = buf[off.value++];
            if (b < 0x80) return x | (b << s);
            x |= (b & 0x7f) << s;
            s += 7;
        }
        throw new Error("uvarint: trop long");
    }

    function writeUvarint(n) {
        n = Math.floor(n);
        const out = [];
        while (n >= 0x80) {
            out.push((n & 0x7f) | 0x80);
            n = Math.floor(n / 128);
        }
        out.push(n & 0x7f);
        return new Uint8Array(out);
    }

    function readAvroInt(buf, off) {
        const zz = readUvarint(buf, off);
        return (zz >>> 1) ^ -(zz & 1);
    }

    function writeAvroInt(n) {
        n = Math.floor(n);
        const zz = n < 0 ? ((-n) * 2 - 1) : (n * 2);
        return writeUvarint(zz);
    }

    function readAvroString(buf, off) {
        const len = readAvroInt(buf, off);
        if (len < 0) throw new Error("avro string: longueur négative");
        if (off.value + len > buf.length) throw new Error("avro string: dépasse la fin");
        const bytes = buf.subarray(off.value, off.value + len);
        off.value += len;
        return new TextDecoder("utf-8").decode(bytes);
    }

    function writeAvroString(s) {
        const enc = new TextEncoder().encode(s);
        const lenBuf = writeAvroInt(enc.length);
        const res = new Uint8Array(lenBuf.length + enc.length);
        res.set(lenBuf, 0);
        res.set(enc, lenBuf.length);
        return res;
    }

    function readAvroBytes(buf, off) {
        const len = readAvroInt(buf, off);
        if (len < 0) throw new Error("avro bytes: longueur négative");
        if (off.value + len > buf.length) throw new Error("avro bytes: dépasse la fin");
        const bytes = buf.slice(off.value, off.value + len); // copy
        off.value += len;
        return bytes;
    }

    function writeAvroBytes(b) {
        const lenBuf = writeAvroInt(b.length);
        const res = new Uint8Array(lenBuf.length + b.length);
        res.set(lenBuf, 0);
        res.set(b, lenBuf.length);
        return res;
    }

    function concatBytes(parts) {
        let total = 0;
        for (const p of parts) total += p.length;
        const res = new Uint8Array(total);
        let o = 0;
        for (const p of parts) { res.set(p, o); o += p.length; }
        return res;
    }

    /* ------ RLE 32x32x32 ------ */

    const CHUNK = 32;
    const CHUNK_VOL = CHUNK * CHUNK * CHUNK; // 32768

    // Décode les RLE d'un chunk en un tableau Int32Array(32768), idx = lx*1024 + ly*32 + lz
    function decodeChunkRLE(rleBytes) {
        const blocks = new Int32Array(CHUNK_VOL);
        let pos = { value: 0 };
        let i = 0;
        while (i < CHUNK_VOL) {
            const count = readUvarint(rleBytes, pos);
            const bid = readUvarint(rleBytes, pos);
            for (let k = 0; k < count && i < CHUNK_VOL; k++) blocks[i++] = bid;
        }
        return blocks;
    }

    function encodeChunkRLE(blocks) {
        const parts = [];
        let i = 0;
        while (i < blocks.length) {
            let curr = blocks[i];
            let run = 1;
            while (i + run < blocks.length && blocks[i + run] === curr && run < 0x7fffffff) run++;
            parts.push(writeUvarint(run));
            parts.push(writeUvarint(curr));
            i += run;
        }
        return concatBytes(parts);
    }

    const AIR_ID = 0;
    const emptyChunkRLE = (function () {
        const arr = new Int32Array(CHUNK_VOL);
        return encodeChunkRLE(arr);
    })();

    /* ------ Parsing d'un .bloxdschem ------ */

    /**
     * Parse un ArrayBuffer/Uint8Array et retourne :
     * {
     *   name, pos:{x,y,z}, size:{x,y,z},
     *   blocks: Map<"cx,cy,cz", Int32Array(32768)>  // seuls les chunks non-vides
     *   nonEmptyChunks: nombre de chunks contenant au moins un bloc
     *   totalBlocks: nombre de blocs != Air
     *   aabb: { minX, minY, minZ, maxX, maxY, maxZ }  (en coordonnées monde, bloc plein)
     * }
     */
    function parseSchem(buffer) {
        const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const off = { value: 0 };

        // Header magic 00 00 00 00
        for (let i = 0; i < 4; i++) {
            if (buf[off.value++] !== 0) {
                // tolérant : on cherche quand même à continuer, mais prévient
                console.warn("BloxdSchem: header non nul à l'octet", i);
                break;
            }
        }

        const name = readAvroString(buf, off);
        const px = readAvroInt(buf, off);
        const py = readAvroInt(buf, off);
        const pz = readAvroInt(buf, off);
        const sx = readAvroInt(buf, off);
        const sy = readAvroInt(buf, off);
        const sz = readAvroInt(buf, off);

        const blocks = new Map();
        let totalBlocks = 0;

        // Lecture du tableau Avro (blocs de chunks)
        while (true) {
            let blockCount = readAvroInt(buf, off);
            if (blockCount === 0) break;
            if (blockCount < 0) {
                // Avro autorise les blocs avec compte négatif -> byte-count après
                blockCount = -blockCount;
                readAvroInt(buf, off); // ignorer byte count
            }
            for (let i = 0; i < blockCount; i++) {
                const cx = readAvroInt(buf, off);
                const cy = readAvroInt(buf, off);
                const cz = readAvroInt(buf, off);
                const rle = readAvroBytes(buf, off);
                const arr = decodeChunkRLE(rle);

                // Compter les blocs non-air dans ce chunk
                let nonAir = 0;
                for (let k = 0; k < arr.length; k++) if (arr[k] !== AIR_ID) nonAir++;
                if (nonAir === 0) continue;

                blocks.set(cx + "," + cy + "," + cz, arr);
                totalBlocks += nonAir;
            }
        }

        // Calcul de la bounding box réelle (seulement blocs non-air)
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        blocks.forEach((arr, key) => {
            const [cx, cy, cz] = key.split(",").map(Number);
            const bx0 = px + cx * CHUNK;
            const by0 = py + cy * CHUNK;
            const bz0 = pz + cz * CHUNK;
            for (let lx = 0; lx < CHUNK; lx++) {
                for (let ly = 0; ly < CHUNK; ly++) {
                    for (let lz = 0; lz < CHUNK; lz++) {
                        const bid = arr[lx * 1024 + ly * 32 + lz];
                        if (bid === AIR_ID) continue;
                        const wx = bx0 + lx, wy = by0 + ly, wz = bz0 + lz;
                        if (wx < minX) minX = wx;
                        if (wy < minY) minY = wy;
                        if (wz < minZ) minZ = wz;
                        if (wx > maxX) maxX = wx;
                        if (wy > maxY) maxY = wy;
                        if (wz > maxZ) maxZ = wz;
                    }
                }
            }
        });

        // Si le schem est totalement vide, fournir une bbox dégénérée
        if (!isFinite(minX)) { minX = px; minY = py; minZ = pz; maxX = px; maxY = py; maxZ = pz; }

        // Normalisation : les blocs sont remballés dans de nouveaux chunks 32^3
        // de telle sorte que le bloc minimum (aabb.min* en coords monde d'origine)
        // se retrouve à l'origine (0,0,0) du schem.
        // Cela simplifie énormément le placement et l'export : la taille est
        // (w,h,d) = (max-min+1) et il n'y a plus de décalage caché.
        const normBlocks = new Map();
        blocks.forEach((arr, key) => {
            const [scx, scy, scz] = key.split(",").map(Number);
            const chunkWX0 = px + scx * CHUNK;
            const chunkWY0 = py + scy * CHUNK;
            const chunkWZ0 = pz + scz * CHUNK;
            for (let lx = 0; lx < CHUNK; lx++) {
                for (let ly = 0; ly < CHUNK; ly++) {
                    for (let lz = 0; lz < CHUNK; lz++) {
                        const bid = arr[lx * 1024 + ly * 32 + lz];
                        if (bid === AIR_ID) continue;
                        const wx = chunkWX0 + lx;
                        const wy = chunkWY0 + ly;
                        const wz = chunkWZ0 + lz;
                        const nx = wx - minX;
                        const ny = wy - minY;
                        const nz = wz - minZ;
                        const ncx = Math.floor(nx / CHUNK);
                        const ncy = Math.floor(ny / CHUNK);
                        const ncz = Math.floor(nz / CHUNK);
                        const nkey = ncx + "," + ncy + "," + ncz;
                        let nArr = normBlocks.get(nkey);
                        if (!nArr) { nArr = new Int32Array(CHUNK_VOL); normBlocks.set(nkey, nArr); }
                        const nlx = nx - ncx * CHUNK;
                        const nly = ny - ncy * CHUNK;
                        const nlz = nz - ncz * CHUNK;
                        nArr[nlx * 1024 + nly * 32 + nlz] = bid;
                    }
                }
            }
        });

        const sizeX = maxX - minX + 1;
        const sizeY = maxY - minY + 1;
        const sizeZ = maxZ - minZ + 1;

        return {
            name,
            // Positions/sizes d'origine (pour info), non utilisées pour le placement
            rawPos: { x: px, y: py, z: pz },
            rawSize: { x: sx, y: sy, z: sz },
            // Blocs normalisés : origine sur le bloc min, chunks indexés depuis 0
            blocks: normBlocks,
            nonEmptyChunks: normBlocks.size,
            totalBlocks,
            // Bbox normalisée : de (0,0,0) à (size-1)
            aabb: { minX: 0, minY: 0, minZ: 0, maxX: sizeX - 1, maxY: sizeY - 1, maxZ: sizeZ - 1 },
            size: { x: sizeX, y: sizeY, z: sizeZ }
        };
    }

    /* ------ Écriture d'un .bloxdschem à partir d'une scène (liste de schems placés) ------ */

    /**
     * Construit un fichier .bloxdschem à partir d'un tableau d'instances de schems.
     * Chaque instance : { schem: <parsed schem NORMALISÉ>, pos: {x,y,z} }
     *   où pos est la coordonnée MONDE du bloc min (aabb.min) du schem, c.-à-d.
     *   le bloc (0,0,0) des coordonnées normalisées du schem arrive à (pos.x, pos.y, pos.z)
     *   dans le monde final.
     *
     * On fusionne tous les blocs dans une grille de chunks 32^3 monde. Les schems
     * ajoutés en dernier écrasent les précédents en cas de superposition.
     */
    function buildMergedSchem(instances, name = "Merged Schem") {
        // 1) Calcul de la bounding box globale (en coordonnées monde)
        let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity;
        let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity;

        for (const inst of instances) {
            const s = inst.schem;
            const b = s.aabb;
            const x0 = inst.pos.x, y0 = inst.pos.y, z0 = inst.pos.z;
            const x1 = x0 + (b.maxX - b.minX);
            const y1 = y0 + (b.maxY - b.minY);
            const z1 = z0 + (b.maxZ - b.minZ);
            if (x0 < gMinX) gMinX = x0;
            if (y0 < gMinY) gMinY = y0;
            if (z0 < gMinZ) gMinZ = z0;
            if (x1 > gMaxX) gMaxX = x1;
            if (y1 > gMaxY) gMaxY = y1;
            if (z1 > gMaxZ) gMaxZ = z1;
        }

        if (!isFinite(gMinX)) {
            gMinX = 0; gMinY = 0; gMinZ = 0; gMaxX = 31; gMaxY = 31; gMaxZ = 31;
        }

        // Écriture en coordonnées POSITIVES depuis (0,0,0) pour éviter le bug
        // Bloxd qui coupe les coordonnées négatives au chargement. Le bloc le
        // plus bas/ouest/nord du monde est placé à (0,0,0) du fichier.
        // FIX HTTP 400 : le champ posY du header DOIT rester à 0 et les chunks
        // doivent être indexés depuis cy=0 (même si la scène est en hauteur,
        // on remplit le dessous par des chunks d'air).
        const worldMinX = Math.floor(gMinX / CHUNK) * CHUNK;
        const worldMinY = 0; // forcé à 0
        const worldMinZ = Math.floor(gMinZ / CHUNK) * CHUNK;
        const worldMaxX = Math.ceil((gMaxX + 1) / CHUNK) * CHUNK;
        const worldMaxY = Math.ceil((gMaxY + 1) / CHUNK) * CHUNK;
        const worldMaxZ = Math.ceil((gMaxZ + 1) / CHUNK) * CHUNK;

        const sizeX = worldMaxX - worldMinX;
        const sizeY = worldMaxY - worldMinY;
        const sizeZ = worldMaxZ - worldMinZ;

        const worldChunks = new Map();
        const getChunkArr = (cx, cy, cz) => {
            const key = cx + "," + cy + "," + cz;
            let arr = worldChunks.get(key);
            if (!arr) { arr = new Int32Array(CHUNK_VOL); worldChunks.set(key, arr); }
            return arr;
        };

        // 2) Remplir à partir des schems normalisés
        for (const inst of instances) {
            const s = inst.schem;
            const ox = inst.pos.x;
            const oy = inst.pos.y;
            const oz = inst.pos.z;
            s.blocks.forEach((arr, key) => {
                const [ncx, ncy, ncz] = key.split(",").map(Number);
                for (let lx = 0; lx < CHUNK; lx++) {
                    for (let ly = 0; ly < CHUNK; ly++) {
                        for (let lz = 0; lz < CHUNK; lz++) {
                            const bid = arr[lx * 1024 + ly * 32 + lz];
                            if (bid === AIR_ID) continue;
                            // Coordonnées normalisées dans le schem
                            const nx = ncx * CHUNK + lx;
                            const ny = ncy * CHUNK + ly;
                            const nz = ncz * CHUNK + lz;
                            // Coordonnées monde final
                            const wx = ox + nx;
                            const wy = oy + ny;
                            const wz = oz + nz;
                            const cx = Math.floor((wx - worldMinX) / CHUNK);
                            const cy = Math.floor((wy - worldMinY) / CHUNK);
                            const cz = Math.floor((wz - worldMinZ) / CHUNK);
                            const clx = ((wx - worldMinX) % CHUNK + CHUNK) % CHUNK;
                            const cly = ((wy - worldMinY) % CHUNK + CHUNK) % CHUNK;
                            const clz = ((wz - worldMinZ) % CHUNK + CHUNK) % CHUNK;
                            const cArr = getChunkArr(cx, cy, cz);
                            cArr[clx * 1024 + cly * 32 + clz] = bid;
                        }
                    }
                }
            });
        }

        // 3) Écriture binaire
        const parts = [];
        parts.push(new Uint8Array([0, 0, 0, 0]));
        parts.push(writeAvroString(name));
        parts.push(writeAvroInt(0));          // posX (tout à 0, tout en positifs)
        parts.push(writeAvroInt(0));          // posY
        parts.push(writeAvroInt(0));          // posZ
        parts.push(writeAvroInt(sizeX));
        parts.push(writeAvroInt(sizeY));
        parts.push(writeAvroInt(sizeZ));

        // S'assurer que tous les chunks Y vides entre 0 et le chunk min existent
        // (RLE air pur) pour satisfaire le validateur Bloxd.
        const nCX = Math.round(sizeX / CHUNK);
        const nCY = Math.round(sizeY / CHUNK);
        const nCZ = Math.round(sizeZ / CHUNK);
        // RLE d'un chunk d'air pur
        const airRle = encodeChunkRLE(new Int32Array(CHUNK_VOL));
        const allChunkKeys = [];
        for (let cx = 0; cx < nCX; cx++) {
            for (let cy = 0; cy < nCY; cy++) {
                for (let cz = 0; cz < nCZ; cz++) {
                    allChunkKeys.push(cx + "," + cy + "," + cz);
                }
            }
        }
        const totalChunks = allChunkKeys.length;
        parts.push(writeAvroInt(totalChunks));
        for (const key of allChunkKeys) {
            const [cx, cy, cz] = key.split(",").map(Number);
            parts.push(writeAvroInt(cx));
            parts.push(writeAvroInt(cy));
            parts.push(writeAvroInt(cz));
            const cArr = worldChunks.get(key);
            parts.push(writeAvroBytes(cArr ? encodeChunkRLE(cArr) : airRle));
        }
        parts.push(writeAvroInt(0)); // end array

        const bytes = concatBytes(parts);
        return {
            bytes,
            origin: { x: worldMinX, y: worldMinY, z: worldMinZ },
            size: { x: sizeX, y: sizeY, z: sizeZ },
            totalChunks
        };
    }

    /**
     * Extrait une région AABB d'un schem normalisé et retourne un NOUVEAU schem
     * normalisé ne contenant que ces blocs.
     * Si `removeFromSource` = true, les blocs extraits sont également retirés du schem source.
     * Si aucun bloc ne se trouve dans la boîte, retourne null.
     */
    function extractSubSchem(schem, box, removeFromSource) {
        const bx0 = Math.floor(box.minX);
        const by0 = Math.floor(box.minY);
        const bz0 = Math.floor(box.minZ);
        const bx1 = Math.floor(box.maxX);
        const by1 = Math.floor(box.maxY);
        const bz1 = Math.floor(box.maxZ);

        // Collecter les blocs à extraire (et éventuellement les retirer du source)
        const newBlocks = new Map(); // chunks du futur schem
        let newTotal = 0;
        let srcRemoved = 0;

        // Initialiser les chunks cibles avec des Int32Array remplis d'air,
        // à la volée. Le nouveau schem sera lui aussi normalisé (son min à 0,0,0).
        const getNewChunk = (cx, cy, cz) => {
            const k = cx + "," + cy + "," + cz;
            let arr = newBlocks.get(k);
            if (!arr) { arr = new Int32Array(CHUNK_VOL); newBlocks.set(k, arr); }
            return arr;
        };

        schem.blocks.forEach((arr, key) => {
            const [cx, cy, cz] = key.split(",").map(Number);
            const cbx0 = cx * CHUNK, cby0 = cy * CHUNK, cbz0 = cz * CHUNK;
            const cbx1 = cbx0 + CHUNK - 1, cby1 = cby0 + CHUNK - 1, cbz1 = cbz0 + CHUNK - 1;
            // Si le chunk source n'intersecte pas la boîte, skip
            if (cbx1 < bx0 || cbx0 > bx1 || cby1 < by0 || cby0 > by1 || cbz1 < bz0 || cbz0 > bz1) return;

            for (let lx = 0; lx < CHUNK; lx++) {
                const nx = cbx0 + lx;
                if (nx < bx0 || nx > bx1) continue;
                for (let ly = 0; ly < CHUNK; ly++) {
                    const ny = cby0 + ly;
                    if (ny < by0 || ny > by1) continue;
                    for (let lz = 0; lz < CHUNK; lz++) {
                        const nz = cbz0 + lz;
                        if (nz < bz0 || nz > bz1) continue;
                        const idx = lx * 1024 + ly * 32 + lz;
                        const bid = arr[idx];
                        if (bid === AIR_ID) continue;

                        // Coords dans le nouveau schem (normalisé à 0,0,0)
                        const tnx = nx - bx0;
                        const tny = ny - by0;
                        const tnz = nz - bz0;
                        const tcx = Math.floor(tnx / CHUNK);
                        const tcy = Math.floor(tny / CHUNK);
                        const tcz = Math.floor(tnz / CHUNK);
                        const tArr = getNewChunk(tcx, tcy, tcz);
                        const tlx = tnx - tcx * CHUNK;
                        const tly = tny - tcy * CHUNK;
                        const tlz = tnz - tcz * CHUNK;
                        tArr[tlx * 1024 + tly * 32 + tlz] = bid;
                        newTotal++;

                        if (removeFromSource) {
                            arr[idx] = AIR_ID;
                            srcRemoved++;
                        }
                    }
                }
            }

            // Si on retire les blocs et que le chunk source est devenu totalement vide, on le supprime
            if (removeFromSource) {
                let hasAny = false;
                for (let i = 0; i < CHUNK_VOL; i++) if (arr[i] !== AIR_ID) { hasAny = true; break; }
                if (!hasAny) schem.blocks.delete(key);
            }
        });

        if (newTotal === 0) return null;

        const sizeX = bx1 - bx0 + 1;
        const sizeY = by1 - by0 + 1;
        const sizeZ = bz1 - bz0 + 1;
        return {
            name: schem.name + " (extrait)",
            rawPos: { x: 0, y: 0, z: 0 },
            rawSize: { x: sizeX, y: sizeY, z: sizeZ },
            blocks: newBlocks,
            nonEmptyChunks: newBlocks.size,
            totalBlocks: newTotal,
            aabb: { minX: 0, minY: 0, minZ: 0, maxX: sizeX - 1, maxY: sizeY - 1, maxZ: sizeZ - 1 },
            size: { x: sizeX, y: sizeY, z: sizeZ }
        };
    }

    /* ------ Palette approximative blockId -> couleur (pour le preview 3D) ------ */
    // Palette minimale mais suffisante pour reconnaître les schems.
    // ID empruntés à nameToId.json du projet d'origine.
    const BLOCK_COLORS = {
        0: 0x000000,      // Air (transparent)
        1: 0x111111,
        2: 0x6b4423,      // Dirt
        3: 0x7a5434,      // Messy Dirt
        4: 0x4ea64e,      // Grass Block
        5: 0xe8d98a,      // Sand
        6: 0x9aa3a8,      // Clay
        7: 0x8c8c8c,      // Gravel
        8: 0xf5f9fc,      // Snow / Packed Snow
        28: 0x7d7d7d,     // Stone
        29: 0x6e6e6e,     // Messy Stone
        31: 0x949494,     // Smooth Stone
        32: 0xeeefe8,     // Diorite
        33: 0xf3f3ef,
        34: 0x888783,     // Andesite
        36: 0x9b8378,     // Granite
        38: 0xd9c585,     // Sandstone
        39: 0xc4ae6d,     // Yellowstone
        51: 0xf4f4f4, 52: 0xf09336, 53: 0xbe59c9, 54: 0x6cb4d9, 55: 0xf5dd4a,
        56: 0x92db3a, 57: 0xf0a3b5, 58: 0x656565, 59: 0xb9b9b9, 60: 0x41b3b8,
        61: 0x7a49b0, 62: 0x3b5ec4, 63: 0x7b5536, 64: 0x51862d, 65: 0xc13434,
        66: 0x1f1f25,
        67: 0xa05944, 68: 0xe3e3dd, 69: 0xe0823e, 70: 0xb863bb, 71: 0x6fb5d8,
        72: 0xdcc14c, 73: 0x85c543, 74: 0xe08ca1, 75: 0x696969, 76: 0xaba9a7,
        77: 0x4aa9ac, 78: 0x824fb2, 79: 0x4c6fca, 80: 0x7b5536, 81: 0x528c33,
        82: 0xa53a3a, 83: 0x2b2b33,
        84: 0x808080, 85: 0xaaaaaa, 86: 0x111114, 87: 0x4868b0, 88: 0x7a5836,
        89: 0x3ba6b0, 90: 0x5fb8e8, 91: 0x9be05a, 92: 0xca5fd2, 93: 0xef8f35,
        94: 0xf0b7c5, 95: 0x865bc9, 96: 0xd54848, 97: 0xffffff, 98: 0x4aaf3c,
        99: 0xf5dd3a,
        126: 0x2c8dd1,     // Water
        128: 0x9b3e32,     // Bricks
        129: 0x7a7a75,     // Stone Bricks
        132: 0xf1ece0,     // Block of Quartz
        135: 0x677663,     // Mossy Stone Bricks
        136: 0x6b6b65,     // Cracked Stone Bricks
        137: 0xe2cc8e,     // Smooth Sandstone
        139: 0x98d9f1,     // Ice
        140: 0x221930,     // Obsidian
        147: 0x3a3a3a,     // Bedrock
        130: 0x662222, 131: 0x551e1e, // Dark Red Brick / Stone
        471: 0xff7a2a,     // Magma
        475: 0xb25b3d,     // Smooth Red Sandstone
        650: 0xc45539,     // Red Sand
        1222: 0x8b4a3c,    // Cherry Log
        233: 0xb3cb61,     // Lime Planks
        241: 0x3f7a3b      // Green Planks
    };

    function getBlockColor(id) {
        return BLOCK_COLORS[id] !== undefined ? BLOCK_COLORS[id] : 0xb08060;
    }

    global.BloxdIO = {
        parseSchem,
        buildMergedSchem,
        extractSubSchem,
        getBlockColor,
        CHUNK,
        CHUNK_VOL,
        AIR_ID
    };

})(window);
