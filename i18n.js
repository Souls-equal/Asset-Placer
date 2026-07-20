/**
 * i18n.js — UI translations (EN / FR) and keyboard layout configuration (AZERTY / QWERTY)
 */

window.I18N = {
    // Default UI language is now English.
    lang: 'en',
    keyboard: 'azerty', // 'azerty' or 'qwerty'
    translations: {
        en: {
            library: "📚 Asset Library",
            importTerrain: "🌄 Import (Terrain)",
            terrainImportSuccess: "Terrain imported:",
            terrainImportError: "Terrain import failed:",
            export: "📤 Export (Schematic)",
            settings: "⚙ Settings",
            properties: "Properties",
            name: "Name:",
            position: "Position",
            positionX: "Position X:",
            positionY: "Position Y:",
            positionZ: "Position Z:",
            rotation: "Rotation Y:",
            duplicate: "📋 Duplicate",
            delete: "🗑️ Delete",
            language: "Language:",
            keyboardLayout: "Keyboard:",
            close: "Close",
            settingsTitle: "Editor Settings",
            toggleLibrary: "Collapse / Expand",
            reopenLibrary: "Open asset library",
            noBlocksToExport: "No blocks to export!",
            largeTerrainExportSkipped: "Large streaming terrain is too big for JSON export in one file. Exporting placed assets only for now.",
            canvasLabel: "Babylon 3D scene",
            overlayLabel: "Editor interface"
        },
        fr: {
            library: "📚 Bibliothèque d'assets",
            importTerrain: "🌄 Importer (Terrain)",
            terrainImportSuccess: "Terrain importé :",
            terrainImportError: "Échec de l'import du terrain :",
            export: "📤 Exporter (Schematic)",
            settings: "⚙ Paramètres",
            properties: "Propriétés",
            name: "Nom :",
            position: "Position",
            positionX: "Position X :",
            positionY: "Position Y :",
            positionZ: "Position Z :",
            rotation: "Rotation Y :",
            duplicate: "📋 Dupliquer",
            delete: "🗑️ Supprimer",
            language: "Langue :",
            keyboardLayout: "Clavier :",
            close: "Fermer",
            settingsTitle: "Paramètres de l'éditeur",
            toggleLibrary: "Replier / Déplier",
            reopenLibrary: "Ouvrir la bibliothèque d'assets",
            noBlocksToExport: "Aucun bloc à exporter !",
            largeTerrainExportSkipped: "Le terrain en mode streaming est trop volumineux pour un export JSON en un seul fichier. Export des assets placés uniquement pour le moment.",
            canvasLabel: "Scène 3D Babylon",
            overlayLabel: "Interface de l'éditeur"
        }
    },
    t(key) {
        const dict = this.translations[this.lang] || this.translations.en;
        return dict[key] || this.translations.en[key] || key;
    }
};
