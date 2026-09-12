#!/usr/bin/env bash
# Re-fetch Poly Haven Forest Slope 1k HDRI into public/hdr/env.hdr (CC0).
# https://polyhaven.com/a/forest_slope — author Andreas Mischok
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/hdr/env.hdr"
URL="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/forest_slope_1k.hdr"
EXPECT_MD5="d7676fa11b7a6c4cc3333ac6505e08d2"
mkdir -p "$(dirname "$OUT")"
TMP="$OUT.tmp"
curl -fL --retry 3 -H "User-Agent: rose-project-hdri-fetch/1.0 (CC0 Poly Haven forest_slope)" -o "$TMP" "$URL"
echo "$EXPECT_MD5  $TMP" | md5sum -c -
mv "$TMP" "$OUT"
echo "Wrote $OUT"
ls -la "$OUT"
