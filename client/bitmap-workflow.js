/* PaperFig for Illustrator 0.9.8: reproducible RGB recipes + keep-channel, per-channel levels, baseline TIFF. See LICENSE. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports){module.exports=api;}if(root){root.SciBitmapWorkflow=api;}}(typeof window!=='undefined'?window:null,function(){
'use strict';
function clone(x){return JSON.parse(JSON.stringify(x));}
function channelColorPresets(){
 /* ImageJ / Fiji Image > Color > Merge Channels primary colors */
 return [
  {id:'red',hex:'#ff0000'},
  {id:'green',hex:'#00ff00'},
  {id:'blue',hex:'#0000ff'},
  {id:'gray',hex:'#ffffff'},
  {id:'cyan',hex:'#00ffff'},
  {id:'magenta',hex:'#ff00ff'},
  {id:'yellow',hex:'#ffff00'}
 ];
}
function channelsDefault(){return {enabled:false,components:[{name:'R',color:'#ff0000',low:0,high:255,visible:true},{name:'G',color:'#00ff00',low:0,high:255,visible:true},{name:'B',color:'#0000ff',low:0,high:255,visible:true}]};}
function levelsTouched(cs){cs=cs||channelsDefault();return (cs.components||[]).some(function(c){return Number(c.low)!==0||Number(c.high)!==255;});}
function number(v,min,max,name){v=Number(v);if(!isFinite(v)||v<min||v>max){throw new Error(name+' must be between '+min+' and '+max);}return v;}
function recipe(input){
 if(!input||typeof input!=='object'||Array.isArray(input)){throw new Error('Invalid adjustment recipe');}
 var out={version:1};
 ['brightness','contrast','cyanRed','magentaGreen','yellowBlue'].forEach(function(k){out[k]=number(input[k]==null?0:input[k],-100,100,k);});
 out.toneLow=number(input.toneLow==null?0:input.toneLow,0,255,'Low');out.toneHigh=number(input.toneHigh==null?255:input.toneHigh,0,255,'High');
 if(out.toneHigh<=out.toneLow){throw new Error('White point must exceed black point');}
 ['grayscale','invert','softBlur','sharpen'].forEach(function(k){out[k]=input[k]===true;});out.lut='None';
 var cs=input.channels||channelsDefault();out.channels={enabled:cs.enabled===true,components:[]};
 if(!Array.isArray(cs.components)||cs.components.length!==3){throw new Error('Exactly three RGB components required');}
 cs.components.forEach(function(c,i){
  if(!c||!/^#[0-9a-f]{6}$/i.test(c.color)){throw new Error('Invalid component color');}
  var lo=number(c.low,0,255,'Component low'),hi=number(c.high,0,255,'Component high');if(hi<=lo){throw new Error('Component white point must exceed black point');}
  out.channels.components.push({name:String(c.name||'RGB'[i]).slice(0,40),color:c.color.toLowerCase(),low:lo,high:hi,visible:c.visible!==false});
 });
 if(input.compatibility){var p=input.compatibility;if(['RGB8','GRAY8'].indexOf(p.kind)<0){throw new Error('Unsupported preset image type');}out.compatibility={kind:p.kind};}
 return out;
}
function keepMask(components,mask){
 if(!Array.isArray(mask)||mask.length!==3)throw new Error('Keep mask must list three booleans');
 return {enabled:true,components:components.map(function(c,i){return {name:c.name,color:c.color,low:c.low,high:c.high,visible:mask[i]===true};})};
}
function visibleCount(cs){cs=cs||channelsDefault();return cs.components.filter(function(c){return c.visible!==false;}).length;}
function mapChannels(data,cs,view){
 cs=cs||channelsDefault();
 var solo=['red','green','blue'].indexOf(view);
 var anyHidden=cs.components.some(function(c){return c.visible===false;});
 var anyLevels=levelsTouched(cs);
 // Recolor, solo grayscale, keep-channel, or per-plane Low/High (Photoshop-style levels)
 if(!cs.enabled&&solo<0&&!anyHidden&&!anyLevels)return;
 var comps=cs.components;
 if(!cs.enabled){
  // Keep / levels-only: identity R/G/B colors; still honor per-component levels + visibility
  comps=cs.components.map(function(c,i){return {name:c.name,color:['#ff0000','#00ff00','#0000ff'][i],low:c.low,high:c.high,visible:c.visible!==false};});
 }
 var rows=comps.map(function(c){var h=c.color;return {r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255,low:c.low,span:c.high-c.low,visible:c.visible!==false};});
 var i,j,v,r,g,b;
 for(i=0;i<data.length;i+=4){if(!data[i+3])continue;r=g=b=0;
  for(j=0;j<3;j++){if(solo>=0&&j!==solo)continue;var c=rows[j];if(!c.visible)continue;
   v=Math.max(0,Math.min(255,(data[i+j]-c.low)*255/c.span));
   if(view==='red'||view==='green'||view==='blue'){r+=v;g+=v;b+=v;}else{r+=v*c.r;g+=v*c.g;b+=v*c.b;}
  }data[i]=Math.min(255,r);data[i+1]=Math.min(255,g);data[i+2]=Math.min(255,b);
 }
}
function profile(meta){
 if(!meta||!meta.width||!meta.height){throw new Error('Cannot verify image dimensions/type');}
 /* TIFF (photometric/compression/extraSamples) must be top-left; JPEG EXIF Orientation (e.g. Sony camera tags 6/8) is baked by the panel preview path. */
 if(meta.orientation && meta.orientation!==1 && (meta.photometric!=null || meta.compression!=null || meta.extraSamples!=null)){throw new Error('TIFF orientation must be top-left (1); export a normalized display image first');}
 if(meta.hasMoreImages){throw new Error('Multi-page TIFF: export one merged RGB image first');}
 if(meta.bitsPerSample!==8){throw new Error('Requires an 8-bit RGB/gray display image; raw high-bit-depth data is not converted automatically');}
 var kind=meta.colorKind;
 if(!kind){if(meta.photometric===2&&(meta.samplesPerPixel===3||meta.samplesPerPixel===4))kind='RGB';else if((meta.photometric===0||meta.photometric===1)&&meta.samplesPerPixel===1)kind='GRAY';}
 if(kind!=='RGB'&&kind!=='GRAY'){throw new Error('Unsupported or unverified image color model');}
 return {kind:kind==='RGB'?'RGB8':'GRAY8',width:meta.width,height:meta.height};
}
function compatible(recipeValue,p){if(recipeValue.channels.enabled&&p.kind!=='RGB8'){throw new Error('RGB recoloring requires a merged RGB image');}if(recipeValue.compatibility&&recipeValue.compatibility.kind!==p.kind){throw new Error('Preset type '+recipeValue.compatibility.kind+' does not match '+p.kind);}}
function parsePresets(text){var value=JSON.parse(text);if(!value||value.schema!=='sci-bitmap-presets'||value.version!==1||!Array.isArray(value.presets)||value.presets.length>100){throw new Error('Invalid preset file (maximum 100 presets)');}return value.presets.map(function(p){if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>80){throw new Error('Invalid preset name');}return {name:p.name.trim(),recipe:recipe(p.recipe)};});}
// Baseline little-endian TIFF, one chunky RGBA strip; unassociated alpha, DPI in inches.
function encodeTiff(image,dpi,B){
 var w=image.width,h=image.height;if(!(w>0&&h>0)||w*h>100000000||image.data.length!==w*h*4){throw new Error('Image too large or invalid');}
 var count=15,ifd=8,end=ifd+2+count*12+4,bits=end,xres=end+8,yres=end+16,pixels=end+24;
 var b=B.alloc(pixels+w*h*4);b.write('II');b.writeUInt16LE(42,2);b.writeUInt32LE(ifd,4);b.writeUInt16LE(count,ifd);
 var tags=[[256,4,1,w],[257,4,1,h],[258,3,4,bits],[259,3,1,1],[262,3,1,2],[273,4,1,pixels],[274,3,1,1],[277,3,1,4],[278,4,1,h],[279,4,1,w*h*4],[282,5,1,xres],[283,5,1,yres],[284,3,1,1],[296,3,1,2],[338,3,1,2]];
 tags.forEach(function(t,i){var p=ifd+2+i*12;b.writeUInt16LE(t[0],p);b.writeUInt16LE(t[1],p+2);b.writeUInt32LE(t[2],p+4);if(t[1]===3&&t[2]===1)b.writeUInt16LE(t[3],p+8);else b.writeUInt32LE(t[3],p+8);});
 for(var i=0;i<4;i++)b.writeUInt16LE(8,bits+i*2);dpi=Math.round(number(dpi||300,36,2400,'DPI'));b.writeUInt32LE(dpi,xres);b.writeUInt32LE(1,xres+4);b.writeUInt32LE(dpi,yres);b.writeUInt32LE(1,yres+4);B.from(image.data).copy(b,pixels);return b;
}
function decodeTiff(b){
 if(b.length<8)throw new Error('Invalid TIFF');var le=b[0]===73;if(!le&&b[0]!==77)throw new Error('Invalid TIFF');
 function u16(p){return le?b.readUInt16LE(p):b.readUInt16BE(p);}function u32(p){return le?b.readUInt32LE(p):b.readUInt32BE(p);}
 if(u16(2)!==42)throw new Error('BigTIFF needs Fiji');var p=u32(4),n=u16(p),tags={};if(n>4096||p+2+n*12+4>b.length)throw new Error('Invalid TIFF directory');
 for(var i=0;i<n;i++){var e=p+2+i*12,id=u16(e),type=u16(e+2),cnt=u32(e+4),unit=type===3?2:(type===4?4:0);if(!unit||cnt>100000)continue;var at=cnt*unit<=4?e+8:u32(e+8);if(at+cnt*unit>b.length)throw new Error('Invalid TIFF tag');tags[id]=[];for(var k=0;k<cnt;k++)tags[id].push(type===3?u16(at+k*unit):u32(at+k*unit));}
 function one(id,d){return tags[id]?tags[id][0]:d;}var w=one(256,0),h=one(257,0),spp=one(277,1),bits=tags[258]||[1];
 if(u32(p+2+n*12)!==0||one(259,1)!==1||one(262,0)!==2||one(274,1)!==1||one(284,1)!==1||one(317,1)!==1||one(339,1)!==1||[3,4].indexOf(spp)<0||bits.some(function(x){return x!==8;})||!w||!h||w*h>100000000)throw new Error('This TIFF needs Fiji decoding');
 if(spp===4&&one(338,0)!==2)throw new Error('TIFF alpha type needs Fiji');
 var offsets=tags[273],sizes=tags[279],rows=one(278,h),out=new Uint8ClampedArray(w*h*4),row=0;
 if(!offsets||!sizes||rows<1)throw new Error('TIFF strips missing');
 for(i=0;i<offsets.length&&row<h;i++){var nr=Math.min(rows,h-row),len=nr*w*spp,start=offsets[i];if(sizes[i]<len||start+len>b.length)throw new Error('Truncated TIFF strip');for(k=0;k<nr*w;k++){var dest=(row*w+k)*4,src=start+k*spp;out[dest]=b[src];out[dest+1]=b[src+1];out[dest+2]=b[src+2];out[dest+3]=spp===4?b[src+3]:255;}row+=nr;}
 if(row!==h)throw new Error('Incomplete TIFF strips');return {width:w,height:h,data:out};
}
return {clone:clone,channelColorPresets:channelColorPresets,channelsDefault:channelsDefault,levelsTouched:levelsTouched,keepMask:keepMask,visibleCount:visibleCount,recipe:recipe,mapChannels:mapChannels,profile:profile,compatible:compatible,parsePresets:parsePresets,encodeTiff:encodeTiff,decodeTiff:decodeTiff};
}));
