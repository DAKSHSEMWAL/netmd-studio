const assert=require('node:assert/strict'),{apply,signature}=require('./queue-sync');
const q=[{file:'a',title:'A',duration:1},{file:'b',title:'B',duration:2},{file:'b',title:'B',duration:2},{file:'c',title:'C',duration:3}];
const rows=q.map((t,i)=>({...t,status:['present','missing','queue-duplicate','review'][i]}));
const result=apply(q,rows,signature(q));assert.deepEqual(result.queue.map(t=>t.file),['b','c']);assert.equal(result.removed,2);
assert.equal(apply(q,rows,signature([...q].reverse())),null);
assert.equal(apply(q.map((t,i)=>i===0?{...t,title:'Edited'}:t),rows,signature(q)),null);
assert.equal(apply(result.queue,rows,signature(q)),null);
assert.deepEqual(apply(q,q.map(t=>({...t,status:'missing'})),signature(q)).queue,q);
console.log('PASS: confirmed matches removed, repeated file handled by position, review kept, edited/stale queue rejected, repeated result ignored. No disc operations.');
