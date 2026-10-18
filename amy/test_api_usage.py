import unittest
from datetime import datetime, timezone
from api_usage import UsageTicker, budget_value, history_summary


class UsageTests(unittest.TestCase):
    def test_budget_validation(self):
        for value in (0, -1, 'NaN', 'Infinity', None, .001):
            with self.assertRaises(ValueError):
                budget_value(value)
        self.assertEqual(budget_value('20.00'), 20)

    def test_pagination_costs_and_model_requests(self):
        calls = []
        def fetch(path, params, key):
            calls.append((path, dict(params)))
            if path == 'costs':
                return {'data':[{'results':[{'amount':{'value':8 if params.get('page') else 10,'currency':'usd'}}]}], 'has_more':not bool(params.get('page')), 'next_page':'next'}
            return {'data':[{'results':[{'num_model_requests':2}]}], 'has_more':False}
        ticker = UsageTicker(lambda:{}, fetch=fetch)
        ticker.identity = ('month',)
        ticker._refresh(('month',), 'secret', {'start_time':1})
        self.assertEqual(ticker.cached['spend'], 18)
        self.assertEqual(ticker.cached['requests'], 12)
        self.assertEqual(len(calls), 8)
        self.assertEqual(ticker.cached['error'], '')

    def test_thresholds_stale_cache_and_new_month(self):
        now = [datetime(2026, 10, 3, tzinfo=timezone.utc).timestamp()]
        ticker = UsageTicker(lambda:{'openai_admin_key':'secret'}, clock=lambda:now[0])
        ticker.busy = True  # Controlled fixture avoids network calls.
        ticker.history_busy = True
        ticker.snapshot()
        for spend, warning in ((9,None),(10,50),(16,80),(20,100),(25,100)):
            ticker.cached = {'spend':spend, 'requests':4}
            result = ticker.snapshot()
            self.assertEqual(result['warning'], warning)
            self.assertEqual(result['remaining'], max(0,20-spend))
            self.assertNotIn('secret', str(result))
        ticker.cached['error'] = 'Temporarily unavailable'
        self.assertEqual(ticker.snapshot()['status'], 'stale')
        now[0] = datetime(2026,11,1,tzinfo=timezone.utc).timestamp()
        result = ticker.snapshot()
        self.assertNotIn('spend',result)
        self.assertEqual(result['period_end'], '2026-11-30')

    def test_partial_pagination_does_not_publish_partial_total(self):
        def fetch(path, params, key):
            if path == 'costs':
                return {'data':[{'results':[{'amount':{'value':10,'currency':'usd'}}]}], 'has_more':True, 'next_page':'repeated'}
            return {'data':[], 'has_more':False}
        ticker = UsageTicker(lambda:{}, fetch=fetch)
        ticker._refresh(None, 'secret', {})
        self.assertNotIn('spend',ticker.cached)
        self.assertIn('pagination',ticker.cached['error'])

    def test_history_month_boundaries_pagination_and_scope(self):
        calls = []
        def fetch(path, params, key):
            calls.append(dict(params))
            day = datetime(2025, 12 if params.get('page') else 11, 15, tzinfo=timezone.utc)
            return {'data':[{'start_time':int(day.timestamp()),'results':[{'amount':{'value':3.2,'currency':'usd'}}]}], 'has_more':not bool(params.get('page')), 'next_page':'second'}
        ticker = UsageTicker(lambda:{}, fetch=fetch)
        ticker.history_identity = 'fixture'
        ticker._refresh_history('fixture','secret',['project-a'],datetime(2026,1,1,tzinfo=timezone.utc))
        months = ticker.history['months']
        self.assertEqual([m['month'] for m in months], ['2025-07','2025-08','2025-09','2025-10','2025-11','2025-12'])
        self.assertEqual([m['spend'] for m in months], [0,0,0,0,3.2,3.2])
        self.assertEqual(calls[0]['project_ids'], ['project-a'])
        self.assertEqual(calls[0]['end_time'], int(datetime(2026,1,1,tzinfo=timezone.utc).timestamp()))
        self.assertEqual(history_summary(months)['suggested_budget'],4)
        self.assertIsNone(history_summary([{'spend':0}])['suggested_budget'])

    def test_history_failure_retains_last_complete_report(self):
        def fail(*args):
            raise RuntimeError('Reporting unavailable')
        ticker = UsageTicker(lambda:{},fetch=fail)
        ticker.history = {'months':[{'month':'2026-09','spend':10}]}
        ticker._refresh_history(None,'secret',[],datetime(2026,10,1,tzinfo=timezone.utc))
        self.assertEqual(ticker.history['months'][0]['spend'],10)
        self.assertEqual(ticker.history['history_error'],'Reporting unavailable')


if __name__ == '__main__':
    unittest.main()
