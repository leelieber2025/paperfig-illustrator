'use strict';
/* 1.2.9: Fiji Jaunch launchers (fiji-<os>-<arch>) and nested macOS bundles. */
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'client/fiji-bridge.js'),'utf8');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'paperfig-fiji-'));
let count=0;function test(name,f){f();count++;console.log('PASS '+name);}
function load(platform,arch,home,env){const fakeOs=Object.assign({},os,{homedir:()=>home||base});const ctx={process:{platform,arch,env:env||{}},window:{require:m=>m==='os'?fakeOs:require(m)}};ctx.window.window=ctx.window;vm.createContext(ctx);vm.runInContext(src,ctx);return ctx.SciBitmapFiji;}
function touch(p){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'');return p;}
try{
test('macOS Apple silicon: nested Fiji/Fiji.app with fiji-macos-arm64 resolves and beats legacy ImageJ-macosx',()=>{
 const dir=path.join(base,'mac1','Fiji');touch(path.join(dir,'Contents/MacOS/ImageJ-macosx'));const exe=touch(path.join(dir,'Fiji.app/Contents/MacOS/fiji-macos-arm64'));
 const F=load('darwin','arm64');assert.equal(F.resolveExecutable(dir),exe);assert.equal(F.resolveExecutable(path.join(dir,'Fiji.app')),exe);
});
test('macOS Intel prefers fiji-macos-x64; legacy ImageJ-macosx bundle still works',()=>{
 const dir=path.join(base,'mac2','Fiji.app');touch(path.join(dir,'Contents/MacOS/fiji-macos-arm64'));const x64=touch(path.join(dir,'Contents/MacOS/fiji-macos-x64'));
 assert.equal(load('darwin','x64').resolveExecutable(dir),x64);
 const old=path.join(base,'mac3','Fiji.app'),legacy=touch(path.join(old,'Contents/MacOS/ImageJ-macosx'));assert.equal(load('darwin','x64').resolveExecutable(old),legacy);
});
test('Windows and Linux folders resolve Jaunch launchers before ImageJ-*',()=>{
 const win=path.join(base,'win','Fiji');touch(path.join(win,'ImageJ-win64.exe'));const wexe=touch(path.join(win,'fiji-windows-x64.exe'));assert.equal(load('win32','x64').resolveExecutable(win),wexe);
 const lin=path.join(base,'lin','Fiji');const lexe=touch(path.join(lin,'fiji-linux-x64'));assert.equal(load('linux','x64').resolveExecutable(lin),lexe);
});
test('Auto-detect finds /Applications-style Fiji folder under the home Applications directory',()=>{
 const home=path.join(base,'home');const exe=touch(path.join(home,'Applications/Fiji/Fiji.app/Contents/MacOS/fiji-macos-arm64'));
 assert.deepEqual(Array.from(load('darwin','arm64',home).detectCandidates()),[exe]);
});
test('Jaunch launchers drop --ij2/--console; legacy launchers keep them',()=>{
 const F=load('darwin','arm64');
 assert.deepEqual(Array.from(F.launcherArgs('/A/Fiji.app/Contents/MacOS/fiji-macos-arm64','script','/t/e.groovy')),['--headless','--run','/t/e.groovy']);
 assert.deepEqual(Array.from(F.launcherArgs('C:\\Fiji\\fiji-windows-x64.exe','macro','m.ijm')),['--headless','-macro','m.ijm']);
 assert.deepEqual(Array.from(F.launcherArgs('/A/Fiji.app/Contents/MacOS/ImageJ-macosx','script','s')),['--ij2','--headless','--console','--run','s']);
 assert.deepEqual(Array.from(F.launcherArgs('ImageJ-win64.exe','macro','m')),['--headless','--console','-macro','m']);
 assert(F.isJaunchLauncher('/x/fiji-linux-x64'));assert(!F.isJaunchLauncher('/x/ImageJ-linux64'));
});
}finally{fs.rmSync(base,{recursive:true,force:true});}
console.log('\n'+count+' Fiji launcher checks passed.');
