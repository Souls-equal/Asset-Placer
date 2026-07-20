# asset_placer-5.4 — Flat project structure + title version

## Changes requested

### 1. Page title updated

The HTML title no longer says `Babylon.js`.

It now shows the current project version:

```html
<title>Asset Placer - v5.4</title>
```

For future updates, the title should be updated with the current version number.

---

## 2. No folders except the schematics folder

The project structure has been flattened.

Before:

```text
css/style.css
js/app.js
js/libraryUI.js
schematics/manifest.json
```

Now:

```text
style.css
app.js
libraryUI.js
manifest.json
schematics/
```

The only folder left is:

```text
schematics/
```

This folder is intended to contain only schematic files:

```text
.bloxdschem
.json
.schem
```

No README, manifest, or helper note is stored inside `schematics/` anymore.

---

## 3. Manifest moved to the root

Because `schematics/` should contain only schematic files, the manifest is now at the project root:

```text
manifest.json
```

The loader reads:

```js
manifest.json
```

and every listed file is resolved relative to:

```text
schematics/
```

Example:

```json
{
  "schematics": [
    {
      "file": "tree001.bloxdschem",
      "name": "tree001",
      "type": "tree",
      "biome": "classic"
    }
  ]
}
```

Expected file path:

```text
schematics/tree001.bloxdschem
```

---

## 4. Current test entries

`manifest.json` currently references:

```text
tree001.bloxdschem
tree002.bloxdschem
```

So place them here:

```text
schematics/tree001.bloxdschem
schematics/tree002.bloxdschem
```

Both are tagged as:

```text
type: tree
biome: classic
```

---

## 5. Script/CSS paths updated

`index.html` now references flat root files:

```html
<link rel="stylesheet" href="style.css">
<script src="app.js"></script>
```

instead of:

```html
<link rel="stylesheet" href="css/style.css">
<script src="js/app.js"></script>
```

---

## 6. ZIP structure

The ZIP still contains project files directly at the ZIP root, with no wrapping folder.

Expected root:

```text
index.html
style.css
app.js
manifest.json
schematics/
favicon.png
START_LOCAL_SERVER.bat
```

Only `schematics/` is a folder.

## Version summary

- v5.0: manifest-only schematic loading with type/biome metadata.
- v5.1: Asset Library tag search/filter based on manifest metadata.
- v5.2: Delete/Suppr shortcut and tree001/tree002 test manifest entries.
- v5.3: removed built-in placeholder assets and improved tag suggestions/search behavior.
- v5.4: flat root file structure, manifest moved to root, title now shows current version.
