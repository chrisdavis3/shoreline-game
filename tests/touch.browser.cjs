const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path'),fs=require('node:fs');
const resolvePackage=process.env.PLAYWRIGHT_PACKAGE_DIR?createRequire(path.resolve(process.env.PLAYWRIGHT_PACKAGE_DIR,'package.json')):require;
const {chromium}=resolvePackage('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(process.argv[2]||'http://127.0.0.1:8093/');await page.waitForFunction(()=>!!window.__game,null,{timeout:60000});await page.locator('#loading').waitFor({state:'detached'});await page.waitForTimeout(3000);
 await page.evaluate(()=>{window.requestAnimationFrame=()=>0});await page.waitForTimeout(150);
 const cdp=await ctx.newCDPSession(page);
 const send=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([id,x,y])=>({id,x,y,radiusX:5,radiusY:5,force:1}))});
 const state=()=>page.evaluate(()=>{const g=window.__game;return {x:g.player.pos.x,z:g.player.pos.z,yaw:g.debug().camYaw,dig:g.debug().touchDigHeld,timer:g.player.digTimer,scale:window.visualViewport.scale}});
 const step=n=>page.evaluate(n=>window.__game.stepFrame(1/30,n),n);
 const initial=await state();
 // A sustained diagonal drag: use native browser touches, not DOM dispatch or direct input flags.
 await send('touchStart',[[1,80,670]]);await send('touchMove',[[1,112,636]]);await step(75);const walkMid=await state();await step(75);const walkEnd=await state();await send('touchEnd',[]);await step(20);
 assert.ok(Math.hypot(walkEnd.x-initial.x,walkEnd.z-initial.z)>3,'Joystick walks');
 assert.ok(Math.abs(walkEnd.yaw-initial.yaw)<.0001,'Held joystick must not rotate camera');
 const v1=[walkMid.x-initial.x,walkMid.z-initial.z],v2=[walkEnd.x-walkMid.x,walkEnd.z-walkMid.z];
 const cross=Math.abs(v1[0]*v2[1]-v1[1]*v2[0])/(Math.hypot(...v1)*Math.hypot(...v2));assert.ok(cross<.05,'Held direction remains straight');
 // Right-side drag owns camera yaw and does not snap back afterward.
 await send('touchStart',[[2,220,320]]);await send('touchMove',[[2,280,320]]);await send('touchEnd',[]);const look=await state();await step(45);assert.ok(Math.abs((await state()).yaw-look.yaw)<.001,'Camera holds manual look direction');
 // Instrument actual shovel calls only to measure the UI-driven result.
 await page.evaluate(()=>{const g=window.__game;g.player.setSpawn(70,32);g.player.facing=0;window.qaCount=0;window.qaRemoved=0;window.qaInitial=Array.from(g.terrain.height);const orig=g.terrain.scoopDeform.bind(g.terrain);g.terrain.scoopDeform=(...a)=>{const r=orig(...a);window.qaCount++;window.qaRemoved-=r;return r}});
 const digRect=await page.locator('#digBtn').boundingBox();const dx=digRect.x+digRect.width/2,dy=digRect.y+digRect.height/2;
 await send('touchStart',[[3,dx,dy]]);await step(1);assert.equal(await page.evaluate(()=>window.qaCount),1,'First scoop responds immediately');await step(3);const swing=await state();assert.ok(swing.timer>.06,'Dig animation advances');
 // Keep Dig held with one thumb, steer with the other. The channel should extend.
 await send('touchStart',[[3,dx,dy],[4,80,670]]);await send('touchMove',[[3,dx,dy],[4,80,628]]);const startDig=await state();await step(90);const endDig=await state();
 assert.ok(Math.hypot(endDig.x-startDig.x,endDig.z-startDig.z)>.5,'Can walk slowly while digging');
 await send('touchMove',[[3,dx-70,dy-35],[4,80,628]]);await step(15);assert.ok((await state()).dig,'Captured Dig continues after thumb drifts outside');
 await send('touchEnd',[]);await step(3);assert.equal((await state()).dig,false,'Touch release stops digging');
 const digging=await page.evaluate(()=>({scoops:window.qaCount,removed:window.qaRemoved,lowered:window.__game.terrain.height.reduce((n,h,i)=>n+(h<window.qaInitial[i]-.05?1:0),0),raised:window.__game.terrain.height.reduce((n,h,i)=>n+(h>window.qaInitial[i]+.05?1:0),0)}));
 assert.ok(digging.scoops>=8&&digging.removed>.1&&digging.lowered>2&&digging.raised>2,'Visible hole and spoil result');
 const out=path.resolve(process.env.SHORELINE_QA_OUTPUT||'../outputs/shoreline-touch-qa')+path.sep;fs.mkdirSync(out,{recursive:true});await page.screenshot({path:out+'113-touch-digging.png'});
 // Repeated native taps must never zoom the page. Only +/- changes game distance.
 for(let i=0;i<3;i++){await page.touchscreen.tap(230,300);await page.waitForTimeout(80)}
 assert.equal((await state()).scale,initial.scale,'Double tap cannot zoom the page');
 const zoomBefore=await page.evaluate(()=>window.__game.debug().camDistTarget);await page.locator('#zoomInBtn').tap();assert.ok(await page.evaluate(()=>window.__game.debug().camDistTarget)<zoomBefore,'In-game zoom still works');
 await page.locator('#helpBtn').tap();assert.ok(await page.locator('#controlsDialog').isVisible(),'Touch controls dialog opens');await page.locator('#closeHelp').tap();
 // Hold cancellation must release, including app interruption.
 await send('touchStart',[[5,dx,dy]]);await send('touchCancel',[]);assert.equal((await state()).dig,false,'Touch cancellation releases Dig');
 // Bridge traversal is normal Player movement after placing the approach, with the same ground callback.
 const approach=await page.evaluate(()=>{const g=window.__game,b=g.debug().roadBridge;g.player.setSpawn(b.center.x-b.axis.x*(b.span/2+b.ramp),b.center.z-b.axis.z*(b.span/2+b.ramp));g.player.velocity.set(0,0,0);const yaw=g.debug().camYaw;return {b,ix:b.axis.x*Math.cos(yaw)-b.axis.z*Math.sin(yaw),iy:b.axis.x*Math.sin(yaw)+b.axis.z*Math.cos(yaw)}});
 await send('touchStart',[[6,80,660]]);await send('touchMove',[[6,80+approach.ix*54,660+approach.iy*54]]);
 const bridge=await page.evaluate(()=>{const g=window.__game,b=g.debug().roadBridge;let maxError=0;for(let n=0;n<180;n++){g.stepFrame(.03,1);const along=(g.player.pos.x-b.center.x)*b.axis.x+(g.player.pos.z-b.center.z)*b.axis.z;if(Math.abs(along)<b.span/2-.2)maxError=Math.max(maxError,Math.abs(g.player.pos.y-b.deck));}return {maxError,along:(g.player.pos.x-b.center.x)*b.axis.x+(g.player.pos.z-b.center.z)*b.axis.z,end:[g.player.pos.x,g.player.pos.z],b}});
 await send('touchEnd',[]);
 assert.ok(bridge.maxError<.12&&bridge.along>bridge.b.span/2+1,'Native touch traversal crosses bridge with full collision/physics loop');
 await page.evaluate(()=>{const g=window.__game,b=g.debug().roadBridge;g.camera.position.set(b.center.x+9,b.deck+9,b.center.z+14);g.camera.lookAt(b.center.x,b.deck,b.center.z);g.renderer.render(g.scene,g.camera)});await page.screenshot({path:out+'113-bridge.png'});
 await page.evaluate(()=>{const g=window.__game,p=g.player;g.camera.position.set(p.pos.x+.8,p.pos.y+1.1,p.pos.z+1.8);p.facing=0;p.mesh.rotation.y=0;g.camera.lookAt(p.pos.x,p.pos.y+.58,p.pos.z);g.renderer.render(g.scene,g.camera)});await page.screenshot({path:out+'113-character.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({initial,walkEnd,straightnessCross:cross,look,digging,bridge,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
