import {spawnSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PROPERTY_IMAGE_ORIGIN} from '../lib/property-photo-files.ts';
import {liveMigrationTransport,storageStages} from './property-media-migration-transport.mjs';

function hiddenPrompt(label) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('Enter credentials in your local Terminal.');
  const prompt=spawnSync('/bin/zsh',['-f','-c',
    'IFS= read -rs "answer?$1 " || exit 1\nprintf "\\n" >&2\nprintf "%s" "$answer"',
    'gary-home-media',label],{stdio:['inherit','pipe','inherit'],encoding:'utf8',maxBuffer:8192});
  if (prompt.status!==0 || !prompt.stdout) throw new Error('Credential entry was cancelled or empty.');
  return prompt.stdout;
}

async function authJson(url, options, label, fetcher) {
  let response;
  try {
    response=await fetcher(url,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)});
  } catch {throw new Error(label+' could not connect.');}
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(label+' returned HTTP '+response.status+'.');
  }
  try {return await response.json();} catch {throw new Error(label+' returned an invalid response.');}
}

export async function homeOwnerSession({env,prompt=hiddenPrompt,fetcher=fetch,connect=liveMigrationTransport}) {
  let key=env.GARY_MEDIA_PUBLISHABLE_KEY;
  if (!key) {
    const config=await authJson('https://staff.garyhome.vn/api/config',{},'Home sign-in configuration',fetcher);
    if (!config?.configured || config.url?.replace(/\/$/,'')!==PROPERTY_IMAGE_ORIGIN) {
      throw new Error('Home sign-in configuration does not match the audited project.');
    }
    key=config.publishableKey;
  }
  const existing=env.GARY_MEDIA_OWNER_TOKEN;
  storageStages({key,token:existing||'check-publishable-key'});
  const signIn=async(grant,body)=>{
    const result=await authJson(PROPERTY_IMAGE_ORIGIN+'/auth/v1/token?grant_type='+grant,{
      method:'POST',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify(body),
    },grant==='password'?'Home Owner sign-in':'Home Owner session refresh',fetcher);
    if (typeof result?.access_token!=='string' || typeof result.refresh_token!=='string' || !(result.expires_in>60)) {
      throw new Error('Supabase Auth did not return a usable Home session.');
    }
    return {access:result.access_token,refresh:result.refresh_token,expiresAt:Date.now()+result.expires_in*1000};
  };
  let session=existing?null:await signIn('password',{
    email:prompt('Existing Gary Home Owner email').trim().toLowerCase(),
    password:prompt('Existing Gary Home Owner password'),
  });
  return async()=>{
    if (session && session.expiresAt-Date.now()<60_000) {
      session=await signIn('refresh_token',{refresh_token:session.refresh});
    }
    return connect({...env,GARY_MEDIA_PUBLISHABLE_KEY:key,GARY_MEDIA_OWNER_TOKEN:existing||session.access});
  };
}

export async function withMediaSession({promptDatabasePassword},action) {
  if (!/^[a-z0-9_.-]+$/i.test(process.env.PGSERVICE||'')) throw new Error('Set PGSERVICE to the approved Home database connection.');
  if (spawnSync('psql',['--version'],{stdio:'ignore'}).status!==0) {
    throw new Error('The psql client is required. Put the existing PostgreSQL client or Homebrew libpq on PATH.');
  }
  const env={...process.env};
  if (!promptDatabasePassword) return action(env,await homeOwnerSession({env}));
  const password=hiddenPrompt('Existing Gary Home PostgreSQL password');
  if (/[\r\n\0]/.test(password)) throw new Error('The PostgreSQL password could not be read safely.');
  const temp=await mkdtemp('/tmp/gary-home-db.');
  const clean=()=>rmSync(temp,{recursive:true,force:true});
  const interrupt=()=>process.exit(130);
  process.once('exit',clean);
  process.once('SIGINT',interrupt);
  process.once('SIGTERM',interrupt);
  process.once('SIGHUP',interrupt);
  try {
    env.PGPASSFILE=join(temp,'pgpass');
    // This private passfile is passed only to psql calls for the approved service.
    await writeFile(env.PGPASSFILE,'*:*:*:*:'+password.replace(/[\\:]/g,'\\$&')+'\n',{mode:0o600,flag:'wx'});
    return await action(env,await homeOwnerSession({env}));
  } finally {
    clean();
    process.removeListener('exit',clean);
    for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.removeListener(signal,interrupt);
  }
}
