'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert');
const {createCanvas,Image,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'paperfig-integration-'));
function makeImage(name,color){const c=createCanvas(1600,800),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1600,800);const p=path.join(out,name);fs.writeFileSync(p,c.toBuffer('image/png'));return p;}
const blobs=new Map();let blobId=0;
class BlobImage extends Image {
  set src(v){if(blobs.has(v)){blobs.get(v).arrayBuffer().then(b=>{super.src=Buffer.from(b);});}else{super.src=v;}}
  get src(){return super.src;}
}
function TestFileReader(){this.readAsArrayBuffer=blob=>{blob.arrayBuffer().then(b=>{this.result=b;this.onload();}).catch(()=>this.onerror());};}
const aPath=makeImage('a.png','#d04020'),bPath=makeImage('b.png','#2040d0');
const cls=()=>{const set=new Set();return {add(...v){v.forEach(x=>set.add(x));},remove(...v){v.forEach(x=>set.delete(x));},toggle(x,on){if(on===undefined)on=!set.has(x);if(on)set.add(x);else set.delete(x);},contains(x){return set.has(x);}};};
const els={};const callbacks={};
function element(id){if(els[id])return els[id];const e=id==='previewCanvas'?createCanvas(1,1):{};Object.assign(e,{id,value:'',checked:false,disabled:false,style:{setProperty(){}},classList:cls(),dataset:{},textContent:'',clientWidth:340,clientHeight:280,type:'',min:'',max:'',children:[],get firstChild(){return this.children[0]||null;},appendChild(c){this.children.push(c);return c;},removeChild(c){this.children.splice(this.children.indexOf(c),1);},blur(){},options:[],parentElement:{classList:cls()},setAttribute(){},getAttribute(){return null;},removeAttribute(){},getBoundingClientRect(){return {left:0,top:0,width:340,height:280};},closest(){return this.parentElement;},addEventListener(n,f){(callbacks[id+':'+n]||(callbacks[id+':'+n]=[])).push(f);},removeEventListener(){},click(){if(!this.disabled)emit(id,'click');}});els[id]=e;return e;}
const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
for(const m of html.matchAll(/<(input|select|button|canvas|div|output|span|p)[^>]*\bid="([^"]+)"[^>]*>/g)){const e=element(m[2]);e.type=(/type="([^"]+)"/.exec(m[0])||[])[1]||'';e.min=(/min="([^"]*)"/.exec(m[0])||[])[1]||'';e.max=(/max="([^"]*)"/.exec(m[0])||[])[1]||'';e.checked=/\bchecked\b/.test(m[0]);e.value=(/value="([^"]*)"/.exec(m[0])||[])[1]||'';}
element('format').options=['TIFF','PNG','JPEG'].map(x=>({value:x,text:x}));
function emit(id,n,event={}){for(const f of callbacks[id+':'+n]||[])f(Object.assign({preventDefault(){},target:element(id)},event));}
const storage={paperfig_ui_lang:'en'};let failWrite=false,writeDelay=0;
const fsMock=Object.assign({},fs,{writeFile(p,b,cb){setTimeout(()=>{if(failWrite){cb(new Error('simulated disk failure'));}else fs.writeFile(p,b,cb);},writeDelay);}});
const doc={name:'mock.ai',fullName:{fsName:path.join(out,'mock.ai')},selection:[]};
const allPlaced=[];function placed(id,p){const it={uuid:id,name:id,typename:'PlacedItem',embedded:false,file:{fsName:p,name:path.basename(p),exists:true,length:12},width:200,height:100,position:[0,100],geometricBounds:[0,100,200,0],matrix:{mValueA:1,mValueB:0,mValueC:0,mValueD:-1,mValueTX:0,mValueTY:0},relink(f){this.file={fsName:f.fsName||f,name:path.basename(f.fsName||f),exists:true,length:12};},rotate(angle){this.matrix.mValueA=Math.cos(angle*Math.PI/180);this.matrix.mValueB=Math.sin(angle*Math.PI/180);},resize(){},remove(){/* place-replace mock keeps the same object */},move(){},selected:false,translate(){}};allPlaced.push(it);return it;}
doc.placedItems={_: [], add(){
  /* Integration mock: mutate the place-target (or selection) so test refs stay valid. */
  const target=allPlaced.find(x=>x&&x.__sciPlaceTarget)||(doc.selection&&doc.selection[0])||placed('P'+this._.length,'');
  const proxy={
    get typename(){return 'PlacedItem';},
    get uuid(){return target.uuid;},
    get name(){return target.name;},
    get embedded(){return target.embedded;},
    get file(){return target.file;},
    set file(f){target.file={fsName:f.fsName||f,name:path.basename(f.fsName||f),exists:true,length:12};},
    get width(){return target.width;}, set width(v){target.width=v;},
    get height(){return target.height;}, set height(v){target.height=v;},
    get position(){return target.position;}, set position(v){target.position=v;},
    get geometricBounds(){return target.geometricBounds;},
    get matrix(){return target.matrix;},
    get selected(){return target.selected;}, set selected(v){target.selected=v;},
    move(){}, translate(){}, remove(){},
    __target: target
  };
  this._.push(proxy); return proxy;
}};
const a=placed('A',aPath),b=placed('B',bPath),duplicate=placed('C',aPath);doc.selection=[a];
const host={app:{documents:[doc],activeDocument:doc,redraw(){},getIdentityMatrix(){return {mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0};}},File:function(p){this.fsName=p;this.name=path.basename(p);this.exists=fs.existsSync(p);this.length=fs.existsSync(p)?fs.statSync(p).size:0;},ElementPlacement:{PLACEBEFORE:0}};vm.createContext(host);vm.runInContext(fs.readFileSync(path.join(root,'jsx/bitmap.jsx'),'utf8'),host);
const Core=require(path.join(root,'client/bitmap-core.js'));
let init,errors=[];const nodeRequire=m=>m==='fs'?fsMock:m==='os'?{tmpdir:()=>out,homedir:()=>out}:require(m);
const ctx={console,Image:BlobImage,Blob,FileReader:TestFileReader,Uint8ClampedArray,Float32Array,Buffer,Promise,Date,Math,Number,String,Object,Array,JSON,isFinite,parseFloat,parseInt,setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=v;}},SystemPath:{EXTENSION:'ext'},CSInterface:function(){this.getSystemPath=()=>root;this.evalScript=(s,cb)=>{setTimeout(()=>{try{cb(String(vm.runInContext(s,host)));}catch(e){errors.push(e.message);cb('EvalScript error.');}},0);}},document:{getElementById:element,querySelector(sel){if(String(sel).indexOf('[data-tab].active')>=0)return {getAttribute(){return 'adjust';}};return null;},createElement(t){return t==='canvas'?createCanvas(1,1):element('new-'+Math.random());},querySelectorAll(){return Object.values(els).filter(x=>x.type||x.id==='format'||x.id==='lut');},addEventListener(n,f){if(n==='DOMContentLoaded')init=f;},removeEventListener(){}},window:{URL:{createObjectURL(blob){const id='blob:test-'+(++blobId);blobs.set(id,blob);return id;},revokeObjectURL(id){blobs.delete(id);}},require:nodeRequire,SciBitmapCore:Core,SciBitmapWorkflow:require(path.join(root,'client/bitmap-workflow.js')),SciBitmapFiji:{},requestAnimationFrame:f=>setTimeout(f,0),addEventListener(){},removeEventListener(){}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'client/i18n.js'),'utf8'),ctx);ctx.PaperFigI18n=ctx.window.PaperFigI18n;if(ctx.PaperFigI18n){ctx.PaperFigI18n.setVersion(require(path.join(root,'package.json')).version);ctx.PaperFigI18n.setLang('en');}
['file-stamp.js','bitmap-output.js','interaction-policy.js','bitmap-panel-marquee.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(root,'client',f),'utf8'),ctx));
let source=fs.readFileSync(path.join(root,'client/bitmap-panel.js'),'utf8');
source=source.replace("  document.addEventListener('DOMContentLoaded', init);",`  window.__test={poll:pollSelection,down:onCropPointerDown,armCrop:function(){cropDrawArmed=true;},move:onCropPointerMove,up:onCropPointerUp,escape:onCropEscape,crop:readCropRect,writeCrop:writeCropRect,rect:getDisplayedImageClientRect,setZoom:setPreviewZoom,pointer:pointerToImagePx,panBy:function(dx,dy){previewViewPanX+=dx;previewViewPanY+=dy;applyPreviewView();},prepareBatch:prepareBatch,runBatch:runBatch,stopBatch:function(){batchStop=true;},batch:function(){return batchReview;},currentRecipe:currentRecipe,loadWorkflowImage:loadWorkflowImage,inspectSelection:inspectSelection,applyPipeline:applyPipeline,runArtboardPreview:runArtboardPreview,cancelArtboardPreview:cancelArtboardPreview,renderPreviewCanvas:renderPreviewCanvas,samplePreviewNeighborhood:samplePreviewNeighborhood,stop:function(){clearInterval(pollTimer);},state:function(){return {previewIsSource:previewIsSource,previewLoadToken:previewLoadToken,cropDrag:cropDrag,previewBase:previewBase,previewBaseDrag:previewBaseDrag,lastObjectKey:lastObjectKey,applyRunning:applyRunning,artboardPreviewRunning:artboardPreviewRunning,artboardPreviewActive:artboardPreviewActive,original:artboardPreviewOriginalPath,file:artboardPreviewFile,cache:panelPreviewCacheBytes,sourceImageSize:sourceImageSize};}};\n  document.addEventListener('DOMContentLoaded', init);`);
vm.runInContext(source,ctx);const api=ctx.window.__test;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){for(let i=0;i<300;i++){if(fn())return;await sleep(10);}throw new Error('Timed out; notice='+element('notice').textContent+'; preview='+element('previewStatus').textContent+'; message='+element('previewMessage').textContent+'; errors='+JSON.stringify(errors)+'; state='+JSON.stringify(api.state(),(k,v)=>k==='data'?'pixels':v));}
let n=0;async function test(name,f){await f();n++;console.log('PASS '+name);}
(async()=>{
init();api.armCrop();element('format').value='PNG';await sleep(100);await api.inspectSelection({quiet:false});await waitFor(()=>api.state().previewBase);api.stop();
await test('Initial PNG load builds 800px and 400px buffers',async()=>{assert.equal(api.state().previewBase.width,800);assert.equal(api.state().previewBaseDrag.width,400);});
function point(x,y){const r=api.rect();return {clientX:r.left+(x/r.iw)*r.width,clientY:r.top+(y/r.ih)*r.height,button:0,preventDefault(){},target:element('previewStage')};}
function crop(l,t,w,h){element('cropAspectMode').value='free';api.writeCrop(l,t,w,h);}
await test('AI translation polling keeps the exact preview buffer and does not restart decoding',async()=>{
 const before=api.state().previewBase,token=api.state().previewLoadToken;for(let i=0;i<4;i++){a.matrix.mValueTX+=20;a.matrix.mValueTY+=15;a.geometricBounds=a.geometricBounds.map(v=>v+10);await api.inspectSelection({quiet:true});assert.strictEqual(api.state().previewBase,before);assert.equal(api.state().previewLoadToken,token);}assert(api.state().previewIsSource);
});
await test('Preview follows display matrix while crop overlay stays axis-aligned',async()=>{
 // Realistic AI image matrix: inherent negative D (upright on artboard). FM → CSS without scaleY(-1).
 a.matrix.mValueA=1;a.matrix.mValueB=0;a.matrix.mValueC=0;a.matrix.mValueD=-1;a.width=200;a.height=100;await api.inspectSelection({quiet:false});
 assert(api.state().previewIsSource);
 assert(element('previewTransform').style.transform.includes('matrix(1,0,0,1,0,0)')||element('previewTransform').style.transform.includes('translate(-50%, -50%) matrix(1,0,0,1,0,0)')||/matrix\(1,0,0,1/.test(element('previewTransform').style.transform));
 // Rotated ~37° with inherent image Y flip (det<0 ⇒ no user reflection). FM: negate B,D.
 a.matrix.mValueA=0.8;a.matrix.mValueB=0.6;a.matrix.mValueC=0.6;a.matrix.mValueD=-0.8;a.width=180;a.height=230;await api.inspectSelection({quiet:false});assert(api.state().previewIsSource);assert.equal(api.rect().iw,1600);assert.equal(api.rect().ih,800);assert(element('previewTransform').style.transform.includes('matrix(0.8,-0.6,0.6,0.8,0,0)'));
 const ot=(element('cropOverlay').style.transform||'').trim();
 assert(ot===''||ot==='none'||ot==='matrix(1,0,0,1,0,0)');
 api.writeCrop(100,100,500,300);
 assert(((element('cropOverlay').style.transform)||'').trim()===''||((element('cropOverlay').style.transform)||'').trim()==='none'||((element('cropOverlay').style.transform)||'').trim()==='matrix(1,0,0,1,0,0)');
 // Flat screen draw stores overlay coords directly (no AABB inflation)
 api.down(point(200,100));api.move(point(600,400));api.up();
 let r=api.crop();
 assert.deepEqual([r.left,r.top,r.width,r.height],[200,100,400,300]);
 // Free interior move under rotation preserves W×H
 api.down(point(350,220));assert.equal(api.state().cropDrag.mode,'move');
 api.move(point(450,290));api.up();
 r=api.crop();
 assert.deepEqual([r.left,r.top,r.width,r.height],[300,170,400,300]);
 // Upright AI image matrix again (negative D) so later asserts stay screen≡source after FM→identity
 a.matrix.mValueA=1;a.matrix.mValueB=0;a.matrix.mValueC=0;a.matrix.mValueD=-1;a.width=200;a.height=100;await api.inspectSelection({quiet:false});
});
await test('Free crop interior drag translates without resizing',async()=>{
 crop(100,100,500,300);api.down(point(350,250));assert.equal(api.state().cropDrag.mode,'move');api.move(point(450,320));api.up();let r=api.crop();assert.deepEqual([r.left,r.top,r.width,r.height],[200,170,500,300]);
});
await test('Dragging against image boundaries preserves crop dimensions',async()=>{
 crop(100,100,500,300);api.down(point(350,250));api.move(point(1590,790));api.up();let r=api.crop();assert.deepEqual([r.left,r.top,r.width,r.height],[1100,500,500,300]);
});
await test('Free crop can draw outside the existing rectangle and resize each dimension',async()=>{
 crop(100,100,200,200);api.down(point(600,100));api.move(point(1000,350));api.up();let r=api.crop();assert.deepEqual([r.left,r.top,r.width,r.height],[600,100,400,250]);
 const e=point(1000,350);e.target={getAttribute:()=> 'se'};api.down(e);api.move(point(1100,500));api.up();r=api.crop();assert.deepEqual([r.width,r.height],[500,400]);
});
await test('Aspect-locked crop still moves freely',async()=>{
 crop(100,100,300,300);element('cropAspectMode').value='1:1';api.down(point(250,250));api.move(point(400,330));api.up();let r=api.crop();assert.deepEqual([r.left,r.top,r.width,r.height],[250,180,300,300]);
});
await test('Fixed-pixel crop can move and does not resize',async()=>{
 crop(100,100,400,200);element('cropAspectMode').value='fixed';element('cropFixedW').value=400;element('cropFixedH').value=200;api.down(point(300,200));api.move(point(500,300));api.up();let r=api.crop();assert.deepEqual([r.left,r.top,r.width,r.height],[300,200,400,200]);
});
await test('Polling cannot reset the preview while crop drag is active',async()=>{
 crop(100,100,300,200);api.down(point(250,200));const before=api.state().previewBase,token=api.state().previewLoadToken;await api.poll();assert.strictEqual(api.state().previewBase,before);assert.equal(api.state().previewLoadToken,token);api.move(point(300,250));api.up();
});
await test('Escape restores the complete pre-drag crop',async()=>{
 crop(100,100,300,200);api.down(point(250,200));api.move(point(300,250));api.escape({key:'Escape'});let r=api.crop();assert.deepEqual([r.left,r.top,r.width,r.height],[100,100,300,200]);assert.equal(api.state().cropDrag,null);
});
await test('Right mouse button cannot start or change a crop',async()=>{
 const before=api.crop(),e=point(1200,100);e.button=2;api.down(e);assert.equal(api.state().cropDrag,null);assert.deepEqual(api.crop(),before);
});
await test('Transient empty AI selection does not clear preview; persistent empty does',async()=>{
 const before=api.state().previewBase;doc.selection=[];await api.poll();assert.strictEqual(api.state().previewBase,before);doc.selection=[a];await api.poll();assert.strictEqual(api.state().previewBase,before);doc.selection=[];await api.poll();await api.poll();assert.equal(api.state().previewBase,null);doc.selection=[a];await api.inspectSelection({quiet:false});
});
await test('Zoom keeps the anchored source pixel and pan shifts the hit box',async()=>{
 api.setZoom(1);
 const before=api.rect();
 const ax=before.left+before.width*0.3, ay=before.top+before.height*0.4;
 const src=api.pointer(ax,ay);
 api.setZoom(4,ax,ay);
 const again=api.pointer(ax,ay);
 assert(Math.abs(again.x-src.x)<1.5, again.x+' vs '+src.x);
 assert(Math.abs(again.y-src.y)<1.5, again.y+' vs '+src.y);
 const zoomed=api.rect();
 assert(zoomed.width>before.width*3.5, zoomed.width+' vs '+before.width);
 api.panBy(40,-20);
 const moved=api.rect();
 assert(Math.abs((moved.left-zoomed.left)-40)<1.5, moved.left-zoomed.left);
 const shifted=api.pointer(ax,ay);
 assert(Math.abs(shifted.x-src.x)>1);
 api.setZoom(1);
 const fit=api.rect();
 assert(Math.abs(fit.width-before.width)<1.5);
 assert(Math.abs(fit.left-before.left)<1.5);
});
await test('Replacement refresh never nudges artwork and redraws at most once',async()=>{
 let nudges=0,redraws=0;const old=host.app.redraw;host.app.redraw=()=>redraws++;host.sciBitmapForceArtboardRefresh({typename:'PlacedItem',translate(){nudges++;}});host.app.redraw=old;assert.equal(nudges,0);assert.equal(redraws,1);
});
assert.deepEqual(errors,[]);console.log('\n'+n+' integration simulations passed (real Canvas pixels; mocked Adobe host).');
api.stop();fs.rmSync(out,{recursive:true,force:true});process.exit(0);
})().catch(e=>{console.error(e);api.stop();fs.rmSync(out,{recursive:true,force:true});process.exit(1);});
async function pixel(p){const im=await loadImage(fs.readFileSync(p));const c=createCanvas(im.width,im.height);c.getContext('2d').drawImage(im,0,0);return Array.from(c.getContext('2d').getImageData(0,0,1,1).data);}
