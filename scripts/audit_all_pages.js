const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'tablet',  width: 768,  height: 1024, mobile: true },
  { name: 'mobile',  width: 390,  height: 844,  mobile: true },
];

const PAGES = [
  { name: 'marketing_home',   url: 'https://www.alternatecrm.com/',         scrolls: [0, 1800, 3600, 5200] },
  { name: 'marketing_blog',   url: 'https://www.alternatecrm.com/blog',     scrolls: [0] },
  { name: 'marketing_status', url: 'https://www.alternatecrm.com/status',   scrolls: [0] },
  { name: 'login',            url: 'https://app.alternatecrm.com/login.html', scrolls: [0, 800] },
  { name: 'sandbox',          url: 'https://app.alternatecrm.com/sandbox',  scrolls: [0] },
];

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function capturePages(viewport) {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', `--remote-debugging-port=9222`,
    '--disable-gpu', '--no-sandbox',
    `--window-size=${viewport.width},${viewport.height}`
  ]);
  await delay(2500);

  try {
    for (const page of PAGES) {
      console.log(`[${viewport.name}] → ${page.url}`);
      const newTarget = await new Promise((resolve, reject) => {
        const req = http.request('http://127.0.0.1:9222/json/new', { method: 'PUT' }, res => {
          let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(JSON.parse(data)));
        }); req.on('error', reject); req.end();
      });

      const ws = new WebSocket(newTarget.webSocketDebuggerUrl);
      let msgId = 1; const callbacks = new Map();
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id && callbacks.has(m.id)) { callbacks.get(m.id)(m); callbacks.delete(m.id); }
      };
      await new Promise(r => ws.onopen = r);
      const send = (method, params = {}) => new Promise(resolve => {
        const id = msgId++; callbacks.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });

      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height,
        deviceScaleFactor: viewport.mobile ? 2 : 1,
        mobile: viewport.mobile
      });
      await send('Page.navigate', { url: page.url });
      await delay(page.url.includes('sandbox') ? 5000 : 4000);

      for (const scrollY of page.scrolls) {
        if (scrollY > 0) {
          await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${scrollY})` });
          await delay(600);
        }
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot.result?.data) {
          const fname = `audit_${page.name}_${viewport.name}_scroll${scrollY}.png`;
          fs.writeFileSync(fname, Buffer.from(shot.result.data, 'base64'));
          console.log(`  ✓ ${fname}`);
        }
      }
      ws.close();
      await delay(300);
    }
  } finally {
    chrome.kill();
  }
}

async function main() {
  for (const vp of VIEWPORTS) {
    await capturePages(vp);
    await delay(1000);
  }
  console.log('\nAll screenshots captured.');
}

main().catch(console.error);
