import copy
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

from companion import Companion
from printer_status import is_status_question, format_printer

YES = [
    'tell me what is currently printing on bigboy',
    'Amy, could you tell me what is currently printing on Big Boy please?',
    "what's printing on BigBoy?", 'what is BigBoy doing?',
    'what file is BigBoy printing?', 'which model is running on BigBoy?',
    'show me the status of BigBoy', 'check what is printing on BigBoy',
    'what is on the printers?', 'how far along is BigBoy?',
    'how long does BigBoy have left?', 'when will BigBoy finish?',
    'is BigBoy paused?', 'has BigBoy finished?', 'BigBoy status',
    'what is Little Boy printing?', 'what is currently printing?',
    'what are BigBoy and Big Girl doing?',
]
# Status never turns a reminder, new print request or visual inspection into a poll.
NO = [
    'remind me to check what is printing on BigBoy in five minutes',
    'remember that BigBoy is printing a vase', 'pause BigBoy', 'resume BigBoy',
    'print vase on BigBoy', "check BigBoy's first layer", 'inspect BigBoy camera',
    'what does this print look like?', 'what should I print on BigBoy?',
    'how do I print a vase on BigBoy?', 'what is a good model for BigBoy?',
    'how is the weather?', 'what is currently playing on Spotify?',
]

ROW = {'id':'h2d','custom_name':'BigBoy','state':'printing','job':{
    'subtask_name':'7x4stringbase76_', 'filename':'/data/Metadata/plate_1.gcode',
    'progress':0.9,'layer_current':86,'layer_total':97,'eta_seconds':2820,
}}
ROWS = [ROW,{'id':'x1c','custom_name':'Little Boy','state':'idle','job':None},
        {'id':'o1c2','custom_name':'Big Girl','state':'idle','job':None}]


class PrinterStatusTests(unittest.TestCase):
    def test_normal_spoken_status_variants_and_command_boundaries(self):
        for q in YES: self.assertTrue(is_status_question(q),q)
        for q in NO: self.assertFalse(is_status_question(q),q)

    def test_flightdeck_job_schema_is_formatted_correctly(self):
        answer = format_printer(ROW)
        for text in ['7x4stringbase76_','90 percent','86 of 97','47 minutes']:
            self.assertIn(text,answer)
        self.assertNotIn('plate_1.gcode',answer)

    def test_missing_title_uses_filename_and_preserves_zero_progress(self):
        row=copy.deepcopy(ROW); row['job'].pop('subtask_name'); row['job']['progress']=0
        answer=format_printer(row)
        self.assertIn('plate_1.gcode',answer)
        self.assertIn('0 percent',answer)
        self.assertNotIn('/data/',answer)
        row['job']={}
        self.assertIn("hasn't supplied the job name",format_printer(row))

    def test_offline_idle_finished_and_paused_do_not_claim_active_printing(self):
        for state in ['offline','idle','finished','paused','error']:
            row=copy.deepcopy(ROW); row['state']=state
            answer=format_printer(row)
            self.assertNotIn('BigBoy is printing',answer,state)
            self.assertNotIn('remaining',answer,state)
            if state in ('offline','idle'): self.assertNotIn('7x4stringbase76_',answer,state)

    def test_bad_numeric_metadata_is_not_spoken_as_fact(self):
        row=copy.deepcopy(ROW); row['job'].update(progress=float('nan'),layer_current=-1,eta_seconds='oops')
        answer=format_printer(row)
        self.assertNotIn('percent',answer); self.assertNotIn('layer',answer); self.assertNotIn('remaining',answer)

    def test_http_exact_question_both_modes_uses_only_live_status_reads(self):
        import server
        with tempfile.TemporaryDirectory() as temp:
            store=Companion(Path(temp)/'notebook.sqlite3')
            old_mode=server.RUNTIME.get('talk_mode')
            with patch.object(server,'COMPANION',store), \
                 patch.object(server,'http_json',return_value=(200,ROWS)) as read, \
                 patch.object(server,'openai_chat_with_web',side_effect=AssertionError('model called')), \
                 patch.object(server,'openai_reply',side_effect=AssertionError('model called')), \
                 patch.object(server,'tool_control',side_effect=AssertionError('printer control called')), \
                 patch.object(server,'tool_calibrate',side_effect=AssertionError('calibration called')), \
                 patch.object(server,'inspections',side_effect=AssertionError('camera called')):
                http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
                thread=threading.Thread(target=http.serve_forever,daemon=True); thread.start()
                try:
                    for mode in ('casual','print'):
                        server.RUNTIME['talk_mode']=mode
                        for q in [YES[0],YES[1], 'is BigBoy paused?', 'check what is printing on BigBoy', 'what is Little Boy printing?']:
                            request=urllib.request.Request(f'http://127.0.0.1:{http.server_port}/chat',json.dumps({'question':q}).encode(),{'Content-Type':'application/json'})
                            with urllib.request.urlopen(request,timeout=5) as r: payload=json.load(r)
                            self.assertEqual(payload['tool'],'status')
                            self.assertEqual(payload['talk_mode'],mode)
                            self.assertTrue(payload['ok'])
                    for call in read.call_args_list:
                        self.assertTrue(call.args[0].endswith('/api/printers'))
                        self.assertEqual(call.kwargs.get('method','GET'),'GET')
                    # Reminder text containing a status question is still a reminder.
                    result=server.try_tools('remind me to check what is printing on BigBoy in five minutes')
                    self.assertEqual(result['tool'],'companion')
                    with patch.object(server,'http_json',return_value=(503,{})):
                        result=server.try_tools(YES[0])
                        self.assertFalse(result['ok']); self.assertEqual(result['tool'],'status')
                    for q,ids in [('what are BigBoy and Big Girl doing?',['h2d','o1c2']),('what is currently printing?',['h2d','x1c','o1c2'])]:
                        self.assertEqual(server.try_tools(q)['printer_ids'],ids)
                    self.assertFalse(server.try_tools('what is currently printing on an unknown printer')['ok'])
                finally:
                    server.RUNTIME['talk_mode']=old_mode
                    http.shutdown(); http.server_close(); thread.join()


if __name__=='__main__': unittest.main()
