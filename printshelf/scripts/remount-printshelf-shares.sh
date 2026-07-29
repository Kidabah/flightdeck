#!/bin/sh
# Remount PrintShelf + Cindy music shares after reboot (when creds exist).
set -e
/home/flightdeck/bin/mount-kidabah-pc.sh || true
if [ -x /home/flightdeck/bin/mount-koko-kidabah.sh ]; then
  /home/flightdeck/bin/mount-koko-kidabah.sh || true
fi
if [ -x /home/flightdeck/bin/mount-nas-mora.sh ]; then
  /home/flightdeck/bin/mount-nas-mora.sh || true
fi
if [ -x /home/flightdeck/bin/mount-cindy.sh ]; then
  /home/flightdeck/bin/mount-cindy.sh || true
fi
