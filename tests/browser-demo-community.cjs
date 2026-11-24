const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path');

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    for(const width of [320,390,768]){
      const base='http://fanplay.test/', records=new Map(), posts=[];
      const errors=[];
      async function pageForBrowser(){
        const page=await browser.newPage({viewport:{width,height:740},reducedMotion:'reduce'});
        page.on('pageerror',error=>errors.push(error.message));
        await page.route(base+'**',route=>{
          const file=new URL(route.request().url()).pathname.slice(1)||'index.html';
          if(!/^(index\.html|(?:js|css)\/[a-z-]+\.(?:js|css)|js\/vendor\/supabase\.js)$/.test(file))return route.abort();
          return route.fulfill({path:path.resolve(__dirname,'..',file)});
        });
        await page.route('https://*.supabase.co/rest/v1/rpc/*',async route=>{
          const name=new URL(route.request().url()).pathname.split('/').at(-1);
          const args=route.request().postDataJSON();
          const ok=json=>route.fulfill({json});
          const record=records.get(args.p_player_id);
          const identity=args.p_browser_key?args.p_player_id+':'+args.p_browser_key:null;
          switch(name){
            case 'fanplay_demo_status': return ok({ready:true,version:1});
            case 'fanplay_demo_join':
              if(!record)records.set(args.p_player_id,{username:args.p_player_id,state:{profile:{team:args.p_team}},revision:0});
              return ok(records.get(args.p_player_id));
            case 'fanplay_demo_open': return ok(record);
            case 'fanplay_demo_save':
              if(record.revision!==args.p_revision)return route.fulfill({status:409,json:{message:'기록 충돌'}});
              Object.assign(record,{state:args.p_state,revision:record.revision+1});
              return ok(record);
            case 'fanplay_demo_ticket_feed': {
              const rows=posts.map(({owner,likers,comments,...rest})=>({...rest,mine:identity===owner,
                liked:likers.has(identity),likes:likers.size,replyCount:comments.length,
                comments:comments.map(({author,...comment})=>({...comment,mine:author===identity}))}));
              const metric={likes:'likes',comments:'replyCount'}[args.p_sort];
              return ok(metric?rows.filter(p=>p[metric]>0).sort((a,b)=>b[metric]-a[metric]).slice(0,10):rows);
            }
            case 'fanplay_demo_ticket_write': {
              assert.match(args.p_browser_key,/^[a-f0-9]{64}$/);
              const found=posts.find(p=>p.id===args.p_post_id);
              if(args.p_action==='post'){
                posts.unshift({id:'post-'+(posts.length+1),owner:identity,nickname:'테스트 팬',ticket:args.p_ticket,
                  text:args.p_text,createdAt:'2026-11-24T12:00:00Z',likers:new Set(),comments:[]});
                record.revision++;
              }
              if(args.p_action==='edit'){assert.equal(found.owner,identity);found.text=args.p_text;record.revision++;}
              if(args.p_action==='like'){if(args.p_liked)found.likers.add(identity);else found.likers.delete(identity);}
              if(args.p_action==='comment')found.comments.push({id:'c1',author:identity,nickname:'시연팬',text:args.p_text});
              if(args.p_action==='remove-comment'){
                const index=found.comments.findIndex(c=>c.id===args.p_comment_id&&c.author===identity);
                assert(index>=0);found.comments.splice(index,1);
              }
              return ok(found?.id||'post-1');
            }
            default: throw Error('unexpected RPC '+name);
          }
        });
        await page.addInitScript(()=>{
          window.supabase={createClient(){return {
            channel(){return {on(...args){window.refreshSignal=args.at(-1);return this;},subscribe(){return this;}};},
            removeChannel:async()=>{}
          };}};
        });
        return page;
      }
      async function enter(page,id,team){
        await page.goto(base+'#profile');
        const form=page.locator('form[data-account-action="login"]');
        assert.equal(await page.locator('input[type="email"], input[type="password"]').count(),0);
        await form.locator('[name="username"]').fill(id);
        await form.locator('[name="team"]').selectOption(team);
        await form.locator('button[type="submit"]').click();
        await page.waitForFunction(expected=>FP.account.username===expected&&!FP.account.busy,id);
      }
      const a=await pageForBrowser();
      await a.goto(base+'#community');
      await a.getByText('아직 이 목록에 티켓이 없어요.').waitFor();
      assert.equal(await a.locator('.bottomnav a').count(),4);
      assert.equal(await a.locator('.bottomnav a[href="#collection"]').count(),0);
      await enter(a,'demo_a','LG');
      await a.locator('.profile-card').getByText('LG 트윈스',{exact:true}).waitFor();
      await a.getByRole('link',{name:'회원정보 수정'}).click();
      await a.locator('#profile-form [name="team"]').selectOption('KIA');
      await a.locator('#profile-form button[type="submit"]').click();
      await a.locator('.profile-card').getByText('KIA 타이거즈',{exact:true}).waitFor();
      await a.evaluate(()=>FP.transact(d=>{d.tickets.push({...FP.sample,id:'sample'});}));
      await a.locator('.my-collection-link').click();
      assert.equal(await a.locator('.bottomnav a[aria-current="page"]').getAttribute('href'),'#profile');
      a.once('dialog',dialog=>dialog.accept('시연 티켓'));
      await a.locator('[data-action="share"]').click();
      await a.getByText('시연 티켓',{exact:true}).waitFor();
      assert.equal(await a.locator('[data-action="edit-post"]').count(),1);
      const b=await pageForBrowser();
      await enter(b,'demo_a','KT');
      await b.locator('.profile-card').getByText('KIA 타이거즈',{exact:true}).waitFor();
      await b.locator('.bottomnav a[href="#community"]').click();
      await b.getByText('시연 티켓',{exact:true}).waitFor();
      assert.equal(await b.locator('[data-action="edit-post"], [data-action="delete-post"]').count(),0);
      await b.locator('[data-action="like"]').click();
      await b.getByRole('button',{name:'♥ 좋아요 1'}).waitFor();
      await b.locator('.community-comments summary').click();
      await b.locator('.comment-form input').fill('좋은 경기네요');
      await b.locator('.comment-form button').click();
      await b.getByText('좋은 경기네요',{exact:false}).waitFor();
      for(const sort of ['likes','comments']){
        await b.locator('[data-action="community-sort"][data-value="'+sort+'"]').click();
        await b.getByText('1위',{exact:true}).waitFor();
      }
      await b.locator('.community-comments summary').click();
      b.once('dialog',d=>d.accept());
      await b.getByRole('button',{name:'내 댓글 삭제'}).click();
      await b.getByText('아직 이 목록에 티켓이 없어요.').waitFor();
      await a.reload();
      await a.getByText('시연 티켓',{exact:true}).waitFor();
      await a.locator('[data-action="edit-post"]').waitFor();
      assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(errors,[]);
      console.log('PASS '+width+'px: ID-only entry, team, edit, post, same-ID device ownership, reload, reactions and rankings');
      await a.close();await b.close();
    }
  } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
