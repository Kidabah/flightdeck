#!/bin/sh
# Remount PrintShelf CIFS shares after reboot (PC + Koko + Mora when creds exist).
set -e
/home/flightdeck/bin/mount-kidabah-pc.sh || true
if [ -x /home/flightdeck/bin/mount-koko-kidabah.sh ]; then
  /home/flightdeck/bin/mount-koko-kidabah.sh || true
fi
if [ -x /home/flightdeck/bin/mount-nas-mora.sh ]; then
  /home/flightdeck/bin/mount-nas-mora.sh || true
fi
