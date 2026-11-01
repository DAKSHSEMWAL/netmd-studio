const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {diff,key}=require('./compare'),{cached}=require('./encoding-cache');
async function main(){
  assert.equal(key('01 - Anri — Lost Love'),key('Lost Love - ANRI'));
  assert.notEqual(key('Love You - Anri'),key('You Love - Anri'));
  const disc={groups:[{tracks:[{index:0,title:'Song - Artist',duration:200*512}]}]};
  const rows=diff([{file:'a',title:'Artist - Song',duration:200},{file:'b',title:'New - Artist',duration:180},{file:'c',title:'New - Artist',duration:180}],disc);
  assert.deepEqual(rows.map(r=>r.status),['present','missing','queue-duplicate']);
  assert.equal(diff([{title:'Song - Artist',duration:90}],disc)[0].status,'review');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'netmd-cache-test-')),source=path.join(dir,'source'),tool=path.join(dir,'tool');
  try{
    fs.writeFileSync(source,'audio1');fs.writeFileSync(tool,'encoder1');let calls=0;
    const opts={source,tools:[tool],mode:'lp2',root:path.join(dir,'cache'),encode:async()=>{calls++;return Buffer.from('encoded-audio')}};
    assert.equal((await cached(opts)).hit,false);assert.equal((await cached(opts)).hit,true);assert.equal(calls,1);
    const first=await cached(opts);fs.writeFileSync(path.join(opts.root,first.key+'.bin'),'corrupt');assert.equal((await cached(opts)).hit,false);
    fs.writeFileSync(source,'audio2');assert.equal((await cached(opts)).hit,false);
    fs.writeFileSync(tool,'encoder2');assert.equal((await cached(opts)).hit,false);
    assert.equal((await cached({...opts,mode:'sp'})).hit,false);
    assert.equal((await cached(opts)).hit,true);
    await assert.rejects(()=>cached({...opts,mode:'lp2',encode:async()=>{fs.writeFileSync(source,'changed-mid-encode');return Buffer.from('x')},tools:[source]}),/changed during/);
    console.log('PASS: reordered artist/title, distinct word order, existing/missing/review/queue duplicates; cache reuse, corruption detection, source/tool/mode changes, changing source. No USB access.');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
