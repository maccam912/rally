import puppeteer from "puppeteer-core";
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:CHROME,headless:true,protocolTimeout:90000,
  args:["--no-sandbox","--use-gl=swiftshader"],defaultViewport:{width:1340,height:760}});
const p=await b.newPage();
p.on("pageerror",e=>console.log("PAGEERROR:",e.message));
await p.goto("http://localhost:5173",{waitUntil:"domcontentloaded"});
await sleep(3500);
await p.type("#name","AIBot"); await p.click("#quickplay");
await sleep(1500); await p.click("#startBtn");
await p.evaluate(()=>{window.__auto=true;});
await sleep(4000);
const seen=new Set();
for(let i=0;i<24;i++){
  await sleep(900);
  const st=await p.evaluate(()=>{const m=window.__net.state.players.get(window.__net.sessionId);
    return {s:m.surface,slip:Math.round(m.slip),lap:m.lap,kmh:Math.round(Math.hypot(m.vx,m.vy)*0.4),onRoad:m.onRoad};});
  if(st.onRoad && !seen.has(st.s)){ seen.add(st.s);
    await p.screenshot({path:`scripts/shots/surf-${st.s}.png`}); console.log("captured surface",st.s,JSON.stringify(st)); }
  if(i%6===0) console.log("  tick",i,JSON.stringify(st));
}
console.log("surfaces seen:", [...seen].sort());
await b.close();
