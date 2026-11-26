import {readFile,mkdir,readdir} from 'node:fs/promises';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';

export type Row = Record<string, any>;
export interface Sql { rows<T extends Row = Row>(sql:string, params?:unknown[]):Promise<T[]> }
export interface Database extends Sql {
  transaction<T>(fn:(s:Sql)=>Promise<T>):Promise<T>;
  migrate(): Promise<void>;
  close():Promise<void>;
  kind:string;
}

export async function database(url?:string, directory?:string):Promise<Database> {
  const dir=new URL('../migrations/',import.meta.url);
  const files=(await readdir(dir)).filter(f=>/^[0-9]+.*\.sql$/.test(f)).sort();
  const scripts=await Promise.all(files.map(async f=>({version:parseInt(f,10),sql:await readFile(new URL(f,dir),'utf8')})));
  const apply=async(s:Sql,exec:(script:string)=>Promise<unknown>)=>{
    await exec('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    const versions=new Set((await s.rows('SELECT version FROM schema_migrations')).map(row=>Number(row.version)));
    for(const script of scripts)if(!versions.has(script.version))await exec(script.sql);
  };
  if (url) {
    const pool = new pg.Pool({connectionString:url,max:8,connectionTimeoutMillis:5000,statement_timeout:15000});
    pool.on('error', () => console.error('Postgres idle connection lost'));
    const adapter = (c:pg.Pool|pg.PoolClient):Sql => ({
      rows:async <T extends Row>(sql:string, params:unknown[]=[]) => (await c.query<T>(sql,params)).rows
    });
    const transaction = async <T>(fn:(s:Sql)=>Promise<T>):Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await fn(adapter(client));
        await client.query('COMMIT');
        return value;
      } catch(e) { await client.query('ROLLBACK'); throw e; }
      finally {client.release();}
    };
    return {...adapter(pool),kind:'PostgreSQL',transaction,close:()=>pool.end(),
      migrate:async()=>{await transaction(async s=>{await s.rows('SELECT pg_advisory_xact_lock(725151)');await apply(s,sql=>s.rows(sql));});}};
  }
  if(!directory) throw Error('Set DATABASE_URL for the web service and scheduled jobs.');
  await mkdir(directory,{recursive:true});
  const local=new PGlite(directory);
  await local.waitReady;
  const adapter=(c:Pick<PGlite,'query'>):Sql=>({rows:async<T extends Row>(sql:string,params:unknown[]=[]) =>(await c.query<T>(sql,params)).rows});
  return {...adapter(local), kind:'PGlite (embedded PostgreSQL)',transaction:fn=>local.transaction(tx=>fn(adapter(tx))),
    migrate:async()=>{await local.transaction(async tx=>{await apply(adapter(tx),sql=>tx.exec(sql));});},close:()=>local.close()};
}
