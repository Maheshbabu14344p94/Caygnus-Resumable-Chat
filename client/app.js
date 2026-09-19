const statusEl = document.querySelector('#status');
const runEl = document.querySelector('#run');
const cursorEl = document.querySelector('#cursor');
const countEl = document.querySelector('#count');
const outputEl = document.querySelector('#output');
const logEl = document.querySelector('#log');
const interruptEl = document.querySelector('#interrupt');
const startEl = document.querySelector('#start');

let runId = null;
let cursor = 0;
let source = null;
let retryTimer = null;
let stopped = false;
let events = [];
let manualInterruption = false;

const setStatus = (status) => {
    statusEl.textContent = `● ${status}`;
    statusEl.className = `status ${status}`;
};

const log = (message) => {
    logEl.textContent += `${new Date().toLocaleTimeString()} ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
};

function connect() {
    if (!runId || stopped) {
        return;
    }

    clearTimeout(retryTimer);

    setStatus(cursor ? 'reconnecting' : 'connected');

    log(`connecting with cursor ${cursor}`);

    source?.close();

    source = new EventSource(
        `/api/runs/${encodeURIComponent(runId)}/events?after=${cursor}`
    );

    const handle = (eventMessage) => {
        const event = JSON.parse(eventMessage.data);

        // Defensive client-side deduplication.
        if (event.seq <= cursor) {
            log(`ignored duplicate seq=${event.seq}`);
            return;
        }

        // Never silently accept a gap.
        if (event.seq !== cursor + 1) {
            log(`gap detected: expected ${cursor + 1}, got ${event.seq}`);

            source.close();

            retryTimer = setTimeout(() => {
                connect();
            }, 500);

            return;
        }

        cursor = event.seq;
        events.push(event);

        cursorEl.textContent = cursor;
        countEl.textContent = events.length;

        if (event.type === 'text_delta') {
            if (outputEl.textContent === 'Waiting for a run…') {
                outputEl.textContent = '';
            }

            outputEl.textContent += event.payload.text;
        }

        if (event.type === 'completed') {
            setStatus('completed');
            log('run completed');

            source.close();

            interruptEl.disabled = true;
            startEl.disabled = false;
        }

        if (event.type === 'failed') {
            setStatus('failed');
            log(`run failed: ${event.payload?.error || 'unknown'}`);

            source.close();

            interruptEl.disabled = true;
            startEl.disabled = false;
        }
    };

    source.addEventListener('text_delta', handle);
    source.addEventListener('completed', handle);
    source.addEventListener('failed', handle);

    source.onopen = () => {
        setStatus('connected');
        log('SSE connected');

        // The run is active, so interruption is available.
        interruptEl.disabled = false;
    };

    source.onerror = () => {
        source.close();

        if (!stopped) {
            setStatus('reconnecting');

            log(`SSE connection lost; reconnecting from cursor ${cursor}`);

            retryTimer = setTimeout(() => {
                connect();
            }, 500);
        }
    };
}

startEl.onclick = async () => {
    stopped = false;
    manualInterruption = false;

    clearTimeout(retryTimer);
    source?.close();

    events = [];
    cursor = 0;

    outputEl.textContent = 'Waiting for a run…';
    logEl.textContent = '';

    interruptEl.disabled = true;
    startEl.disabled = true;

    const messageId = `msg_${crypto.randomUUID()}`;
    const conversationId = 'demo-conversation';

    try {
        const response = await fetch(
            `/api/conversations/${conversationId}/messages`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    messageId,
                    content: document.querySelector('#message').value
                })
            }
        );

        const body = await response.json();

        if (!response.ok) {
            log(`ERROR ${body.error}`);
            setStatus('failed');

            startEl.disabled = false;
            interruptEl.disabled = true;

            return;
        }

        runId = body.runId;

        runEl.textContent = runId;
        cursorEl.textContent = '0';
        countEl.textContent = '0';

        // IMPORTANT:
        // The run now exists, so the interruption control is available.
        interruptEl.disabled = false;

        connect();
    } catch (error) {
        log(`ERROR ${error.message}`);
        setStatus('failed');

        startEl.disabled = false;
        interruptEl.disabled = true;
    }
};


/*
 * Demo-only connection interruption.
 *
 * This intentionally closes the SSE connection while keeping
 * the run alive. The server continues generating and persisting
 * events. The client then reconnects using the last durable cursor.
 */
interruptEl.onclick = () => {
    if (!runId || !source) {
        return;
    }

    manualInterruption = true;

    log(`DEMO: intentionally interrupting SSE at cursor ${cursor}`);

    setStatus('disconnected');

    source.close();
    source = null;

    // Prevent a second click during the simulated outage.
    interruptEl.disabled = true;

    log(`DEMO: reconnecting from cursor ${cursor}`);

    retryTimer = setTimeout(() => {
        manualInterruption = false;

        log(`DEMO: reconnect from cursor ${cursor}`);

        connect();
    }, 1200);
};


window.addEventListener('beforeunload', () => {
    stopped = true;

    clearTimeout(retryTimer);

    source?.close();
});