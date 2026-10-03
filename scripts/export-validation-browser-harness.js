(() => {
 const subtle=crypto.subtle,original=subtle.digest;let armed=false,pending;
 subtle.digest=function(...args){const result=original.apply(this,args);if(!armed)return result;armed=false;return result.then(bytes=>new Promise((resolve,reject)=>{pending={bytes,resolve,reject};}));};
 window.__exportIntentTest={arm(){if(armed||pending)throw Error('Already armed');armed=true;},pending(){return Boolean(pending);},release(fail=false){if(!pending)throw Error('No pending native SHA');const p=pending;pending=undefined;fail?p.reject(Error('Controlled export-validator completion failure after native SHA')):p.resolve(p.bytes);},restore(){if(armed||pending)throw Error('Still pending');subtle.digest=original;}};
 return 'Native SHA bytes retained; only completion/fault timing controlled, no React state injection';
})()
