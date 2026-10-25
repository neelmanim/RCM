const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function run() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const versionData = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:9222/json/version', res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const newTarget = await new Promise((resolve, reject) => {
      const req = http.request('http://127.0.0.1:9222/json/new', { method: 'PUT' }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.end();
    });

    console.log('Opened target:', newTarget.webSocketDebuggerUrl);

    const ws = new WebSocket(newTarget.webSocketDebuggerUrl);
    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg);
        callbacks.delete(msg.id);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[CONSOLE]', msg.params.type, msg.params.args.map(a => a.value || a.description).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[EXCEPTION]', JSON.stringify(msg.params.exceptionDetails));
      }
      if (msg.method === 'Network.responseReceived') {
        console.log('[NET RESPONSE]', msg.params.response.status, msg.params.response.url);
      }
      if (msg.method === 'Network.loadingFailed') {
        console.error('[NET FAIL]', msg.params.errorText, msg.params.canceled, msg.params.type);
      }
    };

    await new Promise(resolve => ws.onopen = resolve);

    const send = (method, params = {}) => new Promise((resolve) => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Network.enable');
    await send('Page.enable');
    await send('Runtime.enable');

    const targetUrl = process.argv[2] || 'https://app.alternatecrm.com/sandbox.html';
    console.log('Navigating to:', targetUrl);
    await send('Page.navigate', { url: targetUrl });

    await new Promise(r => setTimeout(r, 5000));

    const locResult = await send('Runtime.evaluate', { expression: 'window.location.href' });
    console.log('Current URL:', locResult.result.result.value);

    const bodyResult = await send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText.substring(0, 300) : "NO BODY"'
    });
    console.log('Body text snippet:\n' + bodyResult.result.result.value);

    // Capture screenshot
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    if (screenshot.result && screenshot.result.data) {
      fs.writeFileSync('sandbox_test_screenshot.png', Buffer.from(screenshot.result.data, 'base64'));
      console.log('Screenshot saved to sandbox_test_screenshot.png');
    }

    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(console.error);
