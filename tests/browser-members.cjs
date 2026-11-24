const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE});
  try{
    for(const width of [320,390,768]){
      const page=await browser.newPage({viewport:{width,height:740},reducedMotion:'reduce'});
      const errors=[];page.on('pageerror',err=>errors.push(err.message));
      const base='http://fanplay.test/';
      await page.route(base+'**',route=>{
        const file=new URL(route.request().url()).pathname.slice(1)||'index.html';
        if(!/^(index\.html|(?:js|css)\/[a-z-]+\.(?:js|css)|js\/vendor\/supabase\.js)$/.test(file))return route.abort();
        return route.fulfill({path:path.resolve(__dirname,'..',file)});
      });
      await page.addInitScript(()=>{
        window.supabase={createClient(){
          let session=null,state={};
          let post={id:'p1',nickname:'테스트 팬',text:'시연 티켓',ticket:{id:'ticket',date:'2026-11-24',home:'홈 팀',away:'원정 팀',hs:3,as:2},likes:0,replyCount:0,comments:[]};
          const ok=data=>({data,error:null});
          return {
            auth:{
              getSession:async()=>ok({session}),
              signUp:async({email,options})=>{session={email};state.profile=options.data;return ok({session});},
              signOut:async()=>{session=null;return ok({});}
            },
            rpc:async(name,args)=>{
              if(name==='fanplay_member_open')return ok({username:'user-1',state,revision:0});
              if(name==='fanplay_member_save'){state=args.p_state;return ok({username:'user-1',state,revision:1});}
              if(name==='fanplay_ticket_feed')return ok(args.p_sort==='latest'||(args.p_sort==='likes'?post.likes:post.replyCount)?[{...post}]:[]);
              if(name==='fanplay_ticket_write'){
                if(args.p_action==='like'){post.liked=args.p_liked;post.likes=Number(args.p_liked);}
                if(args.p_action==='comment'){post.comments.push({id:'c1',mine:true,nickname:'시연팬',text:args.p_text});post.replyCount++;}
                if(args.p_action==='remove-comment'){post.comments=[];post.replyCount=0;}
                return ok('p1');
              }
              throw Error('unexpected RPC '+name);
            },
            channel(){return {on(...args){window.refreshSignal=args.at(-1);return this;},subscribe(){return this;}};},
            removeChannel:async()=>{}
          };
        }};
      });
      await page.goto(base+'#community');
      await page.getByText('시연 티켓',{exact:true}).waitFor();
      assert.equal(await page.locator('.bottomnav a').count(),4);
      assert.equal(await page.locator('.bottomnav a[href="#collection"]').count(),0);
      assert.equal(await page.locator('.comment-form').count(),0);
      await page.locator('.bottomnav a[href="#profile"]').click();
      await page.getByText('회원가입',{exact:true}).first().click();
      const signup=page.locator('form[data-account-action="register"]');
      await signup.locator('[name="email"]').fill('user@example.test');
      await signup.locator('[name="password"]').fill('fixture-password');
      await signup.locator('[name="nickname"]').fill('시연팬');
      await signup.locator('[name="team"]').selectOption('LG');
      await signup.locator('button').click();
      await page.locator('.profile-card').getByText('LG 트윈스',{exact:true}).waitFor();
      assert.equal(await page.getByRole('heading',{name:'온라인 시연 기록'}).count(),0);
      await page.getByRole('link',{name:'회원정보 수정'}).click();
      await page.locator('#profile-form [name="team"]').selectOption('KIA');
      await page.locator('#profile-form button[type="submit"]').click();
      await page.locator('.profile-card').getByText('KIA 타이거즈',{exact:true}).waitFor();
      await page.locator('.my-collection-link').click();
      assert.equal(await page.locator('.bottomnav a[aria-current="page"]').getAttribute('href'),'#profile');
      await page.locator('.bottomnav a[href="#community"]').click();
      await page.locator('[data-action="like"]').click();
      await page.getByRole('button',{name:'♥ 좋아요 1'}).waitFor();
      await page.locator('.community-comments summary').click();
      await page.locator('.comment-form input').fill('좋은 경기네요');
      await page.locator('.comment-form button').click();
      await page.getByText('좋은 경기네요',{exact:false}).waitFor();
      for(const sort of ['likes','comments']){
        await page.locator('[data-action="community-sort"][data-value="'+sort+'"]').click();
        await page.getByText('1위',{exact:true}).waitFor();
      }
      await page.locator('.community-comments summary').click();
      page.once('dialog',d=>d.accept());
      await page.getByRole('button',{name:'내 댓글 삭제'}).click();
      await page.getByText('아직 이 목록에 티켓이 없어요.').waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(errors,[]);
      console.log('PASS '+width+'px: public feed, account signup and team, edit, collection, likes, comments, rankings');
      await page.close();
    }
  } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
