/* Avonent device workspace v2 — private IndexedDB storage. */
(() => {
  "use strict";
  const DB_NAME = "avonent-local-workspace-v1";
  const DB_VERSION = 2;
  const tables = ["brands","daily_runs","creative_chats","chat_messages","creative_items","creative_assets","ad_references"];
  let opening;

  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of tables) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, {keyPath:"id"});
        }
        if (!database.objectStoreNames.contains("files")) database.createObjectStore("files");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Device storage is unavailable. Enable website storage and reload."));
      request.onblocked = () => reject(new Error("Close other Avonent tabs and reload to finish the workspace update."));
    });
    return opening;
  }

  async function transaction(name, mode, operation) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(name, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error("Could not save to device storage."));
      try { operation(tx.objectStore(name), value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }

  const failure = error => ({data:null,error:{message:error.message || String(error)}});

  class Query {
    constructor(table) { this.table=table; this.filters=[]; this.sort=[]; this.action="read"; }
    select() { return this; }
    eq(key,value) { this.filters.push(row=>row[key]===value); return this; }
    in(key,values) { this.filters.push(row=>values.includes(row[key])); return this; }
    order(key,{ascending=true}={}) { this.sort.push({key,ascending}); return this; }
    limit(value) { this.maximum=value; return this; }
    single() { this.one=true; return this; }
    insert(values) { this.action="insert"; this.values=Array.isArray(values)?values:[values]; return this; }
    update(values) { this.action="update"; this.values=values; return this; }
    delete() { this.action="delete"; return this; }
    then(resolve,reject) { return this.execute().then(resolve,reject); }

    async execute() {
      try {
        return await transaction(this.table,this.action==="read"?"readonly":"readwrite",(store,done)=>{
          const request=store.getAll();
          request.onsuccess=()=>{
            let rows=request.result.filter(row=>this.filters.every(filter=>filter(row)));
            const now=new Date().toISOString();

            if(this.action==="insert") {
              rows=this.values.map(value=>({
                ...value,
                id:value.id || crypto.randomUUID(),
                created_at:value.created_at || now,
                updated_at:now,
                favorite:value.favorite ?? false,
                status:value.status ?? "Idea"
              }));
              rows.forEach(row=>store.put(row));
            } else if(this.action==="update") {
              rows=rows.map(row=>({...row,...this.values,id:row.id,updated_at:now}));
              rows.forEach(row=>store.put(row));
            } else if(this.action==="delete") {
              rows.forEach(row=>store.delete(row.id));
            }

            const count=rows.length;
            rows.sort((a,b)=>{
              for(const {key,ascending} of this.sort) {
                const left=a[key]??"", right=b[key]??"";
                if(left!==right) return (left<right?-1:1)*(ascending?1:-1);
              }
              return 0;
            });
            if(this.maximum!==undefined) rows=rows.slice(0,this.maximum);
            if(this.one && rows.length!==1) return done(failure(new Error("Item could not be found.")));
            done({data:this.one?rows[0]:rows,error:null,count});
          };
        });
      } catch(error) { return failure(error); }
    }
  }

  const urls=new Map();
  const storage={
    async upload(path,file) {
      try { await transaction("files","readwrite",store=>store.put(file,path)); return {data:{path},error:null}; }
      catch(error){ return failure(error); }
    },
    async createSignedUrl(path) {
      try {
        const blob=await transaction("files","readonly",(store,done)=>{
          const req=store.get(path); req.onsuccess=e=>done(e.target.result);
        });
        if(!blob) throw new Error("File is not available on this device.");
        if(!urls.has(path)) urls.set(path,URL.createObjectURL(blob));
        return {data:{signedUrl:urls.get(path)},error:null};
      } catch(error){ return failure(error); }
    },
    async remove(paths) {
      try {
        await transaction("files","readwrite",store=>paths.forEach(path=>store.delete(path)));
        paths.forEach(path=>{
          if(urls.has(path)){ URL.revokeObjectURL(urls.get(path)); urls.delete(path); }
        });
        return {data:[],error:null};
      } catch(error){ return failure(error); }
    }
  };

  window.AVONENT_LOCAL_CLIENT={
    local:true,
    auth:{async getSession(){await open();return {data:{session:{local:true,user:{id:"device-workspace",email:"Local workspace"}}},error:null};}},
    from(table){ if(!tables.includes(table)) throw new Error("Unsupported local table: "+table); return new Query(table); },
    storage:{from(){return storage;}},
    open
  };

  document.addEventListener("DOMContentLoaded",()=>{
    const note=document.createElement("aside");
    note.className="local-workspace-note";
    note.innerHTML="<strong>Private workspace</strong><span>Saved on this device. Daily strategy refreshes automatically when Avonent is opened.</span>";
    document.querySelector("main")?.prepend(note);
  });
})();