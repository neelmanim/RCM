const fs = require('fs');
const path = require('path');
const https = require('https');

const tokenPath = path.resolve(__dirname, '../../.agents/lovable_token.json');
const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const accessToken = tokenData.access_token;
const projectId = '629ceb0f-1820-4699-8b40-8a063eeadbf6';

async function callMcpTool(toolName, args = {}) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'mcp.lovable.dev',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          let jsonStr = data.trim();
          if (jsonStr.includes('data:')) {
            const lines = jsonStr.split('\n');
            const dataLine = lines.find(l => l.startsWith('data:'));
            if (dataLine) jsonStr = dataLine.replace(/^data:\s*/, '');
          }
          const parsed = JSON.parse(jsonStr);
          if (parsed.error) reject(new Error(`MCP Error: ${JSON.stringify(parsed.error)}`));
          else resolve(parsed.result);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log(`Deploying project ${projectId}...`);
  try {
    const res = await callMcpTool('deploy_project', { project_id: projectId });
    console.log('\n===============================================================');
    console.log('🚀 PROJECT DEPLOYED!');
    console.log('===============================================================');
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Deploy error:', e);
  }
}

run();
