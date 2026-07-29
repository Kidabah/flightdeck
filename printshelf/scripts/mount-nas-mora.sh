#!/bin/sh
# Mount Mora Synology User Homes / Kidabah → /mnt/nas-mora
# Creds: /home/flightdeck/.smbcredentials-mora  (username= / password=)
set -e
CRED=/home/flightdeck/.smbcredentials-mora
MNT=/mnt/nas-mora
HOST=192.168.4.77
# Synology "User Homes" share is usually SMB name "homes"; Windows may show "User Homes".
SHARE_HOMES=homes
SHARE_USER_HOMES="User Homes"
SHARE_HOME=home
USER_DIR=Kidabah

if [ ! -f "$CRED" ]; then
  echo "missing credentials: $CRED (username=… / password=…)" >&2
  exit 1
fi

if grep -q " ${MNT} " /proc/mounts 2>/dev/null; then
  echo "already mounted: $MNT"
  ls "$MNT" | head -20
  exit 0
fi

docker run --rm --privileged --pid=host --network=host alpine:3.20 \
  nsenter -t 1 -m -u -i -n sh -c "
    mkdir -p $MNT
    # Prefer User Homes / Kidabah as the mount root (prefixpath).
    mount -t cifs //$HOST/$SHARE_HOMES $MNT -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino,prefixpath=$USER_DIR \
      || mount -t cifs //$HOST/$SHARE_HOMES $MNT -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=2.1,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino,prefixpath=$USER_DIR \
      || mount -t cifs '//$HOST/$SHARE_USER_HOMES' $MNT -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino,prefixpath=$USER_DIR \
      || mount -t cifs //$HOST/$SHARE_HOME $MNT -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino
    ls $MNT | head -20
  "

echo "mounted $MNT"
grep " ${MNT} " /proc/mounts
ls "$MNT" | head -20
