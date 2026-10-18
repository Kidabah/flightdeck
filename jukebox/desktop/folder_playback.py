"""Desktop-only folder playback. Files stay on this PC/NAS, streamed on loopback."""
from __future__ import annotations
import json, mimetypes, os, queue, re, secrets, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

AUDIO = {'.mp3','.flac','.m4a','.aac','.ogg','.opus','.wav','.wma','.aiff','.aif'}
MAX_TRACKS = 10000
MAX_ENTRIES = 100000

def natural_key(value):
    return tuple((0,int(s)) if s.isdigit() else (1,s.casefold()) for s in re.split(r'(\d+)',str(value)))

def find_audio(folder):
    root = Path(folder)
    if not root.is_dir(): raise ValueError('That folder is unavailable. Check its drive or NAS connection.')
    found=[]; entries=0
    def failed(error): raise ValueError('Unable to read part of this folder. Check its permissions or NAS connection.') from error
    for base,dirs,names in os.walk(root,followlinks=False,onerror=failed):
        dirs[:] = sorted([d for d in dirs if d.casefold() not in {'#recycle','@eadir','$recycle.bin'} and not Path(base,d).is_symlink() and not getattr(Path(base,d),'is_junction',lambda:False)()],key=natural_key)
        entries += len(dirs)+len(names)
        if entries>MAX_ENTRIES: raise ValueError('That folder is too large. Choose an artist or album folder instead.')
        for name in names:
            path=Path(base,name)
            if path.suffix.casefold() in AUDIO and not path.is_symlink():
                found.append(path)
                if len(found)>MAX_TRACKS: raise ValueError('More than 10,000 songs found. Choose a smaller music folder.')
    found.sort(key=lambda p:natural_key(p.relative_to(root)))
    if not found: raise ValueError('No supported audio files found in that folder or its subfolders.')
    return root,found

def byte_range(header,size):
    if not header: return 0,size-1,False
    match=re.fullmatch(r'bytes=(\d*)-(\d*)',header.strip())
    if not match or not any(match.groups()): raise ValueError('Invalid byte range')
    first,last=match.groups()
    if first:
        start=int(first);end=min(int(last),size-1) if last else size-1
    else:
        length=int(last)
        if length<=0: raise ValueError('Invalid byte range')
        start=max(0,size-length);end=size-1
    if start>=size or start>end: raise ValueError('Unsatisfiable byte range')
    return start,end,True

class FolderPlayback:
    def __init__(self,info_path,origin):
        self.info_path=Path(info_path);self.origin=origin.rstrip('/');self.token=secrets.token_urlsafe(32)
        self.pending=queue.Queue(maxsize=1);self.files={};self.lock=threading.Lock()
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def allowed(self):
                return self.headers.get('Origin') in (None,owner.origin)
            def end_headers(self):
                if self.headers.get('Origin')==owner.origin:
                    self.send_header('Access-Control-Allow-Origin',owner.origin)
                    self.send_header('Vary','Origin')
                    self.send_header('Access-Control-Allow-Private-Network','true')
                self.send_header('Cache-Control','no-store')
                super().end_headers()
            def do_OPTIONS(self):
                if not self.allowed(): self.send_error(403);return
                self.send_response(204)
                self.send_header('Access-Control-Allow-Methods','GET, HEAD, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers','Content-Type, Range')
                self.end_headers()
            def do_POST(self):
                if not self.allowed() or self.path!='/'+owner.token+'/open':self.send_error(403);return
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<length<32768:raise ValueError()
                    request=json.loads(self.rfile.read(length))
                    folder=request['folder']
                    if not isinstance(folder,str) or not folder:raise ValueError()
                    owner.submit(folder)
                except (ValueError,KeyError,TypeError):self.send_error(400);return
                self.send_response(204);self.send_header('Content-Length','0');self.end_headers()
            def do_HEAD(self):self.stream(False)
            def do_GET(self):self.stream(True)
            def stream(self,body):
                if not self.allowed():self.send_error(403);return
                prefix='/'+owner.token+'/audio/'
                if not self.path.startswith(prefix):self.send_error(404);return
                ident=self.path[len(prefix):]
                with owner.lock:path=owner.files.get(ident)
                if path is None:self.send_error(404);return
                try:
                    file=path.open('rb')
                except OSError:self.send_error(404,'Audio file unavailable');return
                with file:
                    try:
                        size=os.fstat(file.fileno()).st_size
                    except OSError:
                        # Some SMB servers reject Windows' handle-size query (WinError 87).
                        # The path query works for the same already-open NAS file.
                        try: size=path.stat().st_size
                        except OSError: self.send_error(404,'Audio file unavailable');return
                    try:start,end,partial=byte_range(self.headers.get('Range'),size)
                    except ValueError:
                        self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.send_header('Content-Length','0');self.end_headers();return
                    self.send_response(206 if partial else 200)
                    content_type={'.flac':'audio/flac','.m4a':'audio/mp4','.opus':'audio/ogg'}.get(path.suffix.casefold(),mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
                    self.send_header('Content-Type',content_type);self.send_header('Accept-Ranges','bytes')
                    self.send_header('Content-Length',str(max(0,end-start+1)))
                    if partial:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
                    self.end_headers()
                    if not body:return
                    file.seek(start);remaining=end-start+1
                    try:
                        while remaining>0:
                            data=file.read(min(128*1024,remaining))
                            if not data:break
                            self.wfile.write(data);remaining-=len(data)
                    except (ConnectionError,OSError):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.server.daemon_threads=True
        self.base=f'http://127.0.0.1:{self.server.server_port}/{self.token}'
        threading.Thread(target=self.server.serve_forever,daemon=True,name='CindyFolderAudio').start()
        self.info_path.parent.mkdir(parents=True,exist_ok=True)
        temp=self.info_path.with_suffix('.tmp')
        temp.write_text(json.dumps({'port':self.server.server_port,'token':self.token}),encoding='utf-8')
        temp.replace(self.info_path)
    def submit(self,folder):
        try:self.pending.get_nowait()
        except queue.Empty:pass
        try:self.pending.put_nowait(folder)
        except queue.Full:pass
    def take(self):
        try:folder=self.pending.get_nowait()
        except queue.Empty:return None
        try:
            root,paths=find_audio(folder)
            tracks=[];files={}
            for index,path in enumerate(paths):
                ident=secrets.token_urlsafe(16);files[ident]=path
                tracks.append({'id':f'local:{ident}','title':path.stem,'artist':path.parent.name,'album':root.name,'albumId':f'local-folder:{root.name}','coverArt':None,'localUrl':f'{self.base}/audio/{ident}'})
            with self.lock:self.files=files
            return {'album':{'id':f'local-folder:{root.name}','name':root.name,'artist':'Folder playback','coverArt':None,'song':tracks,'local':True}}
        except (OSError,ValueError) as error:return {'error':str(error)}
    def close(self):
        self.server.shutdown();self.server.server_close()
        try:
            if json.loads(self.info_path.read_text()).get('token')==self.token:self.info_path.unlink()
        except (OSError,ValueError):pass

def forward_folder(info_path,folder):
    try:
        info=json.loads(Path(info_path).read_text(encoding='utf-8'))
        port=int(info['port']);token=info['token']
        if not 0<port<65536 or not re.fullmatch(r'[A-Za-z0-9_-]{40,64}',token):return False
        request=Request(f'http://127.0.0.1:{port}/{token}/open',data=json.dumps({'folder':folder}).encode(),headers={'Content-Type':'application/json'},method='POST')
        with urlopen(request,timeout=3) as response:return response.status==204
    except (OSError,ValueError,KeyError,TypeError):return False

FOLDER_BRIDGE = r'''
(function(){
  if(window.__cindyFolderPlayback)return;
  window.__cindyFolderPlayback=true;
  let busy=false;
  setInterval(async function(){
    const bridge=window.pywebview && window.pywebview.api;
    if(busy || !bridge || !bridge.take_folder_request || typeof loadAlbumIntoQueue!=='function')return;
    busy=true;
    try {
      const request=await bridge.take_folder_request();
      if(request && request.error)setStatus(request.error);
      else if(request && request.album){
        revokeLocalQueueUrls(state.queue);
        audio.crossOrigin='anonymous';
        loadAlbumIntoQueue(request.album,{autoplay:true});
      }
    }catch(error){console.warn('Folder playback request failed',error);}
    finally{busy=false;}
  },750);
})();
'''
