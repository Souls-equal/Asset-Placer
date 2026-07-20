/**
 * renderer.js — Rendu optimisé VertexData (Babylon)
 */

const BLOCK_COLORS = {
    1:  { r: 0.5, g: 0.5, b: 0.5 },    // Stone
    2:  { r: 0.4, g: 0.3, b: 0.2 },    // Dirt
    3:  { r: 0.3, g: 0.6, b: 0.2 },    // Grass
    4:  { r: 0.65, g: 0.5, b: 0.3 },   // Wood Planks
    5:  { r: 0.55, g: 0.4, b: 0.25 },  // Dark Wood
    6:  { r: 0.8,  g: 0.7, b: 0.5 },   // Birch
    7:  { r: 0.95, g: 0.95, b: 0.95 }, // White
    23: { r: 0.85, g: 0.85, b: 0.85 }, // Glass
    28: { r: 0.3,  g: 0.8,  b: 0.4 },  // Leaves
    29: { r: 0.7,  g: 0.6,  b: 0.5 },  // Brick
};

function getBlockColor(id) {
    if (BLOCK_COLORS[id]) return BLOCK_COLORS[id];
    const r = ((id * 37) % 200 + 55) / 255;
    const g = ((id * 73) % 200 + 55) / 255;
    const b = ((id * 109) % 200 + 55) / 255;
    return { r, g, b };
}

window.createMeshFromSchem = function(scene, schem) {
    const blocks = schem.blocks;
    if (!blocks || blocks.length === 0) return null;

    let allPositions = [];
    let allIndices = [];
    let allNormals = [];
    let allColors = [];
    let vertexOffset = 0;

    const cubeData = BABYLON.VertexData.CreateBox({ size: 1 });
    const basePositions = cubeData.positions;
    const baseIndices = cubeData.indices;
    const baseNormals = cubeData.normals;

    for (const block of blocks) {
        if (!block || block.id === 0) continue;

        const bx = block.x !== undefined ? block.x : 0;
        const by = block.y !== undefined ? block.y : 0;
        const bz = block.z !== undefined ? block.z : 0;

        const color = getBlockColor(block.id);

        for (let i = 0; i < basePositions.length; i += 3) {
            allPositions.push(basePositions[i] + bx + 0.5);
            allPositions.push(basePositions[i+1] + by + 0.5);
            allPositions.push(basePositions[i+2] + bz + 0.5);
        }

        for (let i = 0; i < baseNormals.length; i++) {
            allNormals.push(baseNormals[i]);
        }

        for (let i = 0; i < baseIndices.length; i++) {
            allIndices.push(baseIndices[i] + vertexOffset);
        }

        const numVerticesInCube = basePositions.length / 3;
        for (let v = 0; v < numVerticesInCube; v++) {
            allColors.push(color.r, color.g, color.b, 1.0);
        }

        vertexOffset += numVerticesInCube;
    }

    if (allPositions.length === 0) return null;

    const vertexData = new BABYLON.VertexData();
    vertexData.positions = new Float32Array(allPositions);
    vertexData.indices = new Int32Array(allIndices);
    vertexData.normals = new Float32Array(allNormals);
    vertexData.colors = new Float32Array(allColors);

    const mesh = new BABYLON.Mesh("schemMesh", scene);
    vertexData.applyToMesh(mesh);

    const material = new BABYLON.StandardMaterial("schemMat", scene);
    material.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    material.useVertexColors = true;
    material.backFaceCulling = true;
    mesh.material = material;

    return mesh;
};
