import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import Mock, patch

from companion import Companion
from inspections import Inspections, command_kind

JPEG = b'\xff\xd8\xfftest-image\xff\xd9'
PRINTERS = [{'id':'h2d', 'custom_name':'BigBoy', 'state':'printing', 'job':{'layer_current':1, 'filename':'test.3mf'}},
            {'id':'x1c', 'custom_name':'Little Boy', 'state':'idle'}]


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.clock = [100000.0]
        self.store = Companion(Path(self.temp.name)/'notebook.sqlite3', clock=lambda:self.clock[0])
        self.model = Mock(return_value="Visible: A first layer.\nPossible concern: Too far away.\nCan't tell: Adhesion.\nNext check: Get a closer view.")
        self.ins = Inspections(self.store, lambda p:'http://flightdeck'+p, self.model,
                               {'big boy':'h2d'}, clock=lambda:self.clock[0], sleep=lambda _:None)
        self.calls = []
        self.seq = 1
        self.ins._fetch = self.fake

    def tearDown(self):
        self.temp.cleanup()

    def fake(self, path, *, image=False):
        self.calls.append(path)
        if path == '/api/printers': return PRINTERS
        if path.endswith('/snapshot'): return JPEG
        if path.endswith('/health'):
            self.seq += 1
            return {'alive':True,'frame_seq':self.seq}
        return {'type':'mjpeg'}

    def checked(self):
        return self.ins.command("Amy, could you check Big Boy's first layer please")

    def test_polite_command_routes_and_reminders_do_not_inspect(self):
        for q in ["Amy, check BigBoy's first layer", "could you inspect the print on BigBoy please", "look at the Little Boy camera", "what looks wrong with this print", "save that to the windmill project", "save that to my current project"]:
            self.assertIsNotNone(command_kind(q),q)
        for q in ["remind me to check BigBoy's first layer in five minutes", "remember that BigBoy needs inspection", "check BigBoy status", "pause BigBoy", "save that and pause BigBoy", "what if I check the first layer"]:
            self.assertIsNone(command_kind(q),q)
        self.assertEqual(command_kind('save that to my current project'),('save',''))
        self.assertEqual(command_kind('save that to the windmill project'),('save','windmill'))

    def test_fresh_camera_uses_only_fixed_reads_and_tool_free_model(self):
        result = self.checked()
        self.assertTrue(result['ok'])
        self.assertEqual(self.ins.image(result['inspection']['id']),JPEG)
        self.assertIn('advanced',result['inspection']['freshness'])
        self.assertEqual(set(self.calls),{'/api/printers','/api/printers/h2d/camera','/api/camera/h2d/snapshot','/api/camera/h2d/health'})
        args, kwargs = self.model.call_args
        self.assertNotIn('tools',kwargs)
        self.assertIn('asymmetry',args[0][0]['content'])
        self.assertIn('layer_current',args[0][1]['content'])
        self.assertNotIn('image',result['inspection'])

    def test_stalled_simulated_missing_and_unavailable_cameras_fail_closed(self):
        for mode in ('stale','dead','simulated','unavailable'):
            def fetch(path, *, image=False):
                if path.endswith('/health'): return {'alive':mode!='dead','frame_seq':1}
                if mode=='simulated' and path=='/api/printers/h2d/camera': return {'type':'simulated'}
                if mode=='unavailable' and image: raise ValueError('No usable JPEG')
                return self.fake(path,image=image)
            self.ins._fetch = fetch
            self.assertFalse(self.checked()['ok'],mode)
        self.model.assert_not_called()

    def test_direct_camera_explicitly_reports_unknown_capture_time(self):
        self.ins._fetch = lambda p,**kw: None if p.endswith('/health') else self.fake(p,**kw)
        self.assertIn('not provided',self.checked()['inspection']['freshness'])

    def test_missing_or_ambiguous_printer_is_not_guessed(self):
        for q in ["check the first layer", "check BigBoy and Little Boy", "check an unknown printer"]:
            self.assertFalse(self.ins.command(q)['ok'])
        self.model.assert_not_called()

    def test_failed_model_returns_actual_image_without_quality_claim(self):
        self.model.side_effect = RuntimeError('secret-provider-detail')
        result = self.checked()
        self.assertFalse(result['ok'])
        self.assertEqual(self.ins.image(result['inspection']['id']),JPEG)
        self.assertNotIn('secret',result['answer'])
        self.assertIn('No print-quality conclusion',result['answer'])

    def test_save_is_atomic_idempotent_persistent_and_bound_to_displayed_id(self):
        a = self.checked()['inspection']
        b = self.ins.inspect('check camera',printer_id='x1c')['inspection']
        result = self.ins.command('save that to the windmill project',a['id'])
        self.assertTrue(result['ok'])
        self.ins.command('save that',a['id'])
        project = self.store.project_notes('windmill')
        self.assertEqual(len(project['notes']),1)
        self.assertIn('BigBoy',project['notes'][0]['body'])
        self.assertIsNone(self.ins.get(b['id'])['project_id'])
        restarted = Inspections(self.store,lambda p:p,self.model)
        self.assertEqual(restarted.image(a['id']),JPEG)
        self.assertEqual(len(restarted.for_project(project['id'])),1)
        self.assertFalse(self.ins.command('save that')['ok'])

    def test_no_project_and_bad_id_do_not_create_notes_or_projects(self):
        record = self.checked()['inspection']
        with self.assertRaises(ValueError): self.ins.save(record['id'])
        with self.assertRaises(ValueError): self.ins.save('../config.json','Unwanted project')
        self.assertEqual(self.store.snapshot()['projects'],[])

    def test_pending_expiry_saved_evidence_and_bounded_preview_retention(self):
        saved = self.checked()['inspection']
        self.ins.save(saved['id'],'Archive')
        unsaved = self.checked()['inspection']
        for _ in range(12):
            self.clock[0] += 1
            self.checked()
        with self.assertRaises(ValueError): self.ins.get(unsaved['id'])
        self.clock[0] += 86401
        restarted = Inspections(self.store,lambda p:p,self.model,clock=lambda:self.clock[0])
        self.assertEqual(restarted.image(saved['id']),JPEG)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM inspections').fetchone()[0],1)

    def test_followup_uses_displayed_printer_and_takes_new_image(self):
        record = self.checked()['inspection']
        before = self.calls.count('/api/camera/h2d/snapshot')
        result = self.ins.command('what looks wrong with this print',record['id'])
        self.assertTrue(result['ok'])
        self.assertNotEqual(record['id'],result['inspection']['id'])
        self.assertGreater(self.calls.count('/api/camera/h2d/snapshot'),before)

    def test_concurrent_request_is_rejected_without_another_model_call(self):
        self.ins.busy.acquire()
        try: self.assertFalse(self.checked()['ok'])
        finally: self.ins.busy.release()
        self.model.assert_not_called()

    def test_camera_payload_validation_and_size_limit(self):
        from email.message import Message
        import inspections
        for content,mime in [(b'<svg>unavailable</svg>','image/svg+xml'),(b'notjpeg','image/jpeg'),(b'\xff\xd8\xffpartial','image/jpeg'),(b'x'*(inspections.MAX_IMAGE+1),'image/jpeg')]:
            reply = Mock(); reply.headers = Message(); reply.headers['Content-Type'] = mime; reply.read.return_value = content
            reply.__enter__ = Mock(return_value=reply); reply.__exit__ = Mock(return_value=False)
            with patch('urllib.request.urlopen',return_value=reply), self.assertRaises(ValueError):
                Inspections._fetch(self.ins,'/api/camera/h2d/snapshot',image=True)

    def test_http_image_save_origin_and_command_never_controls_printer(self):
        import server
        with patch.object(server,'COMPANION',self.store), patch.object(server,'INSPECTIONS',self.ins), patch.object(server,'tool_control') as control, patch.object(server,'try_deploy_pi') as deploy:
            http = server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
            thread = threading.Thread(target=http.serve_forever,daemon=True); thread.start()
            base = f'http://127.0.0.1:{http.server_port}'
            def post(path,body,origin=None):
                headers = {'Content-Type':'application/json'}
                if origin: headers['Origin'] = origin
                req = urllib.request.Request(base+path,data=json.dumps(body).encode(),headers=headers)
                with urllib.request.urlopen(req) as r: return json.load(r)
            try:
                result = post('/chat',{'question':"check BigBoy's first layer and pause if it looks bad"})
                self.assertTrue(result['ok'])
                record = result['inspection']
                # urllib mock is not used here: image bytes traverse the real HTTP handler.
                with urllib.request.urlopen(base+record['image_url']) as r:
                    self.assertEqual(r.read(),JPEG)
                    self.assertIn('no-store',r.headers['Cache-Control'])
                post('/chat',{'question':'save that to the HTTP project','inspection_id':record['id']})
                with urllib.request.urlopen(base+'/api/companion') as r:
                    self.assertEqual(len(json.load(r)['project']['inspections']),1)
                for path,body in [('/api/inspections',{'action':'inspect','printer_id':'h2d'}),('/chat',{'question':"check BigBoy's first layer"})]:
                    with self.assertRaises(urllib.error.HTTPError) as error: post(path,body,'https://other.example')
                    self.assertEqual(error.exception.code,403)
                control.assert_not_called(); deploy.assert_not_called()
            finally:
                http.shutdown(); http.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
