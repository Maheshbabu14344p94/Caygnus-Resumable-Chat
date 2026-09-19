import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createServer({ runService, store, hub, clientDir }) {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  async function body(req) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }
  function sendEvent(res, event) {
    res.write(`id: ${event.seq}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname === '/api/health') return json(res, 200, { ok: true });

      const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (req.method === 'POST' && messageMatch) {
        const data = await body(req);
        if (!data.messageId || typeof data.content !== 'string' || !data.content.trim()) return json(res, 400, { error: 'messageId and non-empty content are required' });
        const run = runService.createRun({ conversationId: decodeURIComponent(messageMatch[1]), userMessageId: data.messageId, content: data.content.trim() });
        return json(res, 201, { runId: run.id, conversationId: run.conversationId, messageId: run.userMessageId, status: run.status, cursor: run.lastSeq });
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'GET' && runMatch) {
        const run = runService.getRun(decodeURIComponent(runMatch[1]));
        return run ? json(res, 200, run) : json(res, 404, { error: 'RUN_NOT_FOUND' });
      }

      const historyMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events\/history$/);
      if (req.method === 'GET' && historyMatch) {
        const run = runService.getRun(decodeURIComponent(historyMatch[1]));
        return run ? json(res, 200, { run, events: store.allEvents(run.id) }) : json(res, 404, { error: 'RUN_NOT_FOUND' });
      }

      const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (req.method === 'GET' && eventsMatch) {
        const runId = decodeURIComponent(eventsMatch[1]);
        const run = runService.getRun(runId);
        if (!run) return json(res, 404, { error: 'RUN_NOT_FOUND' });
        const rawCursor = url.searchParams.get('after');
        const cursor = rawCursor === null ? 0 : Number(rawCursor);
        if (!Number.isInteger(cursor) || cursor < 0) return json(res, 400, { error: 'INVALID_CURSOR', recoverable: true });
        if (cursor > run.lastSeq) return json(res, 409, { error: 'CURSOR_AHEAD_OF_SERVER', recoverable: true, serverCursor: run.lastSeq });

        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
        res.write(': connected\n\n');
        let replaying = true;
        const buffered = [];
        const unsubscribe = hub.subscribe(runId, (event) => replaying ? buffered.push(event) : sendEvent(res, event));
        const boundary = runService.getRun(runId).lastSeq;
        const replay = runService.events(runId, cursor, boundary);
        for (const event of replay) sendEvent(res, event);
        const replaySeqs = new Set(replay.map((event) => event.seq));
        replaying = false;
        for (const event of buffered.sort((a, b) => a.seq - b.seq)) if (event.seq > boundary && !replaySeqs.has(event.seq)) sendEvent(res, event);
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 10000);
        req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
        return;
      }

      const filePath = url.pathname === '/' ? path.join(clientDir, 'index.html') : path.join(clientDir, url.pathname.replace(/^\//, ''));
      if (filePath.startsWith(clientDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream' });
        return fs.createReadStream(filePath).pipe(res);
      }
      json(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}

export function projectRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); }
