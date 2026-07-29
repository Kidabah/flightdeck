#!/bin/sh
# Remount PrintShelf CIFS shares after reboot (Kidabah PC + Koko when creds exist).
set -e
/home/flightdeck/bin/mount-kidabah-pc.sh || true
if [ -x /home/flightdeck/bin/mount-koko-kidabah.sh ]; then
  /home/flightdeck/bin/mount-koko-kidabah.sh || true
fi
