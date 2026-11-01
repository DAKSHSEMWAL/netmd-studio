const assert=require('node:assert/strict'),{fingerprint,validate}=require('./erase');
const d={title:'Test',total:74*60*512,writable:true,writeProtected:false,groups:[{tracks:[{title:'Song',duration:200*512,encoding:146}]}]};
const expected=fingerprint(d);validate(d,expected,'ERASE');
assert.throws(()=>validate(d,expected,'erase'),/Type ERASE/);
assert.throws(()=>validate({...d,writeProtected:true},expected,'ERASE'),/writable/);
assert.throws(()=>validate({...d,title:'Another disc'},expected,'ERASE'),/changed/);
assert.throws(()=>validate({...d,groups:[{tracks:[]}]},expected,'ERASE'),/changed/);
assert.throws(()=>validate(null,expected,'ERASE'),/writable/);
console.log('PASS: explicit erase confirmation, writable media, changed-disc rejection. No USB access.');
