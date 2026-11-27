import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {PROPERTY_IMAGE_BUCKET, PROPERTY_IMAGE_CACHE_SECONDS, PROPERTY_IMAGE_ORIGIN} from '../lib/property-photo-files.ts';
import {digest} from './plan-property-image-optimization.mjs';

export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const staffEndpoint = 'https://staff.garyhome.vn/api/admin/property-photos';
const retryableStatus = new Set([408,429,500,502,503,504]);
const maxRetryDelay = 30_000;
const safeErrorCodes = new Set([
  'unavailable','migration_required','session_expired','forbidden','conflict','media_busy',
  'remove_failed','object_unavailable','replacement_unavailable','integrity_failed',
  'NoSuchKey','ResourceAlreadyExists','AccessDenied','SlowDown','InternalError','DatabaseTimeout','DatabaseError',
]);
const etag = value => String(value||'').replace(/^"|"$/g,'');
const jsonArg = value => "convert_from(decode('" + Buffer.from(JSON.stringify(value)).toString('hex') + "','hex'),'UTF8')::jsonb";
const textArg = value => value==null ? 'null' :
  "convert_from(decode('" + Buffer.from(String(value)).toString('hex') + "','hex'),'UTF8')";

export function serviceSql(sql, env) {
  if (!/^[a-z0-9_.-]+$/i.test(env.PGSERVICE||'')) throw new Error('Set PGSERVICE to the approved Home database connection.');
  const pgEnv = Object.fromEntries(Object.entries(env).filter(([key])=>[
    'PATH','HOME','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGSSLROOTCERT',
  ].includes(key)));
  return new Promise((resolve,reject)=>{
    const connection=`service=${env.PGSERVICE} sslmode=verify-full gssencmode=disable connect_timeout=10`;
    const child=spawn('psql',['-X','-qAt','-w','-v','ON_ERROR_STOP=1','-d',connection],{
      env:pgEnv,stdio:['pipe','pipe','pipe'],signal:AbortSignal.timeout(35_000),
    });
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>{
      stdout+=chunk;
      if (stdout.length>1_500_000) child.kill();
    });
    child.stderr.setEncoding('utf8').on('data',chunk=>{if(stderr.length<8192) stderr+=chunk;});
    child.on('error',error=>reject(new Error(error.code==='ENOENT' ?
      'Install the PostgreSQL psql client to run approved database stages.' : 'Database session interrupted. Reconcile before retrying.')));
    child.stdin.on('error',()=>{});
    child.on('close',status=>{
      if (status!==0) {
        const code=stderr.match(/(?:ERROR:\s+)(photo_optimization\.[a-z_]+|photo_rename\.forbidden|listing_cleanup\.media_busy)\b/)?.[1];
        if (!code && /no password supplied|password authentication failed|certificate verif|root certificate|does not match host name/i.test(stderr)) {
          return reject(new Error('PostgreSQL password or TLS verification failed. Check the approved service.'));
        }
        return reject(new Error(code||'Database stage did not confirm. Check the approved connection and reconcile before retrying.'));
      }
      try {resolve(JSON.parse(stdout));} catch {reject(new Error('Database output was incomplete. Reconcile before retrying.'));}
    });
    child.stdin.end("set time zone 'UTC'; set statement_timeout='20s'; set lock_timeout='2s';\n"+sql+'\n');
  });
}

export function sqlSession(helpers, query) {
  return helpers+'\n'+query+';\n';
}

export function databaseStages(execute, helpers) {
  const run = query=>execute(sqlSession(helpers,query));
  return {
    state:({listing,key,outputKey,retirementId})=>run(
      `select pg_temp.property_media_migration_state(${textArg(listing)}::uuid,${textArg(key)},${textArg(outputKey)},${textArg(retirementId)}::uuid)`),
    review:entries=>run(`select pg_temp.review_property_media_batch(${jsonArg(entries)})`),
    verifyRun:entries=>run(`select pg_temp.verify_property_media_run(${jsonArg(entries)})`),
    switchPhotos:({listing,version,original,optimized,apply,undo,actor})=>run(
      `select pg_temp.switch_optimized_property_photo(${textArg(listing)}::uuid,${textArg(version)}::timestamptz,${jsonArg(original)},${jsonArg(optimized)},${Boolean(apply)},${undo?jsonArg(undo):'null'},${textArg(actor)}::uuid)`),
    reserveRetirement:(transfer,id,actor)=>run(
      `select to_jsonb(pg_temp.reserve_optimized_photo_retirement(${jsonArg(transfer)},${textArg(id)}::uuid,${textArg(actor)}::uuid))`),
  };
}

export async function checkMediaDatabase(env, listing, actor) {
  const result=await serviceSql(`begin read only;
    do $$ begin
      perform set_config('request.jwt.claim.sub',${textArg(actor)},true);
      perform private.require_home_photo_owner();
    end $$;
    set local role authenticated;
    select jsonb_build_object('rls',row_security_active('public.properties'),
      'canUpdate',has_table_privilege('public.properties','UPDATE'),
      'listingVisible',exists(select 1 from public.properties where id=${textArg(listing)}::uuid));
    rollback;`,env);
  if (!result?.rls || !result.canUpdate || !result.listingVisible) {
    throw new Error('The Home Owner does not have the expected listing access under RLS.');
  }
}

export async function verifyMediaDatabase(env, entries) {
  const db=databaseStages(sql=>serviceSql(sql,env),await migrationHelpers());
  const totals=await db.verifyRun(entries);
  if(totals?.confirmed!==entries.length) throw new Error('The final catalogue and reference audit did not match every retirement.');
  return totals;
}

function publishable(key) {
  if (key?.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon'; } catch { return false; }
}

function objectEndpoint(key, audience='') {
  const parts=key.split('/');
  if (parts.some(part=>!part||part==='.'||part==='..'||/[\\\p{Cc}]/u.test(part))) throw new Error('Invalid Storage key.');
  const prefix=audience?audience+'/':'';
  return `${PROPERTY_IMAGE_ORIGIN}/storage/v1/object/${prefix}${PROPERTY_IMAGE_BUCKET}/${parts.map(encodeURIComponent).join('/')}`;
}

let nextRequestAt=0;
async function paceRequests() {
  const now=performance.now(), startAt=Math.max(now,nextRequestAt);
  nextRequestAt=startAt+300;
  if (startAt>now) await delay(startAt-now);
}

function retryAfterMillis(header) {
  const value=header?.trim();
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value)*1000;
  const date=/[a-z]{3}/i.test(value)?Date.parse(value):NaN;
  return Number.isFinite(date)?Math.max(0,date-Date.now()):0;
}

async function sanitizedErrorBody(response) {
  if (!response.body) return '';
  const limit=2048;
  if (!/^application\/json\b/i.test(response.headers.get('content-type')??'') ||
      Number(response.headers.get('content-length'))>limit) {
    await response.body.cancel().catch(()=>{});
    return '';
  }
  const reader=response.body.getReader(), buffer=Buffer.alloc(limit);
  let length=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      if (length+value.length>limit) return '';
      buffer.set(value,length);
      length+=value.length;
    }
    const body=JSON.parse(buffer.toString('utf8',0,length));
    for (const field of ['error','code']) {
      if (safeErrorCodes.has(body?.[field])) return JSON.stringify({[field]:body[field]});
    }
    return '';
  } catch {
    return '';
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

class MediaRequestError extends Error {
  constructor(operation, method, url, status, body='', retryAfter=0) {
    const {origin,pathname}=new URL(url);
    const path=pathname.replace(/(\/storage\/v1\/object\/(?:public\/)?property-media)\/.*/, '$1/<object-key>');
    const outcome=status?('returned HTTP '+status+(body?' '+body:'')):'was interrupted or returned an incomplete response';
    super(`Property media ${operation} (${method} ${origin}${path}) ${outcome}.`);
    this.operation=operation;
    this.status=status;
    this.retryable=!status||retryableStatus.has(status);
    this.retryAfter=retryAfter;
  }
}

export async function retryMediaRequest(action,{operation,wait=delay}={}) {
  for (let attempt=1;;attempt++) {
    try {
      return await action();
    } catch(error) {
      if (!(error instanceof MediaRequestError) || !error.retryable || attempt===3 ||
          (operation && error.operation!==operation)) throw error;
      if (error.retryAfter>maxRetryDelay) {
        throw new Error(error.message+' Retry-After exceeds the 30-second retry window.');
      }
      await wait(Math.max(error.retryAfter,2000*2**(attempt-1)));
    }
  }
}

async function readVerifiedBody(response, object) {
  const contentType=response.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (!response.body || (response.headers.has('content-length') && Number(response.headers.get('content-length'))!==object.bytes)
      || contentType!==object.mime || etag(response.headers.get('etag'))!==etag(object.etag)) {
    await response.body?.cancel();
    throw new Error('Storage response does not match the audited size, MIME or ETag.');
  }
  const reader=response.body.getReader(), chunks=[];
  let bytes=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      bytes+=value.length;
      if (bytes>object.bytes) {
        await reader.cancel();
        throw new Error('Storage response exceeded the audited size.');
      }
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  if (bytes!==object.bytes) throw new Error('Storage response was incomplete.');
  const data=Buffer.concat(chunks,bytes);
  if (object.sha256 && digest(data)!==object.sha256) throw new Error('Storage SHA-256 did not match.');
  return data;
}

export function storageStages({key,token,fetcher=fetch,wait=delay,pace=paceRequests}) {
  if (!publishable(key) || !token || /\s/.test(token)) throw new Error('Set a Home publishable key and current Owner access token.');
  const auth={apikey:key,authorization:'Bearer '+token};
  const request = (operation,url,options={},retry=false)=>{
    const method=options.method??'GET';
    const send=async()=>{
      await pace();
      let response;
      try {
        response=await fetcher(url,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30_000)});
      } catch {throw new MediaRequestError(operation,method,url);}
      if (!response.ok) {
        const retryAfter=retryAfterMillis(response.headers.get('retry-after'));
        throw new MediaRequestError(operation,method,url,response.status,await sanitizedErrorBody(response),retryAfter);
      }
      return response;
    };
    return retry?retryMediaRequest(send,{wait}):send();
  };
  const readObject=(object,isPublic,headers={},retry=true)=>request('read',objectEndpoint(object.key,isPublic?'public':'')+
    '?cacheNonce='+crypto.randomUUID(),{headers:isPublic?headers:{...auth,...headers}},retry);
  return {
    async owner(listing) {
      const access=await request('check Owner access',PROPERTY_IMAGE_ORIGIN+'/rest/v1/rpc/home_photo_rename_history',{
        method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({p_property:listing}),
      },true);
      await access.body?.cancel();
      const user=await (await request('read Owner identity',PROPERTY_IMAGE_ORIGIN+'/auth/v1/user',{headers:auth},true)).json().catch(()=>null);
      if (!uuid.test(user?.id||'')) throw new Error('Owner identity could not be confirmed.');
      return user.id;
    },
    read:(object,isPublic=false)=>readObject(object,isPublic).then(response=>readVerifiedBody(response,object)),
    readOnce:object=>readObject(object,false,{'if-match':`"${etag(object.etag)}"`},false).then(response=>readVerifiedBody(response,object)),
    async verifyPublic(object,stagedBytes) {
      const prefix=stagedBytes.subarray(0,12);
      const tag=object.etag;
      const canProbe=/^"[\x21\x23-\x7e]+"$/.test(tag??'') && object.bytes>prefix.length &&
        stagedBytes.length===object.bytes && /^[a-f0-9]{64}$/.test(object.sha256??'');
      const last=prefix.length-1;
      const response=await readObject(object,true,canProbe?{'if-match':tag,range:'bytes=0-'+last}:{});
      if (response.status===200) {
        await readVerifiedBody(response,object);
        return;
      }
      if (!canProbe || response.status!==206 || response.headers.get('etag')!==tag ||
          response.headers.get('content-range')!==`bytes 0-${last}/${object.bytes}`) {
        await response.body?.cancel();
        throw new Error('The public Storage range did not match the verified object identity.');
      }
      await readVerifiedBody(response,{...object,bytes:prefix.length,sha256:digest(prefix)});
    },
    async upload(key,body,mime,userMetadata) {
      const response=await request('upload',objectEndpoint(key),{method:'POST',body,headers:{
        ...auth,'x-upsert':'false','content-type':mime,'cache-control':'max-age='+PROPERTY_IMAGE_CACHE_SECONDS,
        'x-metadata':Buffer.from(JSON.stringify(userMetadata||{})).toString('base64'),
      }});
      await response.body?.cancel();
    },
    async retire(id) {
      const response=await request('retire',staffEndpoint,{method:'POST',headers:{
        authorization:auth.authorization,'content-type':'application/json',
      },body:JSON.stringify({action:'retire',confirm:true,id})});
      const result=await response.json().catch(()=>null);
      if (result?.removed!==true) throw new MediaRequestError('retire','POST',staffEndpoint);
    },
  };
}

async function migrationHelpers() {
  const files=await Promise.all(['switch-optimized-property-photo.sql','property-media-migration-state.sql']
    .map(file=>readFile(new URL(file,import.meta.url),'utf8')));
  return files.join('\n');
}

export async function liveMigrationTransport(env=process.env) {
  if (!env.PGSERVICE) throw new Error('Set PGSERVICE to the approved Home database connection.');
  const storage=storageStages({key:env.GARY_MEDIA_PUBLISHABLE_KEY,token:env.GARY_MEDIA_OWNER_TOKEN});
  return {...storage,...databaseStages(sql=>serviceSql(sql,env),await migrationHelpers())};
}
