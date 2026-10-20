// Run with NODE_PATH pointing to an installation of fake-indexeddb 6.2.4.
const {indexedDB}=require('fake-indexeddb');
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const code=fs.readFileSync(require('node:path').join(__dirname,'../static/local-workspace.js'),'utf8');
function client(){const window={};vm.runInNewContext(code,{window,indexedDB,crypto:require('node:crypto').webcrypto,URL,document:{addEventListener(){}}});return window.AVONENT_LOCAL_CLIENT;}
(async()=>{
 let db=client();
 assert.equal((await db.auth.getSession()).data.session.local,true);
 const chat=await db.from('creative_chats').insert({title:'Test chat'}).select().single();assert.equal(chat.error,null);
 const item=await db.from('creative_items').insert({title:'Test hook',content:'Hook',chat_id:chat.data.id}).select().single();
 assert.equal(item.data.status,'Idea');
 await db.from('creative_items').update({status:'Review',favorite:true}).eq('id',item.data.id);
 db=client(); // Simulate a reload using the same IndexedDB.
 const saved=await db.from('creative_items').select().eq('id',item.data.id).single();assert.equal(saved.data.status,'Review');assert.equal(saved.data.favorite,true);
 const file=new Blob(['video test'],{type:'video/mp4'});
 assert.equal((await db.storage.from('creative-assets').upload('test.mp4',file)).error,null);
 const signed=await db.storage.from('creative-assets').createSignedUrl('test.mp4');assert.equal(await (await fetch(signed.data.signedUrl)).text(),'video test');
 const ad=await db.from('ad_references').insert({source_url:'https://www.facebook.com/ads/library/?id=123'}).select().single();
 assert.equal((await db.from('ad_references').select().in('id',[ad.data.id])).data.length,1);
 await db.from('creative_items').delete().eq('id',item.data.id);
 assert.equal((await db.from('creative_items').select()).data.length,0);
 await db.storage.from('creative-assets').remove(['test.mp4']);assert.ok((await db.storage.from('creative-assets').createSignedUrl('test.mp4')).error);
 console.log('PASS: device session, chat/item creation, status updates, reload persistence, ad queries, file upload/read/delete, item deletion');
})().catch(error=>{console.error(error);process.exitCode=1;});
