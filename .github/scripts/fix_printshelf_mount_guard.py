from pathlib import Path

scanner = Path('printshelf/app/scanner.py')
text = scanner.read_text(encoding='utf-8')
old = '''def _root_ready_to_scan(root: Path) -> tuple[bool, str]:
    """Skip empty /mnt placeholders when the CIFS/NFS share is not mounted.

    After a Pi reboot, /mnt/koko-kidabah etc. still exist as empty dirs. Walking
    them and then mark-missing would hide the entire library.
    """
    if not root.exists() or not root.is_dir():
        return False, "missing_or_not_dir"
    root_s = str(root)
    try:
        resolved_s = str(root.resolve())
    except Exception:
        resolved_s = root_s
    under_removable = any(
        s.startswith(prefix)
        for s in (root_s, resolved_s)
        for prefix in ("/mnt/", "/media/")
    )
    if under_removable:
        # Accept the root itself or any parent mount (e.g. /mnt/nas-mora/Kidabah
        # under a bind/CIFS mount at /mnt/nas-mora).
        cur = root if root.is_dir() else root.parent
        mounted = False
        for p in [cur, *cur.parents]:
            ps = str(p)
            if os.path.ismount(ps):
                mounted = True
                break
            if ps in ("/", ""):
                break
        if not mounted:
            return False, "not_mounted"
    return True, "ok"
'''
new = '''def _decode_mountinfo_path(value: str) -> str:
    """Decode Linux mountinfo octal escapes (space, tab, newline, backslash)."""
    def repl(match: re.Match[str]) -> str:
        try:
            return chr(int(match.group(1), 8))
        except Exception:
            return match.group(0)

    return re.sub(r"\\\\([0-7]{3})", repl, value)


def _mountinfo_mount_points() -> set[str]:
    """Return mount points visible to this process, including bind mounts.

    os.path.ismount() can miss Linux bind mounts because the bind target may
    share the same st_dev as its parent. /proc/self/mountinfo is authoritative
    for the service's own mount namespace and lists bind/CIFS/NFS mounts too.
    """
    points: set[str] = set()
    try:
        with open('/proc/self/mountinfo', 'r', encoding='utf-8') as fh:
            for line in fh:
                fields = line.rstrip('\\n').split()
                if len(fields) < 5:
                    continue
                points.add(_decode_mountinfo_path(fields[4]))
    except Exception:
        pass
    return points


def _has_real_mount_ancestor(root: Path) -> bool:
    """True when root sits on a mount below /mnt or /media.

    This deliberately ignores the filesystem root itself. A plain empty
    /mnt/foo directory on the Pi must still be treated as an unavailable share,
    while /mnt/foo supplied by CIFS/NFS/bind mount must be accepted.
    """
    try:
        resolved = root.resolve()
    except Exception:
        resolved = root

    candidates = [resolved, *resolved.parents]
    mount_points = _mountinfo_mount_points()
    for candidate in candidates:
        ps = str(candidate)
        if ps in ('/', '/mnt', '/media', ''):
            continue
        if not (ps.startswith('/mnt/') or ps.startswith('/media/')):
            continue
        if ps in mount_points or os.path.ismount(ps):
            return True
    return False


def _root_ready_to_scan(root: Path) -> tuple[bool, str]:
    """Skip dead mount placeholders without rejecting valid bind mounts.

    After a Pi reboot, /mnt/koko-kidabah etc. can remain as empty directories.
    Walking those placeholders and then marking files missing would hide the
    whole library. Older code used os.path.ismount() alone, which can reject
    perfectly valid bind mounts. We now consult /proc/self/mountinfo first.
    """
    if not root.exists() or not root.is_dir():
        return False, "missing_or_not_dir"
    if not os.access(root, os.R_OK | os.X_OK):
        return False, "not_readable"

    root_s = str(root)
    try:
        resolved_s = str(root.resolve())
    except Exception:
        resolved_s = root_s
    under_removable = any(
        s.startswith(prefix)
        for s in (root_s, resolved_s)
        for prefix in ("/mnt/", "/media/")
    )
    if under_removable and not _has_real_mount_ancestor(root):
        return False, "not_mounted"
    return True, "ok"
'''
if old not in text:
    raise SystemExit('Expected scanner mount guard block not found; refusing blind patch')
scanner.write_text(text.replace(old, new, 1), encoding='utf-8')

handoff = Path('SESSION_NEXT.md')
h = handoff.read_text(encoding='utf-8')
entry = '''## 2026-09-01 — PrintShelf mount readiness fix\n\n- PrintShelf watched folders could remain configured while the Library showed `0 designs / 0 files`. The scanner guarded `/mnt` and `/media` roots with `os.path.ismount()` only; Linux bind mounts can legitimately return false there because the bind target may share the same device as its parent.\n- Scanner readiness now reads `/proc/self/mountinfo`, which reflects the PrintShelf service's own mount namespace and recognises bind, CIFS and NFS mount points. `os.path.ismount()` remains a fallback. Dead empty `/mnt/...` placeholders are still refused so a reboot cannot mark the whole library missing.\n- Unreadable roots are also refused explicitly as `not_readable`.\n- Validation: `python -m py_compile printshelf/app/scanner.py` plus source guards for mountinfo/bind-mount handling.\n- Next physical gate: pull/restart PrintShelf on the Pi and Rescan. The existing Koko Kidabah, Kidabah PC and Mora Kidabah home watched folders should index again if their mounts are present.\n\n'''
marker = '# Flightdeck SESSION_NEXT'
if entry not in h:
    if marker in h:
        pos = h.find('\n', h.find(marker)) + 1
        h = h[:pos] + '\n' + entry + h[pos:]
    else:
        h = entry + h
    handoff.write_text(h, encoding='utf-8')
