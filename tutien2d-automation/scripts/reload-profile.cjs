async function main() {
 const port = 19300 + Number(process.argv[2]);
 const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const page = pages.find(p => p.type === 'page' && /^https:\/\/(www\.)?(?:tutien2d\.com|tutienpixel\.online)\//.test(p.url));
 if (!page) throw Error('Không thấy game');
 const ws = new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 const done = new Promise(resolve=>{ws.onmessage=e=>{if(JSON.parse(e.data).id===1)resolve();};});
 ws.send(JSON.stringify({id:1,method:'Page.reload'}));
 await done; ws.close(); console.log('Đã tải lại Profile'+process.argv[2]);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
