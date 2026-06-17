from __future__ import annotations

import asyncio
import base64
import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

import nodriver as uc


def parse_query_name(url: str) -> str | None:
    try:
        parsed = urlparse(url)
        if parsed.hostname != 'graphql.haraj.com.sa':
            return None
        return parse_qs(parsed.query).get('queryName', [None])[0]
    except Exception:
        return None


@dataclass
class GraphqlCapture:
    tab: Any
    include_query_names: set[str]

    payloads: dict[str, dict[str, Any]] = field(default_factory=dict)
    events: dict[str, asyncio.Event] = field(default_factory=dict)
    requests: dict[str, dict[str, Any]] = field(default_factory=dict)
    replaying: set[str] = field(default_factory=set)
    started: bool = False

    async def start(self) -> 'GraphqlCapture':
        if self.started:
            return self
        self.started = True
        for name in self.include_query_names:
            self.events[name] = asyncio.Event()
        await self.tab.send(uc.cdp.network.enable(
            max_total_buffer_size=100_000_000,
            max_resource_buffer_size=50_000_000,
            max_post_data_size=10_000_000,
        ))
        self.tab.add_handler(uc.cdp.network.RequestWillBeSent, self._on_request)
        self.tab.add_handler(uc.cdp.network.ResponseReceived, self._on_response)
        return self

    def clear(self) -> None:
        self.payloads.clear()
        self.requests.clear()
        self.replaying.clear()
        for event in self.events.values():
            event.clear()

    async def _on_request(self, event):
        try:
            url = event.request.url
            qn = parse_query_name(url)
            if qn not in self.include_query_names:
                return

            post_data = getattr(event.request, 'post_data', None)
            if not post_data:
                try:
                    req_body = await self.tab.send(uc.cdp.network.get_request_post_data(event.request_id))
                    post_data = getattr(req_body, 'post_data', None)
                except Exception:
                    post_data = None

            existing = self.requests.get(qn)

            if existing and existing.get("post_data") and not post_data:
                print(f"[GQL REQUEST KEEP OLD BODY] qn={qn}")
            else:
                self.requests[qn] = {
                    "url": url,
                    "post_data": post_data,
                }
        except Exception as exc:
            # print(f'[GQL REQUEST ERROR] {exc!r}')
            return None

    async def _on_response(self, event):
        try:
            url = event.response.url
            qn = parse_query_name(url)
            if qn not in self.include_query_names:
                return
            if qn in self.replaying or qn in self.payloads:
                return

            # print(f'\n[GQL RESPONSE] qn={qn} status={event.response.status}')
            text = None
            try:
                body = await self.tab.send(uc.cdp.network.get_response_body(event.request_id))
                text = body.body or ''
                if getattr(body, 'base64_encoded', False):
                    text = base64.b64decode(text).decode('utf-8', errors='replace')
                # print(f'[GQL BODY FROM CDP] qn={qn} len={len(text)}')
            except Exception as exc:
                # print(f'[GQL CDP BODY FAILED] qn={qn}: {exc!r}')
                self.replaying.add(qn)
                try:
                    text = await self._replay_request(qn)
                finally:
                    self.replaying.discard(qn)

            if not text:
                # print(f'[GQL EMPTY BODY] qn={qn}')
                return

            data = json.loads(text)
            self.payloads[qn] = {'json': data, 'url': url}
            if qn in self.events:
                self.events[qn].set()

            if qn == 'posts':
                item = (((data.get('data') or {}).get('posts') or {}).get('items') or [None])[0]
                # print(f'[POSTS CAPTURED] id={item.get("id") if item else None}')
            elif qn == 'comments':
                items = (((data.get('data') or {}).get('comments') or {}).get('items') or [])
                # print(f'[COMMENTS CAPTURED] items={len(items)}')

            # print(f'[GQL CAPTURED] qn={qn}')
        except Exception as exc:
            # print(f'[GQL RESPONSE ERROR] ')
            return None

    async def _replay_request(self, qn: str) -> str | None:
        req = self.requests.get(qn) or {}
        url = req.get('url')
        post_data = req.get('post_data')
        if not url:
            # print(f'[GQL REPLAY SKIP] missing url qn={qn}')
            return None
        if not post_data:
            # print(f'[GQL REPLAY WARNING] missing body qn={qn}, using empty JSON')
            return None

        script = '''
        async (url, body) => {
          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: {
              "accept": "*/*",
              "content-type": "application/json",
              "referer": "https://haraj.com.sa/"
            },
            body
          });
          const text = await res.text();
          return JSON.stringify({ ok: res.ok, status: res.status, text });
        }
        '''
        arg_json = json.dumps([url, post_data], ensure_ascii=False)
        wrapped = f'''
        (() => {{
          const __args = {arg_json};
          return ({script})(...__args);
        }})()
        '''
        raw = await self.tab.evaluate(wrapped, await_promise=True)
        result = json.loads(raw)
        # print(f'[GQL REPLAY] qn={qn} status={result.get("status")} ok={result.get("ok")}')
        if not result.get('ok'):
            # print('[GQL REPLAY ERROR TEXT]')
            # print(str(result.get('text'))[:1000])
            return None
        return result.get('text')

    async def wait_for(self, want: list[str], timeout_ms: int) -> bool:
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        while asyncio.get_running_loop().time() < deadline:
            if all(name in self.payloads for name in want):
                return True
            await asyncio.sleep(0.1)
        missing = [name for name in want if name not in self.payloads]
        print(f'[GQL] wait timeout missing={missing}')
        return False

    def get_json(self, name: str) -> dict[str, Any] | None:
        payload = self.payloads.get(name)
        return payload.get('json') if payload else None


def attach_graphql_capture(tab, include_query_names: list[str]) -> GraphqlCapture:
    return GraphqlCapture(tab=tab, include_query_names=set(include_query_names))
