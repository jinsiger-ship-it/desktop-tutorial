const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE});
 const host='http://fanplay.test/';
 try{
  const context=await browser.newContext({viewport:{width:390,height:800}});
  const errors=[];
  let offline=false;
  let record={username:'browser_recovery',state:{profile:{team:'LG'}},revision:0};
  const postId='08bb0f21-9c20-4dcf-b4a5-4f330ca91ad0';
  const ticket={id:'test-v2',date:'2026-11-25',home:'가상 홈',away:'가상 원정',stadium:'가상 구장',hs:0,as:0};
  const replies=Array.from({length:16},(_,i)=>({id:'comment-'+i,nickname:'가상 팬',text:'댓글 '+i,createdAt:new Date(Date.UTC(2026,10,25,12,0,16-i)).toISOString(),mine:i===15}));
  await context.route(host+'**',route=>{
    const url=new URL(route.request().url());
    const file=url.pathname.slice(1)||'index.html';
    if(!/^(index\.html|(?:js|css)\/[a-z-]+\.(?:js|css))$/.test(file))return route.abort();
    return route.fulfill({path:path.resolve(__dirname,'..',file)});
  });
  await context.route('https://*.supabase.co/rest/v1/rpc/*',route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);
    const args=route.request().postDataJSON();
    const ok=json=>route.fulfill({json});
    switch(name){
      case 'fanplay_demo_status':return ok({ready:true,version:1});
      case 'fanplay_demo_open':
      case 'fanplay_demo_resume':return offline?route.abort():ok(args.p_player_id===record.username?record:null);
      case 'fanplay_demo_ticket_feed_v2':return ok([{id:postId,ticket,nickname:'가상 팬',text:'테스트 게시글',createdAt:'2026-11-25T00:00:00Z',replyCount:replies.length,mine:false}]);
      case 'fanplay_demo_ticket_comments':return ok(args.p_after_id?replies.slice(replies.findIndex(r=>r.id===args.p_after_id)+1):replies);
      case 'fanplay_demo_ticket_write_v2':
        if(args.p_action==='remove-comment')replies.splice(replies.findIndex(r=>r.id===args.p_comment_id),1);
        return ok(postId);
      case 'fanplay_demo_career_rankings':return ok([{nickname:'가상 팬',name:'가상 투수',position:'투수',seasons:7,sample:120,score:2.1}]);
      case 'fanplay_demo_career_rank_status':return ok([]);
      default:return route.fulfill({status:404,json:{code:'PGRST202'}});
    }
  });
  await context.addInitScript(()=>{
    window.supabase={createClient:()=>({channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:async()=>{}})};
  });
  async function pageAt(hash){
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(host+hash);
    await page.waitForFunction(()=>!FP.account.checking);
    return page;
  }
  const a=await pageAt('#create'),b=await pageAt('#create');
  const save=(page,id)=>page.evaluate(id=>FP.saveTicket({...FP.sample,id}),id);
  assert.deepEqual(await Promise.all([save(a,'one'),save(b,'two')]),[true,true]);
  assert(await save(b,'latest-tab'));
  await a.goto(host+'#records');
  await a.waitForFunction(()=>FP.data.tickets.some(ticket=>ticket.id==='latest-tab'));
  await a.goto(host+'#create');
  await a.reload();
  assert.deepEqual((await a.evaluate(()=>FP.data.tickets.map(t=>t.id))).sort(),['latest-tab','one','two']);
  const ticketForm=a.locator('#ticket-form');
  await ticketForm.locator('[name="stadium"]').fill('가상 구장');
  await ticketForm.locator('[name="home"]').fill('리로드 홈');
  await ticketForm.locator('[name="away"]').fill('리로드 원정');
  assert.equal(await ticketForm.locator('[name="hs"]').inputValue(),'');
  await ticketForm.locator('[name="hs"]').fill('0');await ticketForm.locator('[name="as"]').fill('0');
  await ticketForm.locator('button[type="submit"]').click();
  await a.getByRole('heading',{name:'나만의 한 장으로'}).waitFor();
  await a.reload();
  await a.getByRole('heading',{name:'나만의 한 장으로'}).waitFor();
  await a.locator('[data-action="stage"]').click();
  assert.equal(await ticketForm.locator('[name="home"]').inputValue(),'리로드 홈');
  assert.equal(await ticketForm.locator('[name="hs"]').inputValue(),'0');
  await a.goto(host+'#records');
  const backup=await a.evaluate(()=>({format:'fanplay-backup',version:1,state:{...FP.defaults(),tickets:[{...FP.sample,id:'file-ticket'}]}}));
  await a.locator('[data-record-backup]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await a.getByRole('heading',{name:'가져오기 확인'}).waitFor();
  await a.locator('[data-action="records-apply"][data-value="account"]').click();
  await a.waitForFunction(()=>FP.data.tickets.length===4);
  await b.close();

  await a.evaluate(()=>localStorage.setItem('fanplay-demo-active-id-v1','browser_recovery'));
  offline=true;
  await a.goto(host+'?recover=1#profile');
  await a.getByRole('button',{name:'다시 연결',exact:true}).waitFor();
  assert.equal(await save(a,'do-not-write'),false);
  offline=false;
  await a.getByRole('button',{name:'다시 연결',exact:true}).click();
  await a.waitForFunction(()=>FP.account.username==='browser_recovery');
  await a.locator('.bottomnav a[href="#community"]').click();
  await a.locator('.community-comments summary').click();
  await a.getByRole('button',{name:'이전 댓글 더 보기'}).click();
  await a.getByText('댓글 15',{exact:false}).waitFor();
  await a.locator('.comment-form input').fill('아직 입력 중');
  await a.locator('[data-action="community-refresh"]').click();
  assert.equal(await a.locator('.comment-form input').inputValue(),'아직 입력 중');
  a.once('dialog',dialog=>dialog.accept());
  await a.getByRole('button',{name:'내 댓글 삭제'}).click();
  await a.waitForFunction(()=>FP.communityPosts[0]?.replyCount===15);
  await a.goto(host+'#ranking');
  await a.getByText('가상 투수',{exact:true}).waitFor();
  for(const width of [320,390,768]){
    await a.setViewportSize({width,height:800});
    assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS real browser concurrent tab saves, ticket draft and explicit backup restore, reconnect, older comments and ranked list');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
