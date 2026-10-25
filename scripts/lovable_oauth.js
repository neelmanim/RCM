const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CLIENT_ID = '6d465f583e1e4ce5801b1616f735670c';
const PORT = 8085;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

// 1. Generate PKCE Verifier & Challenge
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(24).toString('hex'); // 48 chars

const authUrl = `https://lovable.dev/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&scope=projects%3Aread+projects%3Awrite+workspaces%3Aread+workspaces%3Awrite`;

console.log('\n===============================================================');
console.log('🚀 LOVABLE OAUTH LOGIN');
console.log('===============================================================');
console.log('Please open this URL in your browser to authorize Lovable:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://127.0.0.1:8085/callback ...\n');

// Open URL in Windows default browser
exec(`start "" "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  
  if (reqUrl.pathname === '/callback') {
    const code = reqUrl.searchParams.get('code');
    const returnedState = reqUrl.searchParams.get('state');
    const error = reqUrl.searchParams.get('error');
    const errorDesc = reqUrl.searchParams.get('error_description');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>Authentication Failed</h1><p>${error}: ${errorDesc}</p>`);
      console.error(`Auth Error: ${error} - ${errorDesc}`);
      server.close();
      process.exit(1);
      return;
    }

    if (returnedState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>State mismatch error</h1>');
      server.close();
      process.exit(1);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: white;">
          <div style="text-align: center; background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155;">
            <h1 style="color: #6366f1;">✅ Lovable Authenticated!</h1>
            <p>You can close this tab now. The assistant is creating your project mockup.</p>
          </div>
        </body>
      </html>
    `);

    console.log('Authorization code received! Exchanging for token...');

    try {
      const tokenData = await exchangeCodeForToken(code, verifier);
      const tokenPath = path.resolve(__dirname, '../../.agents/lovable_token.json');
      fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
      console.log(`\n🎉 Access Token saved to ${tokenPath}`);
      console.log('Token expires in:', tokenData.expires_in, 'seconds');
      server.close();
      process.exit(0);
    } catch (err) {
      console.error('Failed to exchange code for token:', err);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(PORT, '127.0.0.1');

function exchangeCodeForToken(code, codeVerifier) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    const postData = params.toString();

    const options = {
      hostname: 'lovable.dev',
      port: 443,
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${response.statusCode}: ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    request.on('error', (e) => reject(e));
    request.write(postData);
    request.end();
  });
}
