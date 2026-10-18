import unittest
from codex_usage import public_limits, CodexTicker

class CodexTests(unittest.TestCase):
    def test_bucket_selection_and_credential_omission(self):
        result = public_limits({'accountId':'private','accessToken':'secret','rateLimits':{'primary':{'usedPercent':99}},'rateLimitsByLimitId':{'codex':{'planType':'plus','primary':{'usedPercent':42,'windowDurationMins':300,'resetsAt':123},'secondary':{'usedPercent':7,'windowDurationMins':10080}}}})
        self.assertEqual([w['remaining_percent'] for w in result['windows']],[58,93])
        self.assertNotIn('secret',str(result))
        self.assertNotIn('private',str(result))
    def test_missing_limits_and_null_windows_are_unknown(self):
        for value in ({},{'rateLimits':{'primary':None}},{'rateLimits':{'primary':{'usedPercent':None}}}):
            with self.assertRaises(RuntimeError): public_limits(value)
    def test_failure_preserves_last_report_with_warning(self):
        def fetch(config): raise RuntimeError('Codex unavailable')
        ticker = CodexTicker(lambda:{},fetch=fetch,clock=lambda:1000)
        ticker.cached = {'windows':[{'remaining_percent':58}]}
        ticker.refresh()
        self.assertEqual(ticker.snapshot()['status'],'stale')
        self.assertEqual(ticker.snapshot()['windows'][0]['remaining_percent'],58)
        self.assertEqual(ticker.snapshot()['error'],'Codex unavailable')

if __name__ == '__main__': unittest.main()
