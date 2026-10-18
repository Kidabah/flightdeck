"""Read-only Codex allowance reporting through the local app-server protocol."""
import json
import math
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time


def codex_executable(config):
    configured = config.get('codex_cli_path')
    if configured and Path(configured).is_file():
        return str(configured)
    local = Path(os.environ.get('LOCALAPPDATA', '')) / 'OpenAI' / 'Codex' / 'bin'
    candidates = list(local.glob('*/codex.exe')) if local.is_dir() else []
    if candidates:
        return str(max(candidates, key=lambda p:p.stat().st_mtime))
    found = shutil.which('codex.exe' if os.name == 'nt' else 'codex')
    if found:
        return found
    raise RuntimeError('Codex CLI not found. Install Codex or configure its executable path.')


def read_limits(config):
    process = subprocess.Popen([codex_executable(config), 'app-server', '--stdio'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    messages = queue.Queue()
    profile_unavailable = threading.Event()
    def read_errors():
        for line in process.stderr:
            if 'Could not find home directory' in line:
                profile_unavailable.set()
    threading.Thread(target=read_errors,daemon=True).start()
    def reader():
        try:
            for line in process.stdout:
                try: messages.put(json.loads(line))
                except ValueError: pass
        finally: messages.put(None)
    threading.Thread(target=reader, daemon=True).start()
    def send(message):
        process.stdin.write(json.dumps(message) + '\n')
        process.stdin.flush()
    def response(request_id):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try: message = messages.get(timeout=max(.01,deadline-time.monotonic()))
            except queue.Empty: break
            if message is None:
                if profile_unavailable.is_set():
                    raise RuntimeError('Codex cannot access the Windows profile. Launch Amy from your normal desktop shortcut.')
                raise RuntimeError('Codex connection closed. Check the local Codex sign-in and configuration.')
            if message.get('id') == request_id:
                if 'error' in message:
                    raise RuntimeError('Codex allowance reporting unavailable. Check your Codex sign-in.')
                return message['result']
        raise RuntimeError('Codex reporting timed out. Retrying automatically.')
    try:
        send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'amy_usage','title':'Amy allowance ticker','version':'1.0'}}})
        response(1)
        send({'method':'initialized','params':{}})
        send({'id':2,'method':'account/rateLimits/read'})
        return response(2)
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=3)
        for pipe in (process.stdin,process.stdout,process.stderr):
            if pipe: pipe.close()


def public_limits(result):
    buckets = result.get('rateLimitsByLimitId') or {}
    bucket = buckets.get('codex') or result.get('rateLimits')
    if not bucket:
        raise RuntimeError('No Codex allowance returned. Sign in to Codex with your ChatGPT account.')
    windows = []
    for name in ('primary','secondary'):
        window = bucket.get(name)
        if not window: continue
        used = window.get('usedPercent')
        if used is None: continue
        used = float(used)
        if not math.isfinite(used): raise RuntimeError('Invalid Codex allowance returned.')
        windows.append({'used_percent':max(0,min(100,used)),
                        'remaining_percent':max(0,min(100,100-used)),
                        'duration_minutes':window.get('windowDurationMins'),
                        'resets_at':window.get('resetsAt')})
    if not windows: raise RuntimeError('Codex allowance figures are unavailable.')
    return {'windows':windows,'plan':bucket.get('planType')}


class CodexTicker:
    def __init__(self, config, fetch=read_limits, clock=time.time):
        self.config, self.fetch, self.clock = config, fetch, clock
        self.lock = threading.Lock()
        self.cached, self.checked, self.busy = {}, 0, False

    def refresh(self):
        try:
            result = public_limits(self.fetch(self.config()))
            result.update(updated_at=self.clock(), error='')
        except Exception as exc:
            result = {'error':str(exc) if isinstance(exc,RuntimeError) else 'Could not connect to local Codex. Retrying automatically.'}
        with self.lock:
            self.cached.update(result)
            self.checked, self.busy = self.clock(), False

    def snapshot(self):
        with self.lock:
            if not self.busy and self.clock()-self.checked >= 300:
                self.busy = True
                threading.Thread(target=self.refresh,daemon=True).start()
            result = dict(self.cached)
            result['status'] = 'stale' if result.get('error') and result.get('windows') else 'error' if result.get('error') else 'loading' if self.busy else 'ready'
            return result
