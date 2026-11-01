import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
type Value=string|number|null;
type Statement={get:(...v:Value[])=>unknown;all:(...v:Value[])=>unknown[];run:(...v:Value[])=>{changes:number|bigint}};
// Desktop 1.19.5 uses Node's DatabaseSync; the CLI distribution may use Bun.
// Resolve lazily so importing this module never requires the other runtime.
export class Database {
  private native:any;
  private bun:boolean;
  constructor(path:string,_options?:{create:boolean}){
    this.bun=typeof (globalThis as any).Bun!=='undefined';
    const Runtime=this.bun?require('bun:sqlite').Database:require('node:sqlite').DatabaseSync;
    this.native=new Runtime(path,this.bun?{create:true}:{});
  }
  exec(sql:string){this.native.exec(sql);}
  query(sql:string):Statement{
    const s=this.bun?this.native.query(sql):this.native.prepare(sql);
    return {get:(...v)=>s.get(...v),all:(...v)=>s.all(...v),run:(...v)=>s.run(...v)};
  }
  transaction<T>(fn:()=>T):()=>T {
    if(this.bun)return this.native.transaction(fn);
    return ()=>{this.native.exec('BEGIN IMMEDIATE');try{const value=fn();this.native.exec('COMMIT');return value;}catch(e){this.native.exec('ROLLBACK');throw e;}};
  }
  close(){this.native.close();}
}
