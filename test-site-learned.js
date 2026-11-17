#!/usr/bin/env node
/* Browser side: does script.js load learned/index.json + parts, answer from them, and honour learned/banned.json?  Run: node test-site-learned.js */
const fs=require("fs");
let src=fs.readFileSync("script.js","utf8"); const k=src.lastIndexOf("})();");
src=src.slice(0,k)+"\nwindow.__m={MIFASA_LEARN,mifasaLearnLookup,mifasaLearnLoadSite,mifasaAskAsync};\n"+src.slice(k);
const L=require("./learn-daily.js"); const store={};
global.localStorage={getItem:x=>store[x]??null,setItem:(x,v)=>{store[x]=String(v)},removeItem:x=>{delete store[x]}};
let banned={ids:[],words:[]}, ext=0;
const mk=(w,lang)=>{const q=lang==="en"?'What does "'+w+'" mean?':"Ijambo "+w+" risobanura iki?",qn=L.norm(q);return{id:L.learnId(lang,qn),v:1,lang,word:w,q_raw:q,q_norm:qn,q_en:qn,key_en:qn,answer:"**"+w+"** (noun): a test meaning that is long enough.",answer_lang:"en",answer_alt:{},grounded:true,sources:[{title:"t",url:"https://x"}]}};
const items=[mk("parliament","en"),mk("economy","en")];
global.fetch=async u=>{u=String(u);ext++;
  if(u==="learned/index.json"){await new Promise(r=>setTimeout(r,300));return{ok:true,json:async()=>({parts:[{file:"part-0001.json",count:items.length}]})}}
  if(false)return{ok:true,json:async()=>({parts:[{file:"part-0001.json",count:items.length}]})};
  if(u==="learned/part-0001.json")return{ok:true,json:async()=>({items})};
  if(u==="learned/banned.json")return{ok:true,json:async()=>banned};
  return{ok:false,status:404}};
global.window={MIFASA_API_ONLY:true,location:{search:"",href:"http://x/",origin:"http://x"}};
global.document={body:null,documentElement:{},addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[],createElement:()=>({}),hidden:false};
global.location=window.location;global.navigator={};
const log=console.log;console.log=()=>{};try{(0,eval)(src)}catch(e){}console.log=log;
const m=window.__m; if(!m){log("FAIL harness");process.exit(2)}
const ok=(n,c)=>log((c?"✓ ":"✗ ")+n); const txt=r=>r&&r.html?r.html.replace(/<[^>]+>/g," ").replace(/\s+/g," "):"";
(async()=>{
  let r=await m.mifasaLearnLookup('What does "parliament" mean?',{exact:true});      // FIRST question on a fresh browser, the files arrive 300 ms late
  ok("first question after a fresh load still waits for learned/ and is answered", r&&/parliament/.test(txt(r)));
  ok("near-miss question is NOT an exact hit", !(await m.mifasaLearnLookup('What does "parliament" mean in physics?',{exact:true})));
  r=await m.mifasaAskAsync('What does "parliament" mean?'); ok("chat entry (mifasaAskAsync) answers it from learned/ first", r&&r.learned);
  r=await m.mifasaLearnLookup('What does "parliament" mean?');
  ok("question answered from the site's learned/ files (no Worker, no external AI)", r&&/parliament/.test(txt(r))&&r.learned);
  ok("answer carries the checked-knowledge note", /checked knowledge/.test(txt(r)));
  const before=ext; await m.mifasaLearnLoadSite(); ok("unchanged part is not downloaded again (only index+banned fetched)", ext-before===2);
  banned={ids:[],words:["parliament"]}; await m.mifasaLearnLoadSite();
  r=await m.mifasaLearnLookup('What does "parliament" mean?'); ok("banned word disappears from the browser", !r);
  r=await m.mifasaLearnLookup('What does "economy" mean?'); ok("other answers keep working", r&&/economy/.test(txt(r)));
  process.exit(0);
})();
setTimeout(()=>{log("TIMEOUT");process.exit(3)},30000).unref();
