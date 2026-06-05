import puppeteer from "puppeteer-core";
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:CHROME,headless:true,protocolTimeout:120000,
  args:["--no-sandbox","--use-gl=swiftshader"],defaultViewport:{width:1340,height:760}});
const p=await b.newPage();
p.on("pageerror",e=>console.log("PAGEERROR:",e.message));
await p.goto("http://localhost:5173",{waitUntil:"domcontentloaded"});
await sleep(3500);
await p.type("#name","Finisher"); await p.click("#quickplay");
await sleep(1500); await p.click("#startBtn");
await p.evaluate(()=>{window.__auto=true;});
let phase="";
for(let i=0;i<120;i++){
  await sleep(1500);
  phase=await p.evaluate(()=>window.__net.state.phase);
  const lap=await p.evaluate(()=>window.__net.state.players.get(window.__net.sessionId).lap);
  if(i%5===0) console.log(`  t=${i} phase=${phase} lap=${lap}`);
  if(phase==="finished") break;
}
console.log("final phase:", phase);
await sleep(1000);
await p.screenshot({path:"scripts/shots/results.png"});
console.log("results shot saved");
await b.close();
