async function main() {
 const port = Number(process.argv[2] || 19301);
 const base = `http://127.0.0.1:${port}`;
 const page = await (await fetch(base + '/json/new?' + encodeURIComponent('chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html'), { method: 'PUT' })).json();
 await new Promise(resolve=>setTimeout(resolve,1000));
 const ws = new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
 let count=0; const pending=new Map(); ws.onmessage=e=>{ const m=JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
 const call=(method,params={})=>new Promise(resolve=>{const id=++count;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
 await new Promise(resolve=>setTimeout(resolve,1800));
 const response=await call('Runtime.evaluate',{expression:`JSON.stringify({title:document.title,text:document.body.innerText.slice(0,7000),inputs:[...document.querySelectorAll('input,button,select')].map(e=>({tag:e.tagName,type:e.type,id:e.id,title:e.title,value:e.value,text:e.innerText})).slice(0,60)})`,returnByValue:true});
 console.log(response.result?.result?.value || JSON.stringify(response));
 ws.close(); await fetch(base+'/json/close/'+page.id);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
