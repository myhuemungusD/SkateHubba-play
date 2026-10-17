#!/usr/bin/env bash
# Cuts real recorded hits out of Freesound 746602 "Skateboarding Tricks" by
# SoundBiterSFX (CC BY 4.0, https://freesound.org/s/746602/) into the clip
# editor's SFX slots. Needs ffmpeg. Usage:
#   scripts/process-recorded-sfx.sh path/to/746602__soundbitersfx__skateboarding-tricks.wav
# Output: public/editor/sfx/<id>.m4a (AAC) + <id>.ogg (Vorbis), mono 44.1 kHz,
# light denoise, ~-14 LUFS, sample peak limited to -3 dBFS (AAC overshoot headroom). Sounds not listed here stay
# synthesized by scripts/generate-skate-sfx.mjs.
set -euo pipefail
SRC="$1"; OUT="$(dirname "$0")/../public/editor/sfx"
# id start duration  (seconds in the source file)
CUTS="
ollie-pop 0.840 0.300
flick 0.390 0.160
landing 28.380 0.900
grind-5050 21.180 1.700
slide-concrete 32.480 0.560
powerslide 37.800 0.700
wheel-roll 7.280 2.000
"
echo "$CUTS" | while read -r id ss dur; do
  [ -z "$id" ] && continue
  fo=$(awk "BEGIN{print ($dur>1)?0.25:0.04}")
  st=$(awk "BEGIN{print $dur-$fo}")
  base="highpass=f=50,afftdn=nf=-45:nr=8,afade=t=in:d=0.004,afade=t=out:st=$st:d=$fo"
  # measure loudness (pad with silence so short hits clear the 400 ms gate)
  I=$(ffmpeg -hide_banner -nostdin -ss "$ss" -t "$dur" -i "$SRC" -ac 1 -af "$base,apad=pad_dur=1,ebur128=peak=true" -f null - 2>&1 | awk '/Integrated loudness/{f=1} f&&/I:/{print $2; exit}')
  g=$(awk "BEGIN{g=-14-($I); print g}")
  af="$base,volume=${g}dB,alimiter=limit=0.7:attack=1:release=30:level=disabled"
  ffmpeg -hide_banner -loglevel error -nostdin -y -ss "$ss" -t "$dur" -i "$SRC" -ac 1 -ar 44100 -af "$af" -map_metadata -1 -fflags +bitexact -c:a aac -b:a 96k "$OUT/$id.m4a"
  ffmpeg -hide_banner -loglevel error -nostdin -y -ss "$ss" -t "$dur" -i "$SRC" -ac 1 -ar 44100 -af "$af" -map_metadata -1 -c:a libvorbis -q:a 4 "$OUT/$id.ogg"
  echo "$id: measured ${I} LUFS, gain ${g} dB"
done
