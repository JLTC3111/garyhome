const mediaBuckets = new Set(['property-media','listing-videos']);
const actions = new Set(['status','scan','trash','restore','run','purge','purge_unused','purge_recovery','health']);
const json = (body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const encode=new TextEncoder();
const sha=async data=>new Uint8Array(await crypto.subtle.digest('SHA-256',data));
const hex=data=>Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const validTimestamp=value=>typeof value==='string'&&value.length<=48&&Number.isFinite(Date.parse(value));

function validRecoveryTarget(target) {
  return target&&mediaBuckets.has(target.bucket)&&typeof target.name==='string'&&target.name.length>0&&target.name.length<=1024&&
    typeof target.objectId==='string'&&uuid.test(target.objectId)&&validTimestamp(target.heldAt)&&
    (target.version===null||typeof target.version==='string'&&target.version.length<=100);
}

async function matchesSecret(supplied,expected) {
  if (!supplied || !expected || supplied.length>256) return false;
  const [left,right]=await Promise.all([sha(encode.encode(supplied)),sha(encode.encode(expected))]);
  return left.reduce((different,byte,index)=>different|(byte^right[index]),0)===0;
}

export function createMediaCleanup({url,publishable,service,cronSecret,fetcher=fetch,warn=console.warn}) {
  async function request(path,key,token,options={}) {
    return fetcher(url+path,{...options,redirect:'error',signal:AbortSignal.timeout(8_000),headers:{
      apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json',
    }});
  }
  async function rpc(action,token,args={},internal=false) {
    const res=await request('/rest/v1/rpc/home_media_'+action,internal?service:publishable,token,{
      method:'POST',body:JSON.stringify(args),
    });
    const result=await res.json().catch(()=>null);
    if(!res.ok) {
      const code=result?.message?.match(/^(?:listing_cleanup)\.([a-z_]+)$/)?.[1];
      if(action==='claim_unused' && (result?.code==='PGRST202'||result?.code==='42883'))
        throw Object.assign(new Error('retention_cleanup_setup'),{status:503});
      if(action==='claim_recovery' && (result?.code==='PGRST202'||result?.code==='42883'))
        throw Object.assign(new Error('recovery_setup'),{status:503});
      if(action==='observe_hourly'||action==='observe_hourly_step') {
        const reason=result?.code==='57014'?'observation_timeout':
          ['PGRST202','42883'].includes(result?.code)?'observation_setup':'observation_failed';
        throw Object.assign(new Error(reason),{status:503});
      }
      throw Object.assign(new Error(res.status===401?'session_expired':res.status===403?'forbidden':
        result?.code==='55P03'?'media_busy':code||'unavailable'),{status:[400,401,403,409].includes(res.status)?res.status:503});
    }
    return result;
  }
  const internal=(action,args)=>rpc(action,service,args,true);

  async function verifyReplacement(item) {
    if(!item.replacementKey) return true;
    if(!item.replacementSha256 || item.replacementKey.split('/').some(part=>!part||part==='.'||part==='..'))return false;
    const path=item.replacementKey.split('/').map(encodeURIComponent).join('/');
    const res=await request('/storage/v1/object/property-media/'+path+'?verify='+crypto.randomUUID(),service,service);
    if(!res.ok||!res.body) return false;
    const reader=res.body.getReader(),chunks=[];
    let bytes=0;
    try {
      for(;;) {
        const chunk=await reader.read();
        if(chunk.done)break;
        bytes+=chunk.value.length;
        if(bytes>8*1024*1024) {await reader.cancel();return false;}
        chunks.push(chunk.value);
      }
    } finally {reader.releaseLock();}
    return hex(await sha(await new Blob(chunks).arrayBuffer()))===item.replacementSha256;
  }

  async function run(actor,signal,early) {
    const claim=early?.action==='purge_recovery'
      ?await internal('claim_recovery',{p_actor:actor,p_target:early.target,p_confirm:true})
      :await internal(early?.action==='purge_unused'?'claim_unused':'claim',
        {p_actor:actor,...(early?{p_item:early.id,p_expiry:early.expiresAt}:{})});
    if(claim?.status!=='ok')return claim;
    let attempted=0,removed=0,overdue=0;
    const start=Date.now();
    try {
      for(const item of claim.items) {
        if(signal.aborted||Date.now()-start>45_000)break;
        const replacement=await verifyReplacement(item).catch(()=>false);
        const args={p_run:claim.id,p_id:item.id};
        const target=await internal('target',{...args,p_replacement_verified:replacement});
        if(!target)continue;
        if(!mediaBuckets.has(target.bucket)||typeof target.name!=='string') throw new Error('unavailable');
        attempted++;
        let acknowledged=!target.present;
        if(target.present) {
          const response=await request('/storage/v1/object/'+target.bucket,service,service,{
            method:'DELETE',body:JSON.stringify({prefixes:[target.name]}),
          }).catch(()=>null);
          const result=response?.ok?await response.json().catch(()=>null):null;
          acknowledged=Array.isArray(result)&&result.some(row=>row.name===target.name);
        }
        if(await internal('settle',{...args,p_ok:acknowledged}))removed++;
      }
    } finally {
      overdue=await internal('finish',{p_run:claim.id});
      if(overdue||removed!==attempted) warn('Home media cleanup requires attention',{overdue,attempted,removed});
    }
    return {status:'ok',attempted,removed,overdue};
  }

  async function observeHourly(signal) {
    let progress;
    const started=Date.now();
    try {
      // Leave room for the existing eight-second deadline on the last request.
      for(let batch=0;batch<32&&!signal.aborted&&Date.now()-started<8_000;batch++) {
        const prior=progress;
        progress=prior?await internal('observe_hourly_step',{p_cycle:prior.cycle,p_checked:prior.checked}):
          await internal('observe_hourly',{});
        if(progress?.status!=='running'||!Number.isSafeInteger(progress.cycle)||
          prior&&(progress.cycle!==prior.cycle||progress.checked<=prior.checked))break;
      }
    } catch(error) {
      progress={status:'failed',error:error.name==='TimeoutError'?'observation_timeout':
        error.status===503?error.message:'observation_failed'};
    }
    if(progress?.status==='failed')warn('Home unused media observation failed',{error:progress.error});
    return progress;
  }

  return async req=>{
    if(req.method!=='POST')return json({error:'invalid_request'},405);
    if(!url||!publishable||!service) return json({error:'unavailable'},503);
    try {
      const body=await req.json().catch(()=>null);
      if(!body||!actions.has(body.action)||(['restore','purge','purge_unused'].includes(body.action)&&!uuid.test(body.id||'')))
        return json({error:'invalid_request'},400);
      const early=['purge','purge_unused','purge_recovery'].includes(body.action)?body:null;
      if(early&&(early.confirm!==true||!(early.action==='purge_recovery'?validRecoveryTarget(early.target):validTimestamp(early.expiresAt))))
        return json({error:'invalid_request'},400);
      const cron=req.headers.get('x-gary-home-cleanup');
      if(cron!==null) {
        if(body.action!=='run'||!await matchesSecret(cron,cronSecret))return json({error:'forbidden'},403);
        let cleanup;
        try { cleanup=await run(null,req.signal); }
        catch(error) { await observeHourly(req.signal); throw error; }
        return json({...cleanup,observation:await observeHourly(req.signal)});
      }
      const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if(!token)return json({error:'session_expired'},401);
      const user=await request('/auth/v1/user',publishable,token);
      if(!user.ok) return json({error:user.status===401||user.status===403?'session_expired':'unavailable'},user.status===401||user.status===403?401:503);
      const {id}=await user.json();
      if(!uuid.test(id||''))return json({error:'session_expired'},401);
      if(body.action==='run'||early||body.action==='health') {
        const owner=await rpc('management',token,{p_action:'authorize'});
        if(owner?.actor!==id) return json({error:'forbidden'},403);
        if(body.action==='health')return json({status:'ok',cronConfigured:Boolean(cronSecret),manualUnused:true,manualRecovery:true});
        const result=await run(id,req.signal,early);
        if(early&&result.status==='ok'&&result.removed!==1) return json({error:'purge_unconfirmed'},409);
        return json(result);
      }
      return json(await rpc('management',token,{p_action:body.action,p_id:body.action==='restore'?body.id:null,
        p_offset:Number.isInteger(body.offset)?body.offset:0}));
    } catch(error) {
      return json({error:error.status?error.message:'unavailable'},error.status||503);
    }
  };
}
