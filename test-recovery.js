const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
process.env.NETMD_SESSION_FILE=path.join(__dirname,'test-recording-session.json');
const r=require('./recovery');
const a={title:'Existing',duration:180*512,encoding:146};
const disc=(extra=[])=>({title:'Test disc',total:74*60*512,groups:[{tracks:[a,...extra]}]});
try{
  const s=r.begin(disc(),[{file:'one.flac',title:'One',duration:200},{file:'two.flac',title:'Two',duration:210}],'lp2');
  assert.equal(r.load().id,s.id);assert.equal(r.reconcile(s,disc()).remaining.length,2);
  const one={title:'One',duration:200*512,encoding:146};
  s.tracks[0].state='writing';r.save(s);
  assert.deepEqual(r.reconcile(r.load(),disc([one])).review,[2]);
  s.tracks[0].state='acknowledged';r.save(s);
  assert.equal(r.reconcile(r.load(),disc([one])).completed,1);
  assert.equal(r.reconcile(s,disc()).completed,0); // Unsaved TOC can roll back an acknowledgment.
  assert.throws(()=>r.reconcile(s,disc([{...one,duration:80*512}])),/incomplete/);
  assert.throws(()=>r.reconcile(s,{...disc(),title:'Different disc'}),/match/);
  assert.throws(()=>r.reconcile(s,disc([{...one,title:'Other'}])),/incomplete/);
  const changed=disc();changed.groups[0].tracks[0]={...a,title:'Changed'};assert.throws(()=>r.reconcile(s,changed),/changed/);
  assert.equal(r.reconcile(s,disc([one,{title:'Two',duration:210*512,encoding:146}])).remaining.length,0);
  console.log('PASS: persisted session, acknowledged tracks, interrupted track review, TOC rollback, partial tracks, wrong/changed disc, finished session. No USB operations.');
}finally{for(const p of [r.FILE,r.FILE+'.tmp'])if(fs.existsSync(p))fs.unlinkSync(p)}
