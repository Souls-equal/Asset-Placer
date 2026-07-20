#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
echo "Asset Placer - local static server"
echo "Manifest: manifest.json"
echo "Put only .bloxdschem/.json/.schem files in the schematics folder."
echo "Open: http://localhost:8080"
python3 -m http.server 8080
