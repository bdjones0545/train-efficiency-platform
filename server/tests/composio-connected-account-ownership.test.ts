import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ComposioConnectionAuthorityError,legacyFirstActiveAccount,selectAuthorizedProviderAccount } from "../services/composio-connected-account-resolver";
import { resolveExecutionConnectedAccount } from "../services/composio-service";

const provider=[
  {id:"b",toolkit_slug:"gmail",entity:"entity-b",status:"ACTIVE"},
  {id:"a",toolkit_slug:"gmail",entity:"entity-a",status:"ACTIVE"},
];
const authority=[
  {connected_account_id:"a",toolkit:"gmail",ownership_class:"organization",org_id:"A",active:true,platform_authorized:false},
  {connected_account_id:"b",toolkit:"gmail",ownership_class:"organization",org_id:"B",active:true,platform_authorized:false},
];
const resolve=(orgId:string,requestedAccountId?:string,rows:any[]=authority)=>selectAuthorizedProviderAccount({orgId,toolkit:"gmail",requestedAccountId,authorityRows:rows,providerAccounts:provider});

test("negative control: legacy global-first selector chooses B for an A request",()=>assert.equal(legacyFirstActiveAccount(provider,"gmail")?.id,"b"));
test("tenant resolver chooses only A-owned account",()=>assert.equal(resolve("A").id,"a"));
test("A cannot request B account",()=>assert.throws(()=>resolve("A","b"),ComposioConnectionAuthorityError));
test("B cannot request A account",()=>assert.throws(()=>resolve("B","a"),ComposioConnectionAuthorityError));
test("same toolkit remains isolated across tenants",()=>assert.deepEqual([resolve("A").id,resolve("B").id],["a","b"]));
test("unbound global account is unusable",()=>assert.throws(()=>resolve("A","global",[]),ComposioConnectionAuthorityError));
test("platform account without explicit tenant policy is unusable",()=>assert.throws(()=>resolve("A","p",[{connected_account_id:"p",toolkit:"gmail",ownership_class:"platform",org_id:null,active:true,platform_authorized:false}]),ComposioConnectionAuthorityError));
test("platform account with explicit tenant policy is usable",()=>{
  const p={id:"p",toolkit_slug:"gmail",entity:"platform",status:"ACTIVE"};
  assert.equal(selectAuthorizedProviderAccount({orgId:"A",toolkit:"gmail",requestedAccountId:"p",providerAccounts:[p],authorityRows:[{connected_account_id:"p",toolkit:"gmail",ownership_class:"platform",org_id:null,active:true,platform_authorized:true}]}).id,"p");
});
test("missing tenant fails closed",()=>assert.throws(()=>resolve(""),ComposioConnectionAuthorityError));
test("two eligible accounts require explicit selection",()=>{
  const rows=[...authority,{connected_account_id:"a2",toolkit:"gmail",ownership_class:"organization",org_id:"A",active:true,platform_authorized:false}];
  const accounts=[...provider,{id:"a2",toolkit_slug:"gmail",entity:"entity-a2",status:"ACTIVE"}];
  assert.throws(()=>selectAuthorizedProviderAccount({orgId:"A",toolkit:"gmail",authorityRows:rows,providerAccounts:accounts}),(e:unknown)=>e instanceof ComposioConnectionAuthorityError&&e.code==="ambiguous");
  assert.equal(selectAuthorizedProviderAccount({orgId:"A",toolkit:"gmail",requestedAccountId:"a2",authorityRows:rows,providerAccounts:accounts}).id,"a2");
});
test("local revocation and provider inactivity both fail",()=>{
  assert.throws(()=>resolve("A",undefined,authority.map(r=>r.org_id==="A"?{...r,active:false}:r)),ComposioConnectionAuthorityError);
  assert.throws(()=>selectAuthorizedProviderAccount({orgId:"A",toolkit:"gmail",authorityRows:authority,providerAccounts:provider.map(p=>p.id==="a"?{...p,status:"INACTIVE"}:p)}),ComposioConnectionAuthorityError);
});
test("provider entity mismatch fails",()=>assert.throws(()=>resolve("A",undefined,authority.map(r=>r.org_id==="A"?{...r,provider_entity_id:"wrong"}:r)),ComposioConnectionAuthorityError));
test("aliases and unknown toolkits fail through integrated contract",()=>{
  for(const toolkit of ["google-gmail","unknown"])assert.throws(()=>selectAuthorizedProviderAccount({orgId:"A",toolkit,authorityRows:authority,providerAccounts:provider}));
});
test("runtime resolver and validator contain no structural DDL",async()=>{
  for(const file of ["../services/composio-connected-account-resolver.ts","../composio-connected-account-schema-validation.ts"]){
    const source=await readFile(new URL(file,import.meta.url),"utf8"); assert.doesNotMatch(source,/CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)/i);
  }
});
test("Hermes unprocessed route no longer contains an unscoped resolution fallback",async()=>{
  const source=await readFile(new URL("../composio-routes.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/catch \{ orgId = undefined; \}/);
});

test("shared executor performs zero provider calls when schema or local authority is unavailable",async()=>{
  for(const code of ["unavailable","unauthorized","ambiguous"] as const){
    let providerCalls=0;
    await assert.rejects(resolveExecutionConnectedAccount({orgId:"A",toolkit:"gmail"},{
      resolveAuthority:async()=>{throw new ComposioConnectionAuthorityError(code);},
      listProviderAccounts:async()=>{providerCalls++;return provider;},
    }),ComposioConnectionAuthorityError);
    assert.equal(providerCalls,0);
  }
});

test("shared executor consults provider state only after exact local authority",async()=>{
  let providerCalls=0;
  const selected=await resolveExecutionConnectedAccount({orgId:"A",toolkit:"gmail",requestedAccountId:"a"},{
    resolveAuthority:async()=>authority[0],
    listProviderAccounts:async()=>{providerCalls++;return provider;},
  });
  assert.equal(selected.id,"a");
  assert.equal(providerCalls,1);
});
