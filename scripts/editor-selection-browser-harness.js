(()=>{
 const subtle=crypto.subtle, original=subtle.digest;let armed=false,pending;
 subtle.digest=function(...args){const result=original.apply(this,args);if(!armed)return result;armed=false;return result.then(bytes=>new Promise(resolve=>{pending={resolve,bytes};}));};
 window.__editorDigestTest={arm(){if(pending||armed)throw Error('Already armed');armed=true;},pending(){return Boolean(pending);},release(){if(!pending)throw Error('No pending digest');const p=pending;pending=undefined;p.resolve(p.bytes);},restore(){if(pending||armed)throw Error('Still pending');subtle.digest=original;}};
 return 'Installed controlled real digest';
})()
