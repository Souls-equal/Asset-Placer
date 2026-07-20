window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const canvasContainer = document.getElementById('canvas-container');

    // Important : le 4e paramètre à true adapte le buffer au devicePixelRatio.
    const engine = new BABYLON.Engine(
        canvas,
        true,
        { preserveDrawingBuffer: true, stencil: true },
        true
    );

    window.appEngine = engine; // exposé pour pouvoir forcer un resize depuis l'UI (toggle sidebar, etc.)

    // Resize centralisé : utile pour resize fenêtre, orientation mobile et changements CSS.
    const resizeBabylon = () => {
        if (!engine || engine.isDisposed) return;
        requestAnimationFrame(() => {
            engine.resize();
        });
    };
    window.appResize = resizeBabylon;

    const createScene = function () {
        const scene = new BABYLON.Scene(engine);
        window.appScene = scene;
        scene.clearColor = new BABYLON.Color4(0.12, 0.12, 0.12, 1);

        const camera = window.setupCamera(scene, canvas);

        // Editor-friendly lighting: strong ambient fill, soft directional light.
        // Imported terrains can be very vertical/irregular; a harsh directional-only look makes
        // cliffs and back-facing surfaces look almost black or visually broken.
        scene.ambientColor = new BABYLON.Color3(0.55, 0.55, 0.55);

        const hemisphericLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
        hemisphericLight.intensity = 1.15;
        hemisphericLight.diffuse = new BABYLON.Color3(1.0, 1.0, 1.0);
        hemisphericLight.groundColor = new BABYLON.Color3(0.65, 0.65, 0.65);

        const directionalLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-1, -2, -1), scene);
        directionalLight.intensity = 0.25;
        directionalLight.position = new BABYLON.Vector3(20, 40, 20);

        // Sol 300x300 : pickable pour le placement, le drag et la désélection sur la scène.
        const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 300, height: 300 }, scene);
        const groundMaterial = new BABYLON.StandardMaterial("groundMat", scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.18);
        groundMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        ground.material = groundMaterial;
        ground.isPickable = true;

        // Grille 1:1 exacte (subdivisions 300) non pickable : le sol porte le picking.
        const gridMesh = BABYLON.MeshBuilder.CreateGround("grid", { width: 300, height: 300, subdivisions: 300 }, scene);
        const gridMat = new BABYLON.StandardMaterial("gridMat", scene);
        gridMat.wireframe = true;
        gridMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
        gridMesh.material = gridMat;
        gridMesh.position.y = 0.01;
        gridMesh.isPickable = false;

        const assetManager = new window.AssetManager(scene);
        const terrainManager = new window.TerrainManager(scene, ground, gridMesh);
        window.appTerrainManager = terrainManager;

        const selectionManager = new window.SelectionManager(scene, assetManager);
        window.appSelectionManager = selectionManager;
        const inputManager = new window.InputManager(scene, selectionManager);
        const dragDropManager = new window.DragDropManager(scene, assetManager, selectionManager, canvas);
        const libraryUI = new window.LibraryUI(assetManager, dragDropManager, terrainManager);
        const explorerUI = new window.ExplorerUI(assetManager, terrainManager, selectionManager);
        const uiManager = new window.UIManager(scene, assetManager, selectionManager, dragDropManager);

        window.appExporter = new window.Exporter(assetManager, terrainManager);

        // The Asset Library is now populated only from schematics/manifest.json.
        // No built-in placeholder/test schematics are registered anymore.
        libraryUI.populateLibrary();

        // Load user schematics explicitly listed in root manifest.json.
        if (window.SchematicLibraryLoader) {
            const schematicLibraryLoader = new window.SchematicLibraryLoader(scene, assetManager, libraryUI);
            window.appSchematicLibraryLoader = schematicLibraryLoader;
            schematicLibraryLoader.loadFromProjectFolder().then((count) => {
                if (count > 0) libraryUI.populateLibrary();
            });
        }

        return scene;
    };

    const scene = createScene();

    engine.runRenderLoop(function () {
        scene.render();
    });

    // Resize fiable : fenêtre, orientation, retour d'onglet, et changement de taille CSS réel.
    window.addEventListener('resize', resizeBabylon, { passive: true });
    window.addEventListener('orientationchange', resizeBabylon, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) resizeBabylon();
    });

    if ('ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(resizeBabylon);
        if (canvasContainer) resizeObserver.observe(canvasContainer);
        resizeObserver.observe(canvas);
        window.appResizeObserver = resizeObserver;
    }

    // Premier resize après application du CSS et création de l'UI.
    resizeBabylon();
    requestAnimationFrame(resizeBabylon);
});
