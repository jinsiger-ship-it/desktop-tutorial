/* 사본을 먼저 저장하고 성공했을 때만 메모리를 교체합니다. 실패 시 어떤 변경도 반영하지 않습니다. */
FP.key = 'fanplay-web-v2';
FP.copy = value => JSON.parse(JSON.stringify(value));
FP.defaults = () => ({schemaVersion:2,tickets:[],posts:[],career:null,careerDraft:null,careerHistory:[],savedCareers:[],savedDrafts:[],profile:{nickname:'야구팬',team:'neutral',featuredTicketId:null,selectedTitleId:null},inventory:{itemIds:[],titleIds:[]}});
FP.str = (s,max=160) => typeof s === 'string' ? s.slice(0,max) : '';
FP.number = (n,min,max,fallback=0) => Number.isFinite(Number(n)) ? Math.max(min,Math.min(max,Number(n))) : fallback;
FP.image = value => typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length < 3000000 ? value : '';
FP.validDate = value => {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;
};
FP.validScore = value => (typeof value==='number'||(typeof value==='string'&&/^\d{1,2}$/.test(value))) &&
 Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=99;
FP.ticketData = t => {
 if (!t || typeof t !== 'object' || !FP.str(t.id).trim() || !FP.validDate(t.date) || !FP.str(t.home).trim() || !FP.str(t.away).trim()) return null;
 if (typeof t.place === 'string' && !Object.hasOwn(t, 'stadium')) {
  const score = FP.str(t.score).match(/^\s*(\d{1,2})\s*[:：-]\s*(\d{1,2})\s*$/);
  const colors = {navy:'blue',red:'rose',blue:'blue',green:'forest'};
  t = {...t,stadium:t.place,hs:score?.[1] ?? null,as:score?.[2] ?? null,note:t.memory,theme:t.layout,color:colors[t.accent]};
 }
 return {id:FP.str(t.id),date:t.date,stadium:FP.str(t.stadium,80).trim(),home:FP.str(t.home,40).trim(),away:FP.str(t.away,40).trim(),hs:FP.validScore(t.hs)?Number(t.hs):null,as:FP.validScore(t.as)?Number(t.as):null,mode:['중계','커리어'].includes(t.mode)?t.mode:'직관',note:FP.str(t.note,180),tag:FP.str(t.tag,30),theme:['classic','scoreboard','photo'].includes(t.theme)?t.theme:'classic',color:['forest','rose','blue','sand'].includes(t.color)?t.color:'forest',photo:FP.image(t.photo),frameId:FP.items.some(i=>i.type==='frame'&&i.id===t.frameId)?t.frameId:'default',backgroundId:FP.items.some(i=>i.type==='background'&&i.id===t.backgroundId)?t.backgroundId:'default',badgeId:FP.items.some(i=>i.type==='badge'&&i.id===t.badgeId)?t.badgeId:'default',stickerIds:Array.isArray(t.stickerIds)?[...new Set(t.stickerIds.filter(id=>FP.items.some(i=>i.type==='sticker'&&i.id===id)))].slice(0,3):[]};
};
FP.normalize = (raw, issues=[]) => {
 const d=FP.defaults(), r=raw && typeof raw==='object'?raw:{};
 d.tickets=(Array.isArray(r.tickets)?r.tickets:[]).map(FP.ticketData).filter(Boolean).filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i);
 if(r.tickets!=null&&(!Array.isArray(r.tickets)||r.tickets.length!==d.tickets.length||
   r.tickets.some(ticket=>ticket?.photo&&!FP.image(ticket.photo))))issues.push('티켓');
 const p=r.profile || {};
 if(r.profile!=null&&(typeof r.profile!=='object'||Array.isArray(r.profile)))issues.push('프로필');
 d.profile.nickname=FP.str(p.nickname ?? p.author,24)||'야구팬';
 d.profile.team=FP.teams.some(t=>t[0]===p.team)?p.team:'neutral';
 d.profile.featuredTicketId=d.tickets.some(t=>t.id===(p.featuredTicketId||r.featured))?(p.featuredTicketId||r.featured):null;
 const inv=r.inventory||{};
 if(r.inventory!=null&&(typeof r.inventory!=='object'||Array.isArray(r.inventory)||
  (inv.itemIds!=null&&!Array.isArray(inv.itemIds))||(inv.titleIds!=null&&!Array.isArray(inv.titleIds))))issues.push('인벤토리');
 d.inventory.itemIds=[...new Set((Array.isArray(inv.itemIds)?inv.itemIds:[]).filter(id=>FP.items.some(i=>i.id===id)))];
 d.inventory.titleIds=[...new Set((Array.isArray(inv.titleIds)?inv.titleIds:[]).filter(id=>FP.titles.some(i=>i.id===id)))];
 // Diamond Memories 데이터의 보상은 새 아이템 정의로 명시적으로 대응합니다.
 if(Array.isArray(r.rewards)){
  const legacyRewards={night:'steady',gold:'star',trophy:'legend'};
  for(const id of r.rewards)if(Object.hasOwn(legacyRewards,id)&&!d.inventory.itemIds.includes(legacyRewards[id]))d.inventory.itemIds.push(legacyRewards[id]);
 }
 d.profile.selectedTitleId=d.inventory.titleIds.includes(p.selectedTitleId)?p.selectedTitleId:null;
 const c=r.career;
 const recoverCareer = saved => {
  try {return FP.restoreCareer(saved);} catch {return null;}
 };
 if(c?.rules) {
  d.career=recoverCareer(c);
 } else if(c && Array.isArray(c.stats)&&c.stats.length===3&&c.stats.every(n=>typeof n==='number'&&Number.isFinite(n))&&Number.isInteger(c.step)&&c.step>=0&&c.step<=8&&Array.isArray(c.log)) {
 d.career={name:FP.str(c.name,24)||'신인 선수',position:['투수','포수','내야수','외야수'].includes(c.position)?c.position:'투수',stats:c.stats.map(n=>FP.number(n,0,100)),step:c.step,log:c.log.slice(0,8).filter(l=>l&&typeof l==='object'&&!Array.isArray(l)).map(l=>({season:FP.number(l.season,1,8),text:FP.str(l.text ?? l.choice,200),delta:Array.isArray(l.delta)?l.delta.slice(0,3).map(n=>FP.number(n,-100,100)):[]}))};
 if(d.career.log.length!==c.log.length)issues.push('시즌 로그');
 // 완료 저장본에 보상이 빠졌다면 다음 성공 저장에서 함께 복구됩니다.
 if(c.step===8)FP.grant(d);
 }
 if(c&&!d.career)issues.push('진행 중인 선수');
 if(!d.career) d.careerDraft=FP.normalizeCareerDraft(r.careerDraft);
 if(r.careerDraft&&!d.career&&!d.careerDraft)issues.push('선수 후보');
 const draftIds=new Set([d.careerDraft?.id]);
 for(const draft of [...(Array.isArray(r.savedDrafts)?r.savedDrafts:[]),...(d.career&&r.careerDraft?[r.careerDraft]:[])]){
  const saved=FP.normalizeCareerDraft(draft);
  if(!saved){issues.push('선수 후보');continue;}
  if(!draftIds.has(saved.id)){draftIds.add(saved.id);d.savedDrafts.push(saved);}
 }
 const careerIds=new Set([d.career?.id]);
 for(const saved of Array.isArray(r.careerHistory)?r.careerHistory:[]) {
  const previous=recoverCareer(saved);
  if(FP.careerComplete(previous) && !careerIds.has(previous.id)) {
   careerIds.add(previous.id);
   d.careerHistory.push(previous);
  }else if(!previous)issues.push('은퇴 선수');
 }
 for(const saved of Array.isArray(r.savedCareers)?r.savedCareers:[]) {
  if(!saved || !FP.str(saved.id) || d.savedCareers.some(x=>x.id===saved.id))continue;
  const c=saved.career;
  const recovered=c?.rules?recoverCareer(c):FP.normalize({career:c},issues).career;
  if(recovered)d.savedCareers.push({id:FP.str(saved.id),career:recovered});
  else issues.push('보관 중인 선수');
 }
 for(const c of [d.career,...d.careerHistory,...d.savedCareers.map(x=>x.career)]) if([6,7,8].includes(c?.rules)) FP.grantStoryRewards(d,c);
 d.posts=(Array.isArray(r.posts)?r.posts:[]).filter(p=>p&&FP.str(p.id)&&FP.ticketData(p.ticket)).map(p=>({id:FP.str(p.id),nickname:FP.str(p.nickname ?? p.author,24)||'야구팬',text:FP.str(p.text ?? p.message,300),ticket:FP.ticketData(p.ticket),...(typeof p.createdAt==='string'&&Number.isFinite(Date.parse(p.createdAt))?{createdAt:p.createdAt}:{}),liked:p.liked===true,comments:(Array.isArray(p.comments)?p.comments:[]).filter(c=>c&&typeof c.text==='string').slice(-100).map(c=>({nickname:FP.str(c.nickname ?? c.author,24)||'야구팬',text:FP.str(c.text,200)}))}));
 if(r.posts!=null&&(!Array.isArray(r.posts)||r.posts.length!==d.posts.length))issues.push('개인 게시 이력');
 return d;
};
FP.readDevice = storage => {
 let raw=null, migrated=false;
 try {
  raw=storage.getItem(FP.key);
  if(raw===null){raw=storage.getItem('fanplay-prototype-v1')??storage.getItem('diamond-v1');migrated=raw!==null;}
  const value=raw===null?{}:JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('저장 파일 형식');
  const issues=[];
  return {raw,migrated,issues,state:FP.normalize(value,issues)};
 } catch {
  return {raw,migrated,issues:[],state:FP.defaults(),unreadable:true};
 }
};
FP.load = storage => {
 const snapshot=FP.readDevice(storage);
 FP.deviceRecovery=snapshot.unreadable||snapshot.issues.length?snapshot:null;
 FP.loadWarning=Boolean(FP.deviceRecovery);
 FP.migrated=snapshot.migrated;
 return snapshot.state;
};

const sameRecord=(first,second)=>JSON.stringify(first)===JSON.stringify(second);
function deviceChange(before,proposed,current) {
 const field=(oldValue,newValue,latest)=>{
  if(sameRecord(oldValue,newValue))return latest;
  if(sameRecord(oldValue,latest)||sameRecord(newValue,latest))return newValue;
  throw new Error('conflict');
 };
 const byId=(oldList,newList,latestList)=>{
  oldList??=[];newList??=[];latestList??=[];
  const old=new Map(oldList.map(item=>[item.id,item]));
  const wanted=new Map(newList.map(item=>[item.id,item]));
  const latest=new Map(latestList.map(item=>[item.id,item]));
  for(const id of new Set([...old.keys(),...wanted.keys()])){
   const value=field(old.get(id),wanted.get(id),latest.get(id));
   if(value===undefined)latest.delete(id);else latest.set(id,value);
  }
  const added=newList.filter(item=>!old.has(item.id)&&!latestList.some(entry=>entry.id===item.id)).map(item=>item.id);
  return [...new Set([...added,...latest.keys()])].map(id=>latest.get(id));
 };
 const inventory=(oldList,newList,latestList)=>{
  const removed=new Set(oldList.filter(id=>!newList.includes(id)));
  return [...new Set([...latestList.filter(id=>!removed.has(id)),...newList.filter(id=>!oldList.includes(id))])];
 };
 const merged={...current};
 for(const key of ['tickets','posts','careerHistory','savedCareers','savedDrafts'])merged[key]=byId(before[key],proposed[key],current[key]);
 for(const key of ['career','careerDraft'])merged[key]=field(before[key],proposed[key],current[key]);
 // Saving a different active player and selecting a new draft are mutually exclusive.
 if(merged.career&&merged.careerDraft)throw new Error('conflict');
 merged.profile=Object.fromEntries(Object.keys(current.profile).map(key=>[key,field(before.profile[key],proposed.profile[key],current.profile[key])]));
 if(!merged.tickets.some(t=>t.id===merged.profile.featuredTicketId))merged.profile.featuredTicketId=null;
 merged.inventory=Object.fromEntries(Object.keys(current.inventory).map(key=>[key,inventory(before.inventory[key],proposed.inventory[key],current.inventory[key])]));
 return merged;
}

FP.withDeviceWrite = task => {
 if(typeof navigator==='undefined')return task();
 if(navigator.locks?.request)return navigator.locks.request(FP.key+'-write',task);
 if(typeof indexedDB==='undefined')return Promise.reject(new Error('lock unavailable'));
 return new Promise((resolve,reject)=>{
  const open=indexedDB.open(FP.key+'-coordination',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('writes');
  open.onblocked=open.onerror=()=>reject(new Error('lock unavailable'));
  open.onsuccess=()=>{
   const db=open.result;
   const transaction=db.transaction('writes','readwrite');
   const gate=transaction.objectStore('writes').get('device');
   let result;
   gate.onsuccess=()=>{try{result=task();}catch(error){reject(error);}};
   transaction.oncomplete=()=>{db.close();resolve(result);};
   transaction.onabort=transaction.onerror=()=>{db.close();reject(new Error('lock unavailable'));};
  };
 });
};
FP.replaceUnreadableDevice = async state => {
 try{
  return await FP.withDeviceWrite(()=>{
   const latest=FP.readDevice(localStorage);
   if(!latest.unreadable||latest.raw===null||latest.raw!==FP.deviceRecovery?.raw)throw new Error('changed');
   localStorage.setItem(FP.key+'-recovery',latest.raw);
   localStorage.setItem(FP.key,JSON.stringify(state));
   FP.data=state;
   FP.deviceRecovery=null;
   return true;
  });
 }catch{
  FP.toast('원본을 안전하게 보관하지 못했거나 다른 탭에서 변경했어요. 기존 기록을 유지합니다.');
  return false;
 }
};
FP.transact = change => {
 const before=FP.data, next=FP.copy(before), username=FP.account?.username;
 const failure=error=>{
  const message=error.message==='conflict'?'다른 탭에서 같은 기록을 바꿨어요. 최신 기록을 확인한 뒤 다시 저장해 주세요.':
   error.message==='restore'?'온라인 기록을 다시 연결하거나 비회원 사용을 선택해 주세요.':
   error.message==='recovery'?'기존 기록을 복구하거나 원본을 내려받은 뒤 새 기록 시작을 선택해 주세요.':
   '저장하지 못했습니다. 기존 상태를 유지합니다. 저장 공간과 브라우저 설정을 확인해 주세요.';
  if(error.message==='conflict'){FP.deviceConflict=true;FP.pendingDeviceSave=next;}
  FP.toast(message);
  return false;
 };
 try {
  if(FP.account?.restorePending)throw new Error('restore');
  change(next);
  if(username)return FP.saveAccountState(next);
  const write=FP.withDeviceWrite(()=>{
   if(FP.account?.username||FP.account?.restorePending)throw new Error('restore');
   const latest=FP.readDevice(localStorage);
   if(latest.unreadable)throw new Error('recovery');
   const merged=deviceChange(before,next,latest.state);
   if(latest.issues.length&&latest.raw!==null&&localStorage.getItem(FP.key+'-recovery')===null)
    localStorage.setItem(FP.key+'-recovery',latest.raw);
   localStorage.setItem(FP.key,JSON.stringify(merged));
   FP.deviceConflict=false;
   FP.pendingDeviceSave=null;
   FP.deviceRecovery=null;
   FP.data=merged;
   return true;
  });
  return write?.catch?write.catch(failure):write;
 }catch(error){return failure(error);}
};
