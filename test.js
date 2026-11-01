const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {spawn}=require('child_process');
const fixture=fs.mkdtempSync(path.join(require('os').tmpdir(),'netmd-library-test-'));
process.env.MUSIC_ROOT=fixture;
const core=require('./core');
async function main(){
  await core.run(require('./config').ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-y',path.join(fixture,'Test Tone.wav')]);
  assert.equal(core.cleanTitle('01 - Night\u2019s Drive'),'Night\'s Drive');
  const blank={writable:true,writeProtected:false,left:74*60*512,groups:[]};
  const t={duration:270,title:'Test Song'};
  core.validateQueue([t],blank,'lp2');
  assert.throws(()=>core.validateQueue([t],{...blank,left:100*512},'lp2'),/capacity/);
  assert.throws(()=>core.validateQueue([t],{...blank,writeProtected:true},'lp2'),/protected/);
  assert.throws(()=>core.validateQueue([t,t],blank,'lp2'),/Duplicate/);
  assert.throws(()=>core.validateQueue([t],blank,'lp4'),/Unsupported/);
  assert.throws(()=>core.validateQueue([t],{...blank,groups:[{tracks:[{title:'Test Song'}]}]},'sp'),/Duplicate/);
  await assert.rejects(()=>core.probe('../not-allowed.wav'));
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8').replace('__QUEUE_SYNC__',fs.readFileSync(path.join(__dirname,'queue-sync.js'),'utf8'));new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const child=spawn(process.execPath,[path.join(__dirname,'server.js')],{windowsHide:true,env:{...process.env,NETMD_PORT:'17893'}});
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('Server exited '+c)))});
    const base='http://127.0.0.1:17893';
    const page=await (await fetch(base)).text(),token=page.match(/const token='([^']+)'/)[1];
    assert.equal((await fetch(base+'/api/library')).status,403);
    const headers={'X-App-Token':token,'Content-Type':'application/json'};
    const library=await (await fetch(base+'/api/library',{headers})).json();
    assert.equal(library.length,1);assert.ok(library.every(t=>!t.file.includes('.tools')));
    const probe=await fetch(base+'/api/probe',{method:'POST',headers,body:JSON.stringify({files:[library[0].file]})});assert.equal(probe.status,200);const track=(await probe.json())[0];assert.ok(track.duration>0);
    const bad=await fetch(base+'/api/burn',{method:'POST',headers,body:JSON.stringify({tracks:[track],mode:'unsafe'})});assert.equal(bad.status,400);
    const cross=await fetch(base+'/api/inspect',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{}'});assert.equal(cross.status,403);
    const state=await(await fetch(base+'/api/state',{headers})).json();assert.equal(state.busy,false);
    for(const payload of [{command:'erase'},{command:'play',track:-1},{command:'play',track:254}]){const r=await fetch(base+'/api/playback',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,400)}
    const audioURL=base+'/api/audio?token='+encodeURIComponent(token)+'&file='+encodeURIComponent(library[0].file);
    const audio=await fetch(audioURL,{headers:{Range:'bytes=0-31'}});assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,32);
    const invalidRange=await fetch(audioURL,{headers:{Range:'bytes=999999999999-'}});assert.equal(invalidRange.status,416);
    const outside=await fetch(base+'/api/audio?token='+encodeURIComponent(token)+'&file='+encodeURIComponent('../outside.flac'));assert.equal(outside.status,400);
    const unauthorized=await fetch(base+'/api/audio?file='+encodeURIComponent(library[0].file));assert.equal(unauthorized.status,403);
    const disconnect=await fetch(base+'/api/disconnect',{method:'POST',headers,body:'{}'});assert.equal(disconnect.status,200);
    for(const action of ['diff','prepare']){const invalid=await fetch(base+'/api/'+action,{method:'POST',headers,body:JSON.stringify({tracks:[],mode:'lp2'})});assert.equal(invalid.status,400);}
    const disconnected=await(await fetch(base+'/api/state',{headers})).json();assert.equal(disconnected.disc,null);assert.equal(disconnected.busy,false);assert.equal(disconnected.job.state,'disconnected');
    console.log('PASS: capacity, duplicates, protection, title cleanup, UI syntax, library/probe APIs, token/origin security, playback input validation, audio range serving and path restrictions. No USB writes.');
  }finally{child.kill()}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(fixture,{recursive:true,force:true}));
