const { spawn } = require('node:child_process');
const profile = Number(process.argv[2] || 2);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  `--user-data-dir=D:/Auto/ChromeProxy/Profile${String(profile).padStart(2,'0')}`,
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--no-first-run',
  'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html'
], { stdio: ['ignore','ignore','ignore','pipe','pipe'], windowsHide: true });
let id = 0, buf = '', pending = new Map();
chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', chunk => { buf += chunk; const parts = buf.split('\0'); buf = parts.pop();
  for (const part of parts) { const msg = JSON.parse(part); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } });
function call(method, params = {}, sessionId) { return new Promise(resolve => { const n=++id; pending.set(n,resolve); chrome.stdio[3].write(JSON.stringify({id:n,method,params,...(sessionId ? {sessionId} : {})})+'\0'); }); }
async function main() {
  await new Promise(resolve => setTimeout(resolve, 3000));
  if (process.argv.includes('--keys')) {
    const result = await call('Extensions.getStorageItems', { id: 'dhdgffkkebhmkfjojejmpbldmpobfkfo', storageArea: 'local' });
    console.log(JSON.stringify({ error: result.error, keys: Object.keys(result.result?.data || {}) }));
    await call('Browser.close'); return;
  }
  const info = await call('Target.getTargets');
  const target = info.result?.targetInfos?.find(t => t.url.includes('dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html'));
  if (!target) throw Error('No options page');
  const attached = await call('Target.attachToTarget', {targetId:target.targetId,flatten:true});
  if (!attached.result?.sessionId) throw Error(JSON.stringify(attached.error));
  const result = await call('Runtime.evaluate', { expression:"JSON.stringify({title:document.title,text:document.body.innerText.slice(0,6000),inputs:[...document.querySelectorAll('input,button,select')].map(e=>({tag:e.tagName,type:e.type,id:e.id,title:e.title,value:e.value,text:e.innerText})).slice(0,40)})", returnByValue:true },attached.result.sessionId);
  console.log(result.result?.result?.value || JSON.stringify(result));
  await call('Browser.close');
}
main().catch(e => {console.error(e.message); chrome.kill();process.exitCode=1;});
