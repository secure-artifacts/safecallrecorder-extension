import type { DeviceInfo, SourceMode } from "./types";
const $ = <T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const say=(s:string)=>$("status").textContent=s;
let devices: DeviceInfo[]=[]; let selectedSession: string|undefined;
async function ask(m: object) { const r=await chrome.runtime.sendMessage(m); if(!r?.ok) throw new Error(r?.error||"操作超时"); return r; }
function refreshSelect() { const select=$<HTMLSelectElement>("device"); select.replaceChildren(...devices.filter(d=>d.kind==="audioinput").map(d=>new Option(`${d.label}（${d.hint}）`,d.deviceId))); }
async function refresh() { try { devices=(await ask({action:"offscreen-command",command:{action:"devices"}})).devices; refreshSelect(); say("设备已刷新"); } catch(e){say(`无法刷新设备：${(e as Error).message}`);} }
function mode(){return $<HTMLSelectElement>("mode").value as SourceMode}
async function showStatus(){ try { const r=await ask({action:"offscreen-command",command:{action:"status"}}); const a=r.active[0]; if(a){selectedSession=a.id;$<HTMLMeterElement>("level").value=a.level;$("duration").textContent=`已安全保存：${Math.floor(a.safeDurationMs/1000)} 秒`;say(a.status);} else say("准备就绪"); }catch{} }
$<HTMLButtonElement>("permission").onclick=async()=>{try{devices=(await ask({action:"offscreen-command",command:{action:"permission"}})).devices;refreshSelect();say("已获得设备权限");}catch(e){say("没有设备权限：当前网页声音仍可使用。");}};
$<HTMLButtonElement>("refresh").onclick=refresh;
$<HTMLButtonElement>("dashboard").onclick=()=>ask({action:"open-dashboard"});
$<HTMLButtonElement>("start").onclick=async()=>{try{const d=devices.find(x=>x.deviceId===$<HTMLSelectElement>("device").value);const r=await ask({action:"start",mode:mode(),deviceId:d?.deviceId,deviceLabel:d?.label,mixed:$<HTMLInputElement>("mixed").checked,bitrate:Number($<HTMLSelectElement>("bitrate").value)});selectedSession=r.session.id;say("正在录音");}catch(e){say(`无法开始：${(e as Error).message}`);}};
$<HTMLButtonElement>("pause").onclick=()=>selectedSession&&ask({action:"offscreen-command",command:{action:"pause",sessionId:selectedSession}});
$<HTMLButtonElement>("resume").onclick=()=>selectedSession&&ask({action:"offscreen-command",command:{action:"resume",sessionId:selectedSession}});
$<HTMLButtonElement>("stop").onclick=async()=>{if(selectedSession){await ask({action:"offscreen-command",command:{action:"stop",sessionId:selectedSession,export:true}});say("已停止，正在下载");selectedSession=undefined;}};
$<HTMLButtonElement>("test").onclick=async()=>{try{const r=await ask({action:"offscreen-command",command:{action:"test",deviceId:$<HTMLSelectElement>("device").value}});say(r.silent?"没有检测到声音，请确认声音已经路由到该设备。":"测试完成，正在播放");new Audio(r.url).play();}catch(e){say(`测试失败：${(e as Error).message}`);}};
$<HTMLSelectElement>("mode").onchange=()=>$("deviceRow").style.display=mode()==="tab"?"none":"block";
refresh();showStatus();setInterval(showStatus,1000);
