"""Server-only OpenAI monthly reporting. No chat key or credential leaves this module."""
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation, ROUND_CEILING


def month_before(month, count=1):
    for _ in range(count):
        month = (month - timedelta(days=1)).replace(day=1)
    return month


def history_summary(months, margin=25):
    active = [Decimal(str(row['spend'])) for row in months if row['spend'] > 0]
    average = sum(active) / len(active) if active else None
    suggestion = max(1, int((average * (1 + Decimal(str(margin)) / 100)).to_integral_value(rounding=ROUND_CEILING))) if average is not None else None
    return {'average':float(average) if average is not None else None,
            'active_months':len(active), 'suggested_budget':suggestion, 'margin_percent':margin}


def budget_value(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < Decimal('0.01') or amount > 1000000:
            raise ValueError()
        return float(amount.quantize(Decimal('0.01')))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError('Budget must be between $0.01 and $1,000,000 USD.') from None


class UsageTicker:
    def __init__(self, config, fetch=None, clock=time.time):
        self.config = config
        self.fetch = fetch or self._fetch
        self.clock = clock
        self.lock = threading.Lock()
        self.cached = {}
        self.checked = 0
        self.busy = False
        self.identity = None
        self.history = {}
        self.history_checked = 0
        self.history_busy = False
        self.history_identity = None

    @staticmethod
    def _fetch(path, params, key):
        request = urllib.request.Request(
            'https://api.openai.com/v1/organization/' + path + '?' + urllib.parse.urlencode(params, doseq=True),
            headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise RuntimeError('Reporting key lacks access. Check the OpenAI Admin API key.') from None
            raise RuntimeError('OpenAI reporting unavailable (HTTP %s).' % exc.code) from None
        except Exception:
            raise RuntimeError('Could not reach OpenAI reporting. Retrying automatically.') from None

    def _buckets(self, path, params, key):
        params = dict(params)
        seen = set()
        rows = []
        for _ in range(100):
            page = self.fetch(path, params, key)
            rows.extend(page['data'])
            if not page.get('has_more'):
                return rows
            cursor = page.get('next_page')
            if not cursor or cursor in seen:
                break
            seen.add(cursor)
            params['page'] = cursor
        raise RuntimeError('OpenAI reporting returned incomplete pagination.')

    def _rows(self, path, params, key):
        return [row for bucket in self._buckets(path, params, key) for row in bucket['results']]

    def _refresh_history(self, identity, key, projects, start):
        result = {}
        try:
            first = month_before(start, 6)
            params = {'start_time':int(first.timestamp()), 'end_time':int(start.timestamp()), 'bucket_width':'1d', 'limit':180}
            if projects:
                params['project_ids'] = projects
            totals = {month_before(start, n).strftime('%Y-%m'):Decimal('0') for n in range(6, 0, -1)}
            for bucket in self._buckets('costs', params, key):
                month = datetime.fromtimestamp(bucket['start_time'], timezone.utc).strftime('%Y-%m')
                if month not in totals:
                    continue
                for row in bucket['results']:
                    amount = row['amount']
                    value = Decimal(str(amount['value']))
                    if amount['currency'].lower() != 'usd' or not value.is_finite():
                        raise RuntimeError('Could not read monthly USD costs.')
                    totals[month] += value
            result = {'months':[{'month':month, 'spend':float(value)} for month, value in totals.items()],
                      'history_updated_at':self.clock(), 'history_error':''}
        except Exception as exc:
            result['history_error'] = str(exc) if isinstance(exc, RuntimeError) else 'Could not read monthly cost history.'
        with self.lock:
            if self.history_identity == identity:
                self.history.update(result)
                self.history_checked = self.clock()
            self.history_busy = False

    def _refresh(self, identity, key, params):
        result = {}
        errors = []
        try:
            rows = self._rows('costs', params, key)
            total = Decimal('0')
            for row in rows:
                amount = row['amount']
                if amount['currency'].lower() != 'usd':
                    raise RuntimeError('Reporting returned a currency other than USD.')
                value = Decimal(str(amount['value']))
                if not value.is_finite():
                    raise RuntimeError('Invalid reported cost.')
                total += value
            result['spend'] = float(total)
            result['cost_updated_at'] = self.clock()
        except Exception as exc:
            errors.append(str(exc) if isinstance(exc, RuntimeError) else 'Could not read OpenAI costs.')
        try:
            count = 0
            for category in ('completions', 'audio_speeches', 'audio_transcriptions', 'images', 'embeddings', 'moderations'):
                for row in self._rows('usage/' + category, params, key):
                    count += int(row['num_model_requests'])
            result['requests'] = count
            result['requests_updated_at'] = self.clock()
        except Exception as exc:
            errors.append(str(exc) if isinstance(exc, RuntimeError) else 'Could not read OpenAI request counts.')
        with self.lock:
            if self.identity == identity:
                self.cached.update(result)
                self.cached['error'] = ' '.join(dict.fromkeys(errors))
                self.checked = self.clock()
            self.busy = False

    def snapshot(self):
        config = self.config()
        key = str(os.environ.get('OPENAI_ADMIN_KEY') or config.get('openai_admin_key') or '').strip()
        projects = config.get('usage_project_ids') or []
        if not isinstance(projects, list) or not all(isinstance(p, str) for p in projects):
            projects = []
        now = datetime.fromtimestamp(self.clock(), timezone.utc)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        try:
            budget = budget_value(config.get('monthly_api_budget_usd', 20))
        except ValueError:
            budget = 20.0
        identity = (start.timestamp(), key, tuple(projects))
        with self.lock:
            if identity != self.identity:
                self.cached = {}
                self.checked = 0
                self.identity = identity
            if key and not self.busy and self.clock() - self.checked >= 300:
                self.busy = True
                params = {'start_time': int(start.timestamp()), 'end_time': int(now.timestamp()), 'bucket_width': '1d', 'limit': 31}
                if projects:
                    params['project_ids'] = projects
                threading.Thread(target=self._refresh, args=(identity, key, params), daemon=True).start()
            data = dict(self.cached)
            busy = self.busy
            if identity != self.history_identity:
                self.history_identity = identity
                self.history = {}
                self.history_checked = 0
            if key and not self.history_busy and self.clock() - self.history_checked >= 3600:
                self.history_busy = True
                threading.Thread(target=self._refresh_history, args=(identity,key,projects,start), daemon=True).start()
            history = dict(self.history)
            history_busy = self.history_busy
        spend = data.get('spend')
        percent = spend / budget * 100 if spend is not None else None
        elapsed = (now - start).total_seconds()
        projection = spend * (end - start).total_seconds() / elapsed if spend is not None and elapsed >= 86400 else None
        summary = history_summary(history.get('months', []))
        return dict(data, budget=budget, percent=percent,
                    history=history, history_loading=history_busy,
                    history_summary=summary, projected_spend=projection,
                    remaining=max(0, budget - spend) if spend is not None else None,
                    warning=next((n for n in (100, 80, 50) if percent is not None and percent >= n), None),
                    period_end=(end - timedelta(days=1)).strftime('%Y-%m-%d'),
                    estimated=True, scope='Selected projects' if projects else 'Whole OpenAI organization',
                    status='unconfigured' if not key else ('stale' if data.get('error') and spend is not None else 'error' if data.get('error') else 'loading' if busy else 'ready'))
