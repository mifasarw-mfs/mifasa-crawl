const fs=require("fs");
let src=fs.readFileSync("script.js","utf8");
const k=src.lastIndexOf("})();");
src=src.slice(0,k)+"\nwindow.__m={mifasaHubAnswer,mifasaGoalParse,mifasaHubLoadAll,MIFASA_HUB};\n"+src.slice(k);
const store={};
global.localStorage={getItem:x=>store[x]??null,setItem:(x,v)=>{store[x]=String(v)},removeItem:x=>{delete store[x]}};
const days=[];for(let i=0;i<95;i++){days.push(new Date(Date.UTC(2026,10,10)-i*864e5).toISOString().slice(0,10));}
const day=days[0], sid="MN202611_test1";
const arch=d=>({articles:[{title_rw:"Inkuru yo ku wa "+d,title_en:"Story of "+d,summary_en:"daily story",date:d+"T08:00:00Z",link:"https://example.com/"+d,source:"KT Press",share_id:"MN_"+d,category:"news"}]});
const fullDay=d=>d===day?{day:d,items:{[sid]:{w:90,t:"Rwanda has launched a new solar power programme to reach rural homes. The programme will connect 200,000 households to solar electricity by 2028. Officials said the cost is shared with development partners.",source:"KT Press"}}}
 :d===days[60]?{day:d,items:{old1:{w:80,t:"A zebrafish conservation project near Lake Kivu counted 4,500 breeding pairs this season. Scientists praised the community rangers for the result.",source:"Taarifa",link:"https://x/old"}}}:{day:d,items:{}};
let calls=[],llmCalls=[];
global.fetch=async (u,o)=>{calls.push(u);
  if(String(u).startsWith("http://llm")){llmCalls.push(JSON.parse(o.body));return{ok:true,status:200,json:async()=>({text:"LLM: here is a personalised plan. Which language do you use most?"})}}
  let j=null; const m=String(u).match(/(\d{4}-\d{2}-\d{2})/);
  if(String(u).endsWith("news-archive/index.json"))j=days; else if(String(u).includes("news-archive/")&&m)j=arch(m[1]); else if(String(u).includes("news-full/")&&m)j=fullDay(m[1]);
  return j?{ok:true,json:async()=>j}:{ok:false}};
global.window={MIFASA_API_ONLY:true,location:{search:"",href:"http://x/",origin:"http://x"}};
global.document={body:null,documentElement:{},addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[],createElement:()=>({}),hidden:false};
global.location=window.location;global.navigator={};
const log=console.log;console.log=()=>{};
try{(0,eval)(src)}catch(e){}
console.log=log;
const m=window.__m; if(!m){log("FAIL: harness not exposed");process.exit(2)}
setTimeout(()=>{log("TIMEOUT");process.exit(3)},60000).unref();
const txt=r=>r&&r.html?r.html.replace(/<[^>]+>/g," ").replace(/&#039;/g,"'").replace(/\s+/g," "):"";
const ok=(n,c)=>log((c?"✓ ":"✗ ")+n);
(async()=>{
  /* A. hub answer from full text */
  await window.MifasaAI.hubLoad(5,true);
  let r=await m.mifasaHubAnswer("how many households will the solar programme connect");
  ok("hub answer uses full text (200,000)", /200,000/.test(txt(r)));
  /* B. load EVERYTHING in background */
  await m.mifasaHubLoadAll();
  ok("load-all: all "+days.length+" days loaded (got "+m.MIFASA_HUB.loaded.size+")", m.MIFASA_HUB.loaded.size===days.length);
  /* C. deep search inside full text of an OLD story not found by title */
  r=await m.mifasaHubAnswer("zebrafish breeding pairs Lake Kivu");
  ok("deep search finds the old story's full text (4,500)", /4,500/.test(txt(r)));
  ok("unrelated question -> null", (await m.mifasaHubAnswer("what is the capital of france please"))===null);
  /* D. goal mentor: the user's own example, Kinyarwanda, no external AI */
  const q1="ndashaka umfashe ndi Rwandan Young developer ndashaka kwiga hacking nkaba umwe mu ba hackers beza";
  const g=m.mifasaGoalParse(q1);
  ok("parse: domain=security, who has Rwandan+young+developer", g&&g.domain==="security"&&g.who.length>=3);
  r=await window.MifasaAI.askAsync(q1); let t=txt(r);
  log("--- ANSWER (rw, local) ---\n"+t.slice(0,1200)+"\n");
  ok("local answer: understood + roadmap + one question", r.goal&&/Dore uko nsobanukiwe/.test(t)&&/Inzira y'ibanze/.test(t)&&/\?/.test(t));
  ok("ethical framing present", /BABYEMEREWE|icyaha/.test(t));
  /* E. 2nd turn */
  r=await window.MifasaAI.askAsync("nzi Python na Linux, nkunda pentest"); t=txt(r);
  ok("follow-up gives 30-day plan using Python", r.goal&&/Icyumweru 1/.test(t)&&/python/i.test(t));
  /* F. English + external AI */
  window.MIFASA_LLM_URL="http://llm"; window.MifasaAI.goalReset();
  r=await window.MifasaAI.askAsync("I want to learn hacking and become one of the best, I am a young Rwandan developer using Python"); t=txt(r);
  ok("with LLM: analysis + LLM answer", r.goal&&r.llm&&/How I understood|how I understood/i.test(t)&&/LLM: here is/.test(t));
  ok("LLM got the ethical mentor brief", llmCalls.length&&/ETHICAL|ethical/.test(llmCalls[0].q)&&/legal/i.test(llmCalls[0].q));
  /* G. ordinary question is not hijacked */
  window.MIFASA_LLM_URL=""; r=await window.MifasaAI.askAsync("ndashaka kumenya amakuru ya siporo");
  ok("short ordinary request is not treated as a goal", !(r&&r.goal));
  process.exit(0);
})();
