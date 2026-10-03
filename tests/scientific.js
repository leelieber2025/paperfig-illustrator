'use strict';const assert=require('assert'),S=require('../client/scientific-core'),fixture=require('./raw-fixture'),vm=require('vm'),fs=require('fs'),path=require('path');let tests=0;
function test(n,f){f();tests++;console.log('PASS '+n);}
let d;
test('Native OME reads true 16-bit planes and micrometer metadata in both byte orders',()=>{for(const le of [true,false]){d=S.nativeTiff(fixture({le}));assert.equal(d.bits,16);assert.equal(d.planes[0][3],65535);assert.equal(d.planes[1][3],60000);assert.deepEqual(d.physical,{x:0.25,y:0.5});assert.deepEqual(d.names,['C1','C2']);}});
test('Exact histogram and strict clipping distinguish endpoint pixels',()=>{let r=S.recipe(d);r.channels[0].low=100;r.channels[0].high=4000;const stats=S.statistics(d,r)[0];assert.equal(stats.below,1);assert.equal(stats.above,2);assert.equal(stats.atLow,1);assert.equal(stats.atHigh,1);assert.equal(stats.sensorMaximum,1);assert.equal(d.histograms[0][1000],1);});
test('Linear raw mapping and gamma are explicit; source plane stays immutable',()=>{let r=S.recipe(d);r.channels[1].visible=false;r.channels[0].color='#ffffff';r.channels[0].high=2000;let im=S.render(d,r);assert.deepEqual([...im.data.slice(8,12)],[128,128,128,255]);assert.equal(d.planes[0][2],1000);r.gamma=2;im=S.render(d,r);assert.equal(im.data[8],180);assert.equal(r.clahe,false);});
test('keepChannels selects one or two of three acquisition planes',()=>{
  const f=fixture({planes:[[100,0,0,0,0,0,0,0],[0,200,0,0,0,0,0,0],[0,0,300,0,0,0,0,0]],xml:'<OME><Image><Pixels DimensionOrder="XYCZT" SizeX="4" SizeY="2" SizeC="3" SizeZ="1" SizeT="1"><Channel Name="C1"/><Channel Name="C2"/><Channel Name="C3"/><TiffData/></Pixels></Image></OME>'});
  const d3=S.nativeTiff(f);assert.deepEqual(d3.names,['C1','C2','C3']);
  let r=S.keepChannels(d3,null,[true,false,false]);r.channels[0].color='#ffffff';r.channels[0].high=200;
  let im=S.render(d3,r);assert.deepEqual([...im.data.slice(0,4)],[128,128,128,255]);
  r=S.keepChannels(d3,null,[true,true,false]);r.channels[0].color='#ff0000';r.channels[1].color='#00ff00';r.channels[0].high=100;r.channels[1].high=200;
  im=S.render(d3,r);assert.equal(im.data[0],255);assert.equal(im.data[1],0);assert.equal(im.data[2],0);
  assert.equal(im.data[4],0);assert.equal(im.data[5],255);assert.equal(im.data[6],0);
  assert.throws(()=>S.keepChannels(d3,null,[false,false,false]));
});
test('Group signature rejects reordered channel names and mismatched bit depth',()=>{let r=S.recipe(d);assert.throws(()=>S.recipe({...d,names:['C2','C1']},r));assert.throws(()=>S.recipe({...d,bits:8},r));assert.throws(()=>S.recipe(d,{channels:[{low:1,high:0}]}));});
test('OME DimensionOrder maps C/Z planes; Z/T bounds are checked',()=>{let xml='<OME><Image><Pixels DimensionOrder="XYZCT" SizeX="4" SizeY="2" SizeC="2" SizeZ="2" SizeT="1"><Channel Name="A"/><Channel Name="B"/><TiffData/></Pixels></Image></OME>';let f=fixture({xml,planes:[[1,1,1,1,1,1,1,1],[2,2,2,2,2,2,2,2],[3,3,3,3,3,3,3,3],[4,4,4,4,4,4,4,4]]});let r=S.nativeTiff(f,{z:1});assert.equal(r.planes[0][0],2);assert.equal(r.planes[1][0],4);assert.throws(()=>S.nativeTiff(f,{z:2}));});
test('Unsupported layouts and truncated raw data fail closed',()=>{assert.throws(()=>S.nativeTiff(fixture({compression:5})));assert.throws(()=>S.nativeTiff(fixture().subarray(0,200)));assert.throws(()=>S.nativeTiff(fixture({xml:'<not-ome/>'})));});
test('Manual full-field calibration, two-point calibration and cropped scale fraction',()=>{let cal=S.calibration({method:'field',width:200,unit:'um',pixelsX:2000,pixelsY:1000});assert.equal(cal.umPerPixelX,0.1);assert.equal(cal.coordSpace,'full-source');assert.equal(S.scaleFraction(cal,20,'um',1000),0.2);assert.equal(S.scaleFraction(cal,20,'um',500),0.4);/* same 碌m/px, narrower crop 鈫?longer fraction */cal=S.calibration({method:'two-point',points:[{x:10,y:20},{x:210,y:20}],length:20,unit:'um'});assert.equal(cal.umPerPixelX,0.1);assert.equal(cal.coordSpace,'full-source');cal=S.calibration({method:'two-point',points:[{x:10,y:20},{x:20,y:100}],length:20,unit:'um'});assert(Math.abs(cal.umPerPixelX-20/Math.sqrt(10*10+80*80))<1e-9);assert.throws(()=>S.calibration({method:'two-point',points:[{x:10,y:20},{x:11,y:20}],length:20,unit:'um'}));assert.throws(()=>S.scaleFraction({umPerPixelX:0.1},200,'um',1000));let same=S.scaleAudit([{umPerPixelX:0.1},{umPerPixelX:0.1004}]);assert.equal(same.mismatch,false);let diff=S.scaleAudit([{umPerPixelX:0.1},{umPerPixelX:0.2}]);assert.equal(diff.mismatch,true);assert.equal(diff.calibrated,2);});
const host={app:{getIdentityMatrix(){return {mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0};}},Transformation:{DOCUMENTORIGIN:0}};vm.createContext(host);vm.runInContext(fs.readFileSync(path.join(__dirname,'../jsx/bitmap.jsx'),'utf8'),host);
function mul(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function item(m){return {boundingBox:[0,0,100,-50],file:{fsName:'/before'},m:m,get matrix(){return Object.fromEntries(['A','B','C','D','TX','TY'].map((k,i)=>['mValue'+k,this.m[i]]));},get geometricBounds(){let b=this.boundingBox,p=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]].map(([x,y])=>[this.m[0]*x+this.m[2]*y+this.m[4],this.m[1]*x+this.m[3]*y+this.m[5]]);return [Math.min(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1]))];},relink(f){this.file=f;this.boundingBox=f.fsName==='/before'?[0,0,100,-50]:[0,0,300,-80];},transform(m){this.m=mul(['A','B','C','D','TX','TY'].map(k=>m['mValue'+k]),this.m);}};}
function scaleGroupMock(target){
  const groups=[];
  const layer={typename:'Layer'};
  target.parent=layer;
  target.move=function(relative,placement){this.parent=placement===host.ElementPlacement.PLACEATEND?relative:relative.parent;};
  groups.add=function(){
    const g={typename:'GroupItem',parent:layer,name:'',note:'',lines:[],texts:[],pageItems:[],
      pathItems:{add(){const line={setEntirePath(p){this.points=p;}};g.lines.push(line);return line;}},
      textFrames:{add(){const frame={contents:'',width:20,textRange:{characterAttributes:{}}};g.texts.push(frame);return frame;}},
      move(relative,placement){this.parent=placement===host.ElementPlacement.PLACEATEND?relative:relative.parent;},
      zOrder(){},remove(){const at=groups.indexOf(this);if(at>=0)groups.splice(at,1);}};
    groups.push(g);return g;
  };
  host.ElementPlacement={PLACEBEFORE:0,PLACEAFTER:1,PLACEATEND:2};
  host.ZOrderMethod={BRINGTOFRONT:0};
  return groups;
}
function scaleBarGroup(groups){return groups.filter(g=>g.note&&g.note.indexOf('SCI_SCALE_V1:')===0)[0];}
test('Exact relink preserves four corners under rotation, flip and shear',()=>{for(const m of [[1,0,0,1,10,20],[0,2,-2,0,30,40],[-1,0,0,1,5,8],[0.8,0.6,0.3,1.2,70,80]]){let i=item(m),before=host.sciBitmapCorners(i);host.sciBitmapRelinkExact(i,{fsName:'/after'});let after=host.sciBitmapCorners(i);for(let p=0;p<4;p++)for(let k=0;k<2;k++)assert(Math.abs(before[p][k]-after[p][k])<1e-6);}});
console.log('\n'+tests+' scientific checks passed.');
test('Vector bar creates editable line/text, records calibration and replaces only own generated group',()=>{let target=item([1,0,0.3,1,20,80]);Object.assign(target,{typename:'PlacedItem',embedded:false,uuid:'scale-test',name:'test',file:{fsName:'/before',name:'before.tif',exists:true}});const groups=scaleGroupMock(target);let doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[target],groupItems:groups};host.app.documents=[doc];host.app.activeDocument=doc;host.app.redraw=function(){};host.RGBColor=function(){};let lock=JSON.parse(host.captureSelectionLock()).lock;let s={fraction:0.2,lineWidth:1,fontSize:9,margin:5,position:'bottom-right',color:'#ffffff',label:'20 碌m',length:20,unit:'um',displayPixelsX:1000,calibration:{umPerPixelX:0.1}};let result=JSON.parse(host.sciBitmapScaleBar(JSON.stringify(lock),JSON.stringify(s)));assert(result.ok,result.error);assert.equal(groups.length,2);assert.equal(scaleBarGroup(groups).texts[0].contents,'20 碌m');let pts=scaleBarGroup(groups).lines[0].points;assert(Math.abs(Math.hypot(pts[1][0]-pts[0][0],pts[1][1]-pts[0][1])-20)<1e-6);assert(scaleBarGroup(groups).note.includes('umPerPixelX'));result=JSON.parse(host.sciBitmapScaleBar(JSON.stringify(lock),JSON.stringify(s)));assert(result.ok,result.error);result=JSON.parse(host.sciBitmapScaleBar(JSON.stringify(lock),JSON.stringify(s)));assert(result.ok,result.error);assert.equal(groups.length,2);});
test('Vector bar omit text when includeText is false and restore on update',()=>{
  let target=item([1,0,0.3,1,20,80]);
  Object.assign(target,{typename:'PlacedItem',embedded:false,uuid:'scale-notext',name:'test',file:{fsName:'/before',name:'before.tif',exists:true}});
  const groups=scaleGroupMock(target);
  let doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[target],groupItems:groups};
  host.app.documents=[doc];host.app.activeDocument=doc;host.app.redraw=function(){};host.RGBColor=function(){};
  let lock=JSON.parse(host.captureSelectionLock()).lock;
  const base={fraction:0.2,lineWidth:1,fontSize:9,margin:5,position:'bottom-right',color:'#ffffff',label:'20 µm',length:20,unit:'um',displayPixelsX:1000,calibration:{umPerPixelX:0.1}};
  let result=JSON.parse(host.sciBitmapScaleBar(JSON.stringify(lock),JSON.stringify(Object.assign({},base,{includeText:false}))));
  assert(result.ok,result.error);
  assert.equal(groups.length,2);
  assert.equal(scaleBarGroup(groups).texts.length,0,'no text frame when includeText=false');
  assert.equal(scaleBarGroup(groups).lines.length,1);
  result=JSON.parse(host.sciBitmapScaleBar(JSON.stringify(lock),JSON.stringify(Object.assign({},base,{includeText:true}))));
  assert(result.ok,result.error);
  assert.equal(groups.length,2,'update replaces prior bar');
  assert.equal(scaleBarGroup(groups).texts.length,1);
  assert.equal(scaleBarGroup(groups).texts[0].contents,'20 µm');
  result=JSON.parse(host.sciBitmapScaleBar(JSON.stringify(lock),JSON.stringify(Object.assign({},base,{includeText:false}))));
  assert(result.ok,result.error);
  assert.equal(groups.length,2);
  assert.equal(scaleBarGroup(groups).texts.length,0,'update with includeText=false removes text');
});
test('Scale bar bottom-left/right stay at visual bottom with BL-first corners',()=>{
  /* Linked upright place often uses det<0 (negative D) 鈫?sciBitmapCorners BL-first (V toward visual top). */
  let target=item([1,0,0,-1,20,80]);
  Object.assign(target,{typename:'PlacedItem',embedded:false,uuid:'scale-bl-first',name:'test',file:{fsName:'/before',name:'before.tif',exists:true}});
  const corners=host.sciBitmapCorners(target);
  const topEdge=(corners[0][1]+corners[1][1])*0.5, botEdge=(corners[2][1]+corners[3][1])*0.5;
  assert(topEdge<botEdge,'expected BL-first corners (p0/p1 below p2/p3)');
  const gb=target.geometricBounds; /* [left, top, right, bottom], top>bottom */
  const groups=scaleGroupMock(target);
  let doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[target],groupItems:groups};
  host.app.documents=[doc];host.app.activeDocument=doc;host.app.redraw=function(){};host.RGBColor=function(){};
  let lock=JSON.parse(host.captureSelectionLock()).lock;
  function place(position){
    groups.length=0;
    const s={fraction:0.2,lineWidth:1,fontSize:9,margin:5,position,color:'#ffffff',label:'10 碌m',length:10,unit:'um',displayPixelsX:1000,calibration:{umPerPixelX:0.1}};
    const result=JSON.parse(host.sciBitmapScaleBar(JSON.stringify(lock),JSON.stringify(s)));
    assert(result.ok,result.error||position);
    return scaleBarGroup(groups).lines[0].points;
  }
  const br=place('bottom-right');
  const bl=place('bottom-left');
  const midY=0.5*(gb[1]+gb[3]);
  assert(br[0][1]<midY&&br[1][1]<midY,'bottom-right bar must sit in lower half (got y='+br[0][1]+', mid='+midY+')');
  assert(bl[0][1]<midY&&bl[1][1]<midY,'bottom-left bar must sit in lower half (got y='+bl[0][1]+', mid='+midY+')');
  assert(bl[0][0]<br[0][0],'bottom-left must be left of bottom-right');
  /* UV fallback: slight shear so geometricBounds axis-aligned shortcut is skipped. */
  target.m=[1,0,0.4,-1,20,80];
  lock=JSON.parse(host.captureSelectionLock()).lock;
  const brUv=place('bottom-right');
  const gb2=target.geometricBounds;
  const midY2=0.5*(gb2[1]+gb2[3]);
  assert(brUv[0][1]<midY2&&brUv[1][1]<midY2,'UV fallback bottom-right must stay in lower half');
});
test('0.6.0 upright crop place resets aspect and clears diagonal FitCorners stretch',()=>{
  let removed=false;
  const old={
    typename:'PlacedItem', embedded:false, uuid:'u1', name:'img',
    file:{fsName:'/before.png',name:'before.png',exists:true,length:12},
    boundingBox:[0,0,100,-50],
    m:[0.8,0.6,-0.3,0.9,40,60],
    get matrix(){return {mValueA:this.m[0],mValueB:this.m[1],mValueC:this.m[2],mValueD:this.m[3],mValueTX:this.m[4],mValueTY:this.m[5]};},
    get geometricBounds(){let b=this.boundingBox,p=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]].map(([x,y])=>[this.m[0]*x+this.m[2]*y+this.m[4],this.m[1]*x+this.m[3]*y+this.m[5]]);return [Math.min(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1]))];},
    get width(){const g=this.geometricBounds;return Math.abs(g[2]-g[0]);},
    get height(){const g=this.geometricBounds;return Math.abs(g[1]-g[3]);},
    get position(){const g=this.geometricBounds;return [g[0],g[1]];},
    remove(){removed=true;}, move(){}, translate(){}, selected:false
  };
  const replacement={
    typename:'PlacedItem', embedded:false, uuid:'u2', name:'crop',
    _file:null, boundingBox:[0,0,1,-1], m:[1,0,0,1,0,0], _w:1, _h:1, _pos:[0,0],
    get file(){return this._file;},
    set file(f){this._file={fsName:f.fsName||f,name:'crop.png',exists:true,length:12};this.boundingBox=[0,0,400,-300];this.m=[1,0,0,1,0,0];this._w=400;this._h=300;},
    get matrix(){return {mValueA:this.m[0],mValueB:this.m[1],mValueC:this.m[2],mValueD:this.m[3],mValueTX:this.m[4],mValueTY:this.m[5]};},
    get geometricBounds(){return [this._pos[0], this._pos[1], this._pos[0]+this._w, this._pos[1]-this._h];},
    get width(){return this._w;}, set width(v){this._w=v; this.m=[1,0,0,1,this.m[4],this.m[5]];},
    get height(){return this._h;}, set height(v){this._h=v; this.m=[1,0,0,1,this.m[4],this.m[5]];},
    get position(){return this._pos.slice();}, set position(v){this._pos=[v[0],v[1]]; this.m[4]=v[0]; this.m[5]=v[1];},
    move(){}, remove(){}, translate(){}, selected:false
  };
  const beforeAspect=old.width/old.height;
  const doc={name:'t.ai',fullName:{fsName:'/t.ai'},selection:[old],placedItems:{add(){return replacement;}}};
  host.app.documents=[doc];host.app.activeDocument=doc;host.app.redraw=function(){};
  host.ElementPlacement={PLACEBEFORE:0};
  const file={fsName:'/crop-400x300.png',name:'crop-400x300.png',exists:true,length:12};
  const result=host.sciBitmapPlaceUprightCrop(old,file,400,300);
  assert.strictEqual(result,replacement);
  assert(removed,'old item should be removed');
  const aspect=result.width/result.height;
  assert(Math.abs(aspect-400/300)<1e-6,'expected upright 4:3, got '+aspect+' (old frame was '+beforeAspect+')');
  assert.equal(result.matrix.mValueB,0);
  assert.equal(result.matrix.mValueC,0);
  /* FitCorners path would keep beforeAspect (~sheared); upright must differ when crop aspect differs. */
  assert(Math.abs(aspect-beforeAspect)>0.05);
});
console.log('Total scientific checks: '+tests);

test('0.8.6 inset matches side height, non-crossing leaders, styled frame, scale bar, and replaces its own group',()=>{
  const target=item([1,0,0,1,10,80]);
  Object.assign(target,{typename:'PlacedItem',embedded:false,uuid:'inset-src',name:'main',file:{fsName:'/main.png',name:'main.png',exists:true},width:200,height:100,boundingBox:[0,0,200,-100]});
  const groups=[];
  groups.add=function(){let g={name:'',note:'',lines:[],texts:[],_children:[],pathItems:{add(){let l={closed:false,filled:true,stroked:false,strokeWidth:0,strokeColor:null,strokeDashes:null,strokeJoin:null,strokeCap:null,points:null,setEntirePath(p){this.points=p;},move(){}};g.lines.push(l);return l;}},textFrames:{add(){let t={contents:'',width:20,position:null,textRange:{characterAttributes:{}}};g.texts.push(t);return t;}},remove(){const i=groups.indexOf(g);if(i>=0)groups.splice(i,1);}};groups.push(g);return g;};
  const placed=[];
  placed.add=function(){const it={typename:'PlacedItem',embedded:false,uuid:'p'+placed.length,file:null,width:10,height:10,position:[0,0],
    get boundingBox(){return [0,0,this.width,-this.height];},
    get matrix(){return {mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:this.position[0],mValueTY:this.position[1]};},
    get geometricBounds(){return [this.position[0], this.position[1], this.position[0]+this.width, this.position[1]-this.height];},
    remove(){const i=placed.indexOf(this); if(i>=0)placed.splice(i,1);},
    move(group){ if(group&&group._children) group._children.push(this); this._parent=group; }
  }; placed.push(it); return it;};
  const doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[target],groupItems:groups,placedItems:placed,pathItems:{
    roundedRectangle(top,left,w,h,rx,ry){const p={rounded:{top,left,w,h,rx,ry},closed:true,points:[[left,top],[left+w,top],[left+w,top-h],[left,top-h]],strokeWidth:0,strokeDashes:null,strokeJoin:null,strokeCap:null,setEntirePath(){},move(group){if(group&&group.lines)group.lines.push(this); return this;}}; return p;}
  }};
  host.app.documents=[doc]; host.app.activeDocument=doc; host.app.redraw=function(){};
  host.RGBColor=function(){};
  host.File=function(p){this.fsName=p;this.exists=p!=='/missing.png';};
  host.ElementPlacement={PLACEBEFORE:0,PLACEATEND:1,PLACEATBEGINNING:2};
  host.StrokeJoin={MITERENDJOIN:0,ROUNDENDJOIN:1,BEVELENDJOIN:2};
  host.StrokeCap={BUTTENDCAP:0,ROUNDENDCAP:1};
  const lock=JSON.parse(host.captureSelectionLock()).lock;
  const spec={file:'/inset.png',norm:{x:0.25,y:0.2,w:0.5,h:0.4},magnification:2,gap:8,anchor:'right',
    frame:{weight:2,color:'#ffcc00',dashes:[6,4],corner:'miter',radius:0},
    leaders:{enabled:true,weight:0.75,color:'#00aaff',dashes:[1,2.5],corner:'round',radius:0},
    scaleBar:{fraction:0.25,lineWidth:1.25,fontSize:8,margin:4,position:'bottom-right',color:'#ffffff',label:'10 碌m',displayPixelsX:100,calibration:{umPerPixelX:0.1}}};
  let result=JSON.parse(host.sciBitmapInset(JSON.stringify(lock), JSON.stringify(spec)));
  assert(result.ok, result.error);
  assert.equal(result.scaleBar, true);
  assert(Math.abs(result.widthPt-250)<1e-6,'side inset width from crop aspect');
  assert(Math.abs(result.heightPt-100)<1e-6,'side inset height matches main');
  assert(Math.abs(result.effectiveMagnification-2.5)<1e-6);
  const leaderLines=groups[0].lines.filter(l=>!l.closed && l.strokeWidth===0.75 && l.points && l.points.length===2);
  assert.equal(leaderLines.length,2);
  function segCross(a,b){
    function cross(o,p,q){return (p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]);}
    const d1=cross(a[0],a[1],b[0]), d2=cross(a[0],a[1],b[1]), d3=cross(b[0],b[1],a[0]), d4=cross(b[0],b[1],a[1]);
    return d1*d2<0 && d3*d4<0;
  }
  assert(!segCross(leaderLines[0].points, leaderLines[1].points), 'leaders must not form an X');
  assert.equal(groups.length,1);
  assert.equal(groups[0].texts[0].contents,'10 碌m');
  assert.equal(groups[0].lines[0].strokeWidth,2);
  assert.deepEqual(groups[0].lines[0].strokeDashes,[6,4]);
  assert.equal(groups[0].lines[0].closed,true);
  assert.equal(groups[0].lines[1].strokeWidth,2,'inset border matches ROI stroke');
  assert.deepEqual(groups[0].lines[1].strokeDashes,[6,4]);
  assert.equal(groups[0].lines[1].closed,true);
  assert.equal(groups[0].lines[2].strokeWidth,0.75);
  assert.deepEqual(groups[0].lines[2].strokeDashes,[1,2.5]);
  assert.equal(placed.length,1);
  assert(Math.abs(placed[0].position[0]-218)<1e-6);
  assert.equal(placed[0].file.fsName,'/inset.png');
  const spec2=Object.assign({}, spec, {file:'/inset2.png', leaders:{enabled:false}, frame:{weight:1,color:'#ffffff',dashes:[],corner:'round',radius:6}});
  result=JSON.parse(host.sciBitmapInset(JSON.stringify(lock), JSON.stringify(spec2)));
  assert(result.ok, result.error);
  assert.equal(groups.length,1,'previous inset group replaced');
  assert.equal(placed.length,1);
  assert.equal(placed[0].file.fsName,'/inset2.png');
  assert(groups[0].lines.some(l=>l.rounded && l.rounded.rx===6));
  const pathItem={typename:'PathItem',pathPoints:[
    {anchor:[60,60]},{anchor:[160,60]},{anchor:[160,20]},{anchor:[60,20]}
  ]};
  doc.selection=[target, pathItem];
  const reg=JSON.parse(host.sciBitmapArtboardRegion(JSON.stringify(lock), JSON.stringify({sourceWidth:200,sourceHeight:100})));
  assert(reg.ok, reg.error);
  assert.equal(reg.left, 50);
  assert.equal(reg.top, 20);
  assert.equal(reg.width, 100);
  assert.equal(reg.height, 40);
  assert(!JSON.parse(host.sciBitmapInset(JSON.stringify(lock), JSON.stringify(Object.assign({}, spec, {file:'/missing.png'})))).ok);
});

test('0.9.7 inset above/below matches main width (height from crop aspect)',()=>{
  const target=item([1,0,0,1,10,80]);
  Object.assign(target,{typename:'PlacedItem',embedded:false,uuid:'inset-above',name:'main',file:{fsName:'/main.png',name:'main.png',exists:true},width:200,height:100,boundingBox:[0,0,200,-100]});
  const groups=[];
  groups.add=function(){let g={name:'',note:'',lines:[],texts:[],_children:[],pathItems:{add(){let l={closed:false,filled:true,stroked:false,strokeWidth:0,strokeColor:null,strokeDashes:null,strokeJoin:null,strokeCap:null,points:null,setEntirePath(p){this.points=p;},move(){}};g.lines.push(l);return l;}},textFrames:{add(){let t={contents:'',width:20,position:null,textRange:{characterAttributes:{}}};g.texts.push(t);return t;}},remove(){const i=groups.indexOf(g);if(i>=0)groups.splice(i,1);}};groups.push(g);return g;};
  const placed=[];
  placed.add=function(){const it={typename:'PlacedItem',embedded:false,uuid:'p'+placed.length,file:null,width:10,height:10,position:[0,0],
    get boundingBox(){return [0,0,this.width,-this.height];},
    get matrix(){return {mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:this.position[0],mValueTY:this.position[1]};},
    get geometricBounds(){return [this.position[0], this.position[1], this.position[0]+this.width, this.position[1]-this.height];},
    remove(){const i=placed.indexOf(this); if(i>=0)placed.splice(i,1);},
    move(group){ if(group&&group._children) group._children.push(this); this._parent=group; }
  }; placed.push(it); return it;};
  const doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[target],groupItems:groups,placedItems:placed,pathItems:{roundedRectangle(){return {};}}};
  host.app.documents=[doc]; host.app.activeDocument=doc; host.app.redraw=function(){};
  host.RGBColor=function(){};
  host.File=function(p){this.fsName=p;this.exists=true;};
  host.ElementPlacement={PLACEBEFORE:0,PLACEATEND:1,PLACEATBEGINNING:2};
  const lock=JSON.parse(host.captureSelectionLock()).lock;
  const spec={file:'/inset.png',norm:{x:0.25,y:0.2,w:0.5,h:0.4},magnification:3,gap:8,anchor:'above',
    frame:{weight:1,color:'#ffffff',dashes:[],corner:'miter',radius:0}, leaders:{enabled:false}};
  const result=JSON.parse(host.sciBitmapInset(JSON.stringify(lock), JSON.stringify(spec)));
  assert(result.ok, result.error);
  assert(Math.abs(result.widthPt-200)<1e-6, 'above inset width matches main (not free mag×region)');
  assert(Math.abs(result.heightPt-80)<1e-6, 'above inset height from crop aspect');
  assert(Math.abs(result.effectiveMagnification-2)<1e-6);
  assert.equal(result.anchor,'above');
  const below=JSON.parse(host.sciBitmapInset(JSON.stringify(lock), JSON.stringify(Object.assign({}, spec, {anchor:'below'}))));
  assert(below.ok, below.error);
  assert(Math.abs(below.widthPt-200)<1e-6, 'below inset width matches main');
  assert(Math.abs(below.heightPt-80)<1e-6);
  assert.equal(below.anchor,'below');
});

test('0.8.9 inset frameCorners via geometricBounds + no blind V-flip on upright place',()=>{
  const target=item([1,0,0,-1,0,100]);
  Object.assign(target,{typename:'PlacedItem',embedded:false,uuid:'inset-fc',name:'main',file:{fsName:'/main.png',name:'main.png',exists:true},width:200,height:100,boundingBox:[0,0,200,-100]});
  const groups=[];
  groups.add=function(){let g={name:'',note:'',lines:[],texts:[],_children:[],pathItems:{add(){let l={closed:false,filled:true,stroked:false,strokeWidth:0,strokeColor:null,strokeDashes:null,strokeJoin:null,strokeCap:null,points:null,setEntirePath(p){this.points=p;},move(){}};g.lines.push(l);return l;}},textFrames:{add(){let t={contents:'',width:20,position:null,textRange:{characterAttributes:{}}};g.texts.push(t);return t;}},remove(){const i=groups.indexOf(g);if(i>=0)groups.splice(i,1);}};groups.push(g);return g;};
  const placed=[];
  placed.add=function(){const it={typename:'PlacedItem',embedded:false,uuid:'p'+placed.length,file:null,width:10,height:10,position:[0,0],
    matrix:{mValueA:1,mValueB:0,mValueC:0,mValueD:-1,mValueTX:0,mValueTY:0},
    resizeCalls:0,
    resize(sx,sy){this.resizeCalls++; this.lastResize=[sx,sy]; this.width=Math.abs(this.width*sx/100); this.height=Math.abs(this.height*sy/100); this.matrix.mValueA*=sx/100;this.matrix.mValueD*=sy/100;},
    get boundingBox(){return [0,0,this.width,-this.height];},
    get geometricBounds(){return [this.position[0], this.position[1], this.position[0]+this.width, this.position[1]-this.height];},
    remove(){const i=placed.indexOf(this); if(i>=0)placed.splice(i,1);},
    move(group){ if(group&&group._children) group._children.push(this); }
  }; placed.push(it); return it;};
  const doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[target],groupItems:groups,placedItems:placed,pathItems:{roundedRectangle(){return {};}}};
  host.app.documents=[doc]; host.app.activeDocument=doc; host.app.redraw=function(){};
  host.RGBColor=function(){};
  host.File=function(p){this.fsName=p;this.exists=true;};
  host.ElementPlacement={PLACEBEFORE:0,PLACEATEND:1,PLACEATBEGINNING:2};
  const lock=JSON.parse(host.captureSelectionLock()).lock;
  const corners=[{x:0.1,y:0.2},{x:0.4,y:0.15},{x:0.45,y:0.55},{x:0.05,y:0.5}];
  const spec={file:'/inset.png',norm:{x:0.05,y:0.15,w:0.4,h:0.4},frameCorners:corners,pixelWidth:80,pixelHeight:50,magnification:2,gap:8,anchor:'right',
    frame:{weight:1,color:'#ff0000',dashes:[],corner:'miter',radius:0}, leaders:{enabled:false}};
  const result=JSON.parse(host.sciBitmapInset(JSON.stringify(lock), JSON.stringify(spec)));
  assert(result.ok, result.error);
  assert(Math.abs(result.heightPt-100)<1e-6);
  assert(Math.abs(result.widthPt-160)<1e-6,'pixel aspect 80/50 鈫?width 160 at height 100');
  const frame=groups[0].lines[0];
  assert.equal(frame.closed,true);
  /* 0.8.9: file UV 鈫?geometricBounds (file top 鈫?artboard top), not BL-first corner UV. */
  assert(Math.abs(frame.points[0][0]-20)<1e-6 && Math.abs(frame.points[0][1]-180)<1e-6);
  assert(Math.abs(frame.points[1][0]-80)<1e-6 && Math.abs(frame.points[1][1]-185)<1e-6);
  assert(Math.abs(frame.points[2][0]-90)<1e-6 && Math.abs(frame.points[2][1]-145)<1e-6);
  assert(Math.abs(frame.points[3][0]-10)<1e-6 && Math.abs(frame.points[3][1]-150)<1e-6);
  /* Realistic AI place already has det<0; must NOT blind-flip (that inverted crops). */
  const det=placed[0].matrix.mValueA*placed[0].matrix.mValueD-placed[0].matrix.mValueB*placed[0].matrix.mValueC;
  assert(det<0,'inset orientation must stay upright (inherent D<0)');
  assert(Math.abs(placed[0].width - 160) < 1 && Math.abs(placed[0].height - 100) < 1, 'placed width and height follow the crop aspect');
  assert(!(placed[0].lastResize && placed[0].lastResize[1] < 0), 'must not blind resize(100,-100) when already upright');
  const borders=groups[0].lines.filter(l=>l.closed);
  assert.equal(borders.length,2,'ROI frame + matching inset border');
  assert(Math.abs(borders[1].points[0][0]-placed[0].position[0])<1e-6);
  assert(Math.abs(borders[1].points[0][1]-placed[0].position[1])<1e-6);
});

test('0.8.8 inset flips once only when fresh place has det>0',()=>{
  const target=item([1,0,0,-1,0,100]);
  Object.assign(target,{typename:'PlacedItem',embedded:false,uuid:'inset-flip',name:'main',file:{fsName:'/main.png',name:'main.png',exists:true},width:200,height:100,boundingBox:[0,0,200,-100]});
  const groups=[];
  groups.add=function(){let g={name:'',note:'',lines:[],texts:[],_children:[],pathItems:{add(){let l={closed:false,filled:true,stroked:false,strokeWidth:0,strokeColor:null,strokeDashes:null,strokeJoin:null,strokeCap:null,points:null,setEntirePath(p){this.points=p;},move(){}};g.lines.push(l);return l;}},textFrames:{add(){let t={contents:'',width:20,position:null,textRange:{characterAttributes:{}}};g.texts.push(t);return t;}},remove(){const i=groups.indexOf(g);if(i>=0)groups.splice(i,1);}};groups.push(g);return g;};
  const placed=[];
  placed.add=function(){const it={typename:'PlacedItem',embedded:false,uuid:'p'+placed.length,file:null,width:10,height:10,position:[0,0],
    matrix:{mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0},
    resizeCalls:0,
    resize(sx,sy){this.resizeCalls++; this.lastResize=[sx,sy]; this.width=Math.abs(this.width*sx/100); this.height=Math.abs(this.height*sy/100); this.matrix.mValueA*=sx/100;this.matrix.mValueD*=sy/100;},
    get boundingBox(){return [0,0,this.width,-this.height];},
    get geometricBounds(){return [this.position[0], this.position[1], this.position[0]+this.width, this.position[1]-this.height];},
    remove(){const i=placed.indexOf(this); if(i>=0)placed.splice(i,1);},
    move(group){ if(group&&group._children) group._children.push(this); }
  }; placed.push(it); return it;};
  const doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[target],groupItems:groups,placedItems:placed,pathItems:{roundedRectangle(){return {};}}};
  host.app.documents=[doc]; host.app.activeDocument=doc; host.app.redraw=function(){};
  host.RGBColor=function(){};
  host.File=function(p){this.fsName=p;this.exists=true;};
  host.ElementPlacement={PLACEBEFORE:0,PLACEATEND:1,PLACEATBEGINNING:2};
  const lock=JSON.parse(host.captureSelectionLock()).lock;
  const spec={file:'/inset.png',norm:{x:0.1,y:0.1,w:0.2,h:0.2},magnification:2,gap:8,anchor:'right',
    frame:{weight:1,color:'#ffffff',dashes:[],corner:'miter',radius:0}, leaders:{enabled:false}};
  const result=JSON.parse(host.sciBitmapInset(JSON.stringify(lock), JSON.stringify(spec)));
  assert(result.ok, result.error);
  assert.equal(placed[0].resizeCalls,2,'det>0 place is scaled then flipped once');
  assert.deepEqual(placed[0].lastResize, [100, -100], 'last resize is the corrective V-flip');
  const det=placed[0].matrix.mValueA*placed[0].matrix.mValueD-placed[0].matrix.mValueB*placed[0].matrix.mValueC;
  assert(det<0,'after corrective flip inset is upright');
});
